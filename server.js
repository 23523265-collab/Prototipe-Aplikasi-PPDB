require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const path = require("path");
const supabase = require("./lib/supabase");
const engine = require("./lib/engine");
const auth = require("./lib/auth");
const storage = require("./lib/storage");
const validasi = require("./lib/validasi");
const zonasi = require("./lib/zonasi");
const aturan = require("./lib/aturan");
const { waitUntil } = require("@vercel/functions");
const crypto = require("crypto");
const email = require("./lib/email");

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/* ---------------------------------------------------------
   Pengaman seleksi ganda: satu jalur tidak boleh diseleksi dua kali bersamaan
   (mitigasi race condition, PRD bagian 13 - Risiko dan Mitigasi).
   Kunci disimpan di tabel kunci_seleksi (migration v6.9) supaya berlaku di semua instance Vercel.
   Kalau tabel belum ada, kembali memakai penjaga di memori server.
   --------------------------------------------------------- */
const jalurSedangDiproses = new Set();
const KUNCI_SELEKSI_KEDALUWARSA_MS = 5 * 60 * 1000; // kunci tertinggal (mis. proses mati di tengah jalan) dilepas setelah 5 menit

/** Mengembalikan "db" / "memori" kalau kunci didapat, atau null kalau jalur sedang diseleksi. */
async function ambilKunciSeleksi(jalurId, oleh) {
  for (let percobaan = 0; percobaan < 2; percobaan++) {
    const { error } = await supabase.from("kunci_seleksi").insert({ jalur_id: jalurId, oleh });
    if (!error) return "db";
    if (error.code !== "23505") {
      console.warn("[seleksi] Kunci database tidak aktif (sudah jalankan migration v6.9?):", error.message);
      if (jalurSedangDiproses.has(jalurId)) return null;
      jalurSedangDiproses.add(jalurId);
      return "memori";
    }
    // Sudah ada kunci: hapus hanya kalau kedaluwarsa, lalu coba sekali lagi
    const batas = new Date(Date.now() - KUNCI_SELEKSI_KEDALUWARSA_MS).toISOString();
    const { data: dihapus } = await supabase.from("kunci_seleksi").delete().eq("jalur_id", jalurId).lt("mulai_at", batas).select("jalur_id");
    if (!dihapus?.length) return null;
  }
  return null;
}

async function lepasKunciSeleksi(jalurId, jenis) {
  if (jenis === "memori") jalurSedangDiproses.delete(jalurId);
  else await supabase.from("kunci_seleksi").delete().eq("jalur_id", jalurId);
}

// Batas pendaftaran baru per IP (anti spam/bot). Longgar karena satu IP bisa dipakai
// banyak orang sekaligus (WiFi sekolah, lab komputer, hotspot bersama).
const MAKS_DAFTAR_PER_IP = 20;
const JENDELA_DAFTAR_MENIT = 60;
const PESAN_NIK_TERDAFTAR = "NIK ini sudah terdaftar. Satu calon siswa hanya boleh mendaftar sekali (sudah mencakup 3 pilihan sekolah). "
  + "Gunakan menu Cek Status dengan nomor pendaftaran Anda, atau hubungi panitia jika merasa tidak pernah mendaftar.";

// Berkas wajib = berkas dasar (KK, akta, rapor) + berkas tambahan jalur (lihat aturan.JENIS_JALUR)
const berkasUntukJalur = (daftarJalur) => aturan.dokumenWajib(daftarJalur.filter(Boolean));

/** Jalur dari pilihan yang sedang diproses (prioritas aktif) seorang pendaftar. */
async function jalurAktifPendaftar(pendaftarId, prioritasAktif) {
  const { data: pil } = await supabase.from("pilihan").select("jalur_id")
    .eq("pendaftar_id", pendaftarId).eq("urutan_prioritas", prioritasAktif).maybeSingle();
  if (!pil) return null;
  const { data: jalur } = await supabase.from("jalur").select("*").eq("id", pil.jalur_id).single();
  return jalur;
}
const TIPE_FILE_DIIZINKAN = ["application/pdf", "image/jpeg", "image/png"];

// Aturan usia (12–21 tahun per 1 Juli) dan penyamaran nama ada di aturan.js supaya bisa diuji otomatis
const { validasiUmur, samarkanNama } = aturan;

// Escape teks sebelum dimasukkan ke HTML email
/**
 * Log aktivitas (migration v7.3): jejak audit keputusan panitia & Admin Dinas -- siapa, kapan, terhadap siapa.
 * Gagal mencatat (mis. migration belum dijalankan) tidak boleh menggagalkan aksi utamanya.
 */
async function catatAktivitas(req, aksi, { sekolahId, pendaftarId = null, detail = null } = {}) {
  const aktor = req.panitia
    ? { aktor_tipe: "panitia", aktor: `${req.panitia.nama} (${req.panitia.username})`, sekolah_id: sekolahId ?? req.panitia.sekolahId }
    : { aktor_tipe: "admin", aktor: `${req.admin?.nama} (${req.admin?.username})`, sekolah_id: sekolahId ?? null };
  const { error } = await supabase.from("log_aktivitas").insert({ ...aktor, pendaftar_id: pendaftarId, aksi, detail });
  if (error) console.warn("[log] Gagal mencatat aktivitas (sudah jalankan migration v7.3?):", error.message);
}

/** Alamat utama situs: APP_BASE_URL (.env) > domain produksi Vercel (otomatis) > localhost. */
function alamatSitus() {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/+$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return `http://localhost:${PORT}`;
}

const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));

// Di balik proxy (mis. Vercel), IP asli pengunjung ada di header X-Forwarded-For
app.set("trust proxy", 1);
app.disable("x-powered-by"); // jangan beri tahu teknologi server ke pengunjung

// Header keamanan dasar untuk semua respons
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff"); // browser tidak menebak-nebak jenis file
  res.setHeader("X-Frame-Options", "DENY"); // halaman tidak boleh disematkan di situs lain (clickjacking)
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(self), camera=(), microphone=()");
  if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=31536000"); // selalu HTTPS
  next();
});

app.use(express.json());
app.use(cookieParser());
// no-cache: browser tetap boleh menyimpan file, tapi wajib mengecek versi terbaru ke server tiap kali dibuka
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (res) => res.setHeader("Cache-Control", "no-cache"),
}));

/* =========================================================
   AUTENTIKASI (sesi disimpan di Supabase, bukan di memori server --
   penting untuk kompatibilitas dengan Vercel serverless)
   ========================================================= */

app.get("/api/auth/me", async (req, res) => {
  const sesi = await auth.ambilSesi(req.cookies?.sid);
  if (!sesi) return res.json({ pendaftar: null, panitia: null });

  if (sesi.tipe === "pendaftar") {
    const { data } = await supabase.from("pendaftar").select("id, nomor").eq("id", sesi.pendaftar_id).single();
    return res.json({ pendaftar: data || null, panitia: null });
  } else if (sesi.tipe === "admin") {
    const { data } = await supabase.from("akun_admin").select("id, nama, username").eq("id", sesi.admin_id).single();
    return res.json({ pendaftar: null, panitia: null, admin: data || null });
  } else {
    const { data } = await supabase.from("akun_panitia").select("id, nama, sekolah_id").eq("id", sesi.panitia_id).single();
    return res.json({ pendaftar: null, panitia: data ? { id: data.id, nama: data.nama, sekolahId: data.sekolah_id } : null });
  }
});

app.post("/api/auth/pendaftar/login", async (req, res) => {
  const { nomor, password } = req.body;
  if (!nomor || !password) return res.status(400).json({ error: "Nomor dan password wajib diisi." });

  const kunci = auth.kunciLogin("pendaftar", nomor, req.ip);
  const tunggu = await auth.cekBatasLogin(kunci);
  if (tunggu) return res.status(429).json({ error: `Terlalu banyak percobaan login gagal. Coba lagi dalam ${tunggu} menit.` });

  const { data: pendaftar, error } = await supabase.from("pendaftar").select("*").eq("nomor", nomor).single();
  if (error || !pendaftar || !auth.verifyPassword(password, pendaftar.password_hash)) {
    await auth.catatLoginGagal(kunci);
    return res.status(401).json({ error: "Nomor pendaftaran atau password salah." });
  }
  await auth.resetLoginGagal(kunci);

  const token = await auth.buatSesi("pendaftar", { pendaftarId: pendaftar.id });
  res.cookie("sid", token, auth.opsiCookie(req));
  res.json({ ok: true, nomor: pendaftar.nomor, nama: pendaftar.nama });
});

app.post("/api/auth/panitia/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username dan password wajib diisi." });

  const kunci = auth.kunciLogin("panitia", username, req.ip);
  const tunggu = await auth.cekBatasLogin(kunci);
  if (tunggu) return res.status(429).json({ error: `Terlalu banyak percobaan login gagal. Coba lagi dalam ${tunggu} menit.` });

  const { data: akun, error } = await supabase.from("akun_panitia").select("*").eq("username", username).single();
  if (error || !akun || !auth.verifyPassword(password, akun.password_hash)) {
    await auth.catatLoginGagal(kunci);
    return res.status(401).json({ error: "Username atau password salah." });
  }
  await auth.resetLoginGagal(kunci);

  const token = await auth.buatSesi("panitia", { panitiaId: akun.id });
  res.cookie("sid", token, auth.opsiCookie(req));
  res.json({ ok: true, nama: akun.nama, sekolahId: akun.sekolah_id });
});

app.post("/api/auth/logout", async (req, res) => {
  await auth.hapusSesi(req.cookies?.sid);
  res.clearCookie("sid", { path: "/" });
  res.json({ ok: true });
});

/* =========================================================
   TAHAPAN PPDB: buka/tutup pendaftaran (migration v6.7)
   ========================================================= */

/** { dibuka, aktif } -- aktif=false berarti tabel pengaturan belum ada (fitur tahapan belum dipasang). */
async function statusTahapan() {
  const { data, error } = await supabase.from("pengaturan").select("nilai, diubah_oleh, diubah_at").eq("kunci", "pendaftaran_dibuka").maybeSingle();
  if (error || !data) return { dibuka: true, aktif: false };
  return { dibuka: data.nilai === "true", aktif: true, diubahOleh: data.diubah_oleh, diubahAt: data.diubah_at };
}

app.get("/api/tahapan", async (req, res) => {
  res.json(await statusTahapan());
});

// Buka/tutup pendaftaran adalah wewenang Admin Dinas (berlaku untuk semua sekolah)
app.patch("/api/tahapan", auth.requireAdminLogin, async (req, res) => {
  if (typeof req.body.dibuka !== "boolean") return res.status(400).json({ error: "Nilai 'dibuka' harus true/false." });
  const { error } = await supabase.from("pengaturan").upsert({
    kunci: "pendaftaran_dibuka",
    nilai: String(req.body.dibuka),
    diubah_oleh: `${req.admin.nama} (${req.admin.username})`,
    diubah_at: new Date().toISOString(),
  });
  if (error) return res.status(500).json({ error: `Gagal mengubah tahapan (sudah jalankan migration v6.7?): ${error.message}` });
  await catatAktivitas(req, req.body.dibuka ? "Membuka pendaftaran" : "Menutup pendaftaran");
  res.json(await statusTahapan());
});

/* =========================================================
   SEKOLAH & JALUR (data publik, tidak perlu login)
   ========================================================= */
app.get("/api/sekolah", async (req, res) => {
  const { data, error } = await supabase.from("sekolah").select("*").order("id");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get("/api/jalur", async (req, res) => {
  const { data, error } = await supabase.from("jalur").select("*").order("id");
  if (error) return res.status(500).json({ error: error.message });
  // jenis selalu terisi (data sebelum migration v7.1 ditebak dari syaratnya)
  res.json(data.map((j) => ({ ...j, jenis: aturan.jenisJalur(j) })));
});

/* =========================================================
   PENDAFTAR
   ========================================================= */

app.get("/api/pendaftar", async (req, res) => {
  const { data: pendaftarList, error } = await supabase.from("pendaftar").select("*").order("id");
  if (error) return res.status(500).json({ error: error.message });

  const { data: sekolahList } = await supabase.from("sekolah").select("*");
  const namaSekolah = (id) => sekolahList.find((s) => s.id === id)?.nama || null;

  // Data publik (tanpa login): nama disamarkan karena pendaftar adalah anak di bawah umur.
  // Nama lengkap hanya bisa dilihat pendaftar sendiri dan panitia sekolah terkait.
  const rows = pendaftarList.map((p) => ({
    nomor: p.nomor, nama_samaran: samarkanNama(p.nama), status_global: p.status_global,
    prioritas_aktif: p.prioritas_aktif, sekolah_aktif_nama: namaSekolah(p.sekolah_aktif_id),
  }));
  res.json(rows);
});

/**
 * FR-11: posisi sementara pendaftar di jalur pilihan aktifnya. Pesaing = pendaftar yang sedang diproses
 * di jalur yang sama (belum diputuskan); kuota = sisa kursi setelah seleksi sebelumnya. Hanya angka ringkas
 * yang dikembalikan -- data pendaftar lain tidak pernah dikirim ke browser.
 */
const STATUS_BERSAING = ["Menunggu Verifikasi Berkas", "Menunggu Seleksi"];
async function hitungEstimasi(pendaftar, pilihanAktif, jalur) {
  if (!jalur || !STATUS_BERSAING.includes(pilihanAktif.status)) return null;
  const jenis = aturan.jenisJalur(jalur);
  if (jenis === "prestasi_nonakademik" && pendaftar.skor_nonakademik == null) return { menungguSkor: true, jenis };

  const [{ data: kandidatRaw }, { count: sudahDiterima }] = await Promise.all([
    supabase.from("pilihan").select("pendaftar_id, urutan_prioritas, skor, jarak_km, catatan_skor")
      .eq("jalur_id", jalur.id).in("status", STATUS_BERSAING),
    supabase.from("pilihan").select("id", { count: "exact", head: true }).eq("jalur_id", jalur.id).eq("status", "Diterima"),
  ]);
  const { data: infoList } = await supabase.from("pendaftar")
    .select("id, status_global, prioritas_aktif, tanggal_lahir, created_at")
    .in("id", [...new Set(kandidatRaw.map((k) => k.pendaftar_id))]);
  const info = (id) => infoList.find((x) => x.id === id);
  // sama seperti seleksi: hanya pendaftar Aktif yang memang sedang diproses di pilihan ini
  const pesaing = kandidatRaw.filter((k) => {
    const p = info(k.pendaftar_id);
    return p && p.status_global === "Aktif" && p.prioritas_aktif === k.urutan_prioritas;
  });
  const hasil = aturan.estimasiPeringkat(pendaftar.id, pesaing, jalur, info, aturan.hitungSisaKuota(jalur.kuota, sudahDiterima));
  return hasil && { ...hasil, jenis, kuota: jalur.kuota };
}

app.get("/api/pendaftar/nomor/:nomor", auth.requirePendaftarLogin, async (req, res) => {
  if (req.pendaftar.nomor !== req.params.nomor) {
    return res.status(403).json({ error: "Anda hanya dapat melihat status pendaftaran milik sendiri." });
  }

  await engine.prosesRevisiKedaluwarsa();
  const { data: pendaftar, error } = await supabase.from("pendaftar").select("*").eq("nomor", req.params.nomor).single();
  if (error || !pendaftar) return res.status(404).json({ error: "Nomor pendaftaran tidak ditemukan." });

  const [{ data: pilihanRaw }, { data: riwayatRaw }, { data: notifikasi }, { data: sekolahList }, { data: jalurList }, { data: dokumen }] = await Promise.all([
    supabase.from("pilihan").select("*").eq("pendaftar_id", pendaftar.id).order("urutan_prioritas"),
    supabase.from("riwayat_transfer").select("*").eq("pendaftar_id", pendaftar.id).order("id"),
    supabase.from("notifikasi").select("*").eq("pendaftar_id", pendaftar.id).order("id", { ascending: false }),
    supabase.from("sekolah").select("*"),
    supabase.from("jalur").select("*"),
    supabase.from("dokumen").select("*").eq("pendaftar_id", pendaftar.id).order("id"),
  ]);

  const namaSekolah = (id) => sekolahList.find((s) => s.id === id)?.nama || "-";
  const namaJalur = (id) => jalurList.find((j) => j.id === id)?.nama || "-";

  const jalurDari = (id) => jalurList.find((j) => j.id === id);
  const pilihan = pilihanRaw.map((p) => ({
    ...p, sekolah_nama: namaSekolah(p.sekolah_id), jalur_nama: namaJalur(p.jalur_id), jalur_jenis: aturan.jenisJalur(jalurDari(p.jalur_id)),
  }));
  const riwayat = riwayatRaw.map((r) => ({ ...r, dari_nama: namaSekolah(r.dari_sekolah_id), ke_nama: namaSekolah(r.ke_sekolah_id) }));

  // FR-11: estimasi posisi sementara di pilihan yang sedang diproses (gagal dihitung = tidak ditampilkan saja)
  let estimasi = null;
  const pilihanAktif = pilihanRaw.find((p) => p.urutan_prioritas === pendaftar.prioritas_aktif);
  if (pendaftar.status_global === "Aktif" && pilihanAktif) {
    estimasi = await hitungEstimasi(pendaftar, pilihanAktif, jalurDari(pilihanAktif.jalur_id))
      .catch((err) => { console.error("[estimasi]", err.message); return null; });
  }

  const { password_hash, ...pendaftarAman } = pendaftar;
  res.json({
    pendaftar: pendaftarAman, pilihan, riwayat, notifikasi, estimasi,
    dokumen: await storage.tandatanganiDokumen(dokumen),
    // semua berkas yang mungkin dibutuhkan di pilihan mana pun (bisa diunggah sejak awal)
    jenisDokumen: berkasUntukJalur(pilihanRaw.map((p) => jalurDari(p.jalur_id))),
  });
});

app.post("/api/pendaftar", async (req, res) => {
  const { nama, nik, tanggalLahir, email: emailPendaftar, password, pilihan, latitude, longitude, akurasiLokasi, alamat, nilaiRapor } = req.body;
  if (!nama || !nik || !tanggalLahir || !emailPendaftar || !password || !Array.isArray(pilihan) || pilihan.length === 0) {
    return res.status(400).json({ error: "Data pendaftaran belum lengkap (termasuk email dan password)." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password minimal 6 karakter." });
  }
  if (!(await statusTahapan()).dibuka) {
    return res.status(403).json({ error: "Pendaftaran sedang ditutup. Silakan pantau pengumuman untuk jadwal berikutnya." });
  }
  const cekUmur = validasiUmur(tanggalLahir);
  if (cekUmur) return res.status(400).json({ error: cekUmur });
  if (pilihan.length > 3) {
    return res.status(400).json({ error: "Maksimal 3 pilihan sekolah." });
  }
  const sekolahIds = pilihan.map((p) => p.sekolahId);
  if (new Set(sekolahIds).size !== sekolahIds.length) {
    return res.status(400).json({ error: "Pilihan sekolah tidak boleh duplikat." });
  }

  // Satu NIK hanya boleh mendaftar sekali (sistem sudah memberi 3 pilihan sekolah + auto-transfer).
  // Spasi dibuang supaya "3404 0112..." dan "34040112..." dianggap sama.
  const nikBersih = String(nik).replace(/\s+/g, "");
  const kunciDaftar = `daftar-ip:${req.ip || "tidak-diketahui"}`;
  const [tunggu, { data: nikTerdaftar }] = await Promise.all([
    auth.cekBatasAksi(kunciDaftar, MAKS_DAFTAR_PER_IP, JENDELA_DAFTAR_MENIT),
    supabase.from("pendaftar").select("id").eq("nik", nikBersih).limit(1),
  ]);
  if (tunggu) {
    return res.status(429).json({ error: `Terlalu banyak pendaftaran dari jaringan ini. Coba lagi dalam ${tunggu} menit.` });
  }
  if (nikTerdaftar?.length) {
    return res.status(409).json({ error: PESAN_NIK_TERDAFTAR });
  }

  const lokasiAda = typeof latitude === "number" && typeof longitude === "number"
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  const nilai = nilaiRapor === null || nilaiRapor === undefined || nilaiRapor === "" ? null : Number(nilaiRapor);
  if (nilai !== null && (!Number.isFinite(nilai) || nilai < 0 || nilai > 100)) {
    return res.status(400).json({ error: "Nilai rapor harus berupa angka 0–100." });
  }

  const [{ data: sekolahDipilih }, { data: jalurDipilih }] = await Promise.all([
    supabase.from("sekolah").select("id, latitude, longitude").in("id", sekolahIds),
    supabase.from("jalur").select("*").in("id", pilihan.map((p) => p.jalurId)),
  ]);

  // Skor tiap pilihan sesuai jalur SPMB:
  //  domisili/afirmasi/mutasi -> jarak GPS (skor hanya konversi jarak), prestasi akademik -> nilai rapor,
  //  prestasi nonakademik -> diberi panitia setelah memeriksa sertifikat
  const skorPilihan = [];
  for (const p of pilihan) {
    const jalur = jalurDipilih.find((j) => j.id === p.jalurId);
    const sekolah = sekolahDipilih.find((s) => s.id === p.sekolahId);
    if (!jalur || !sekolah || jalur.sekolah_id !== p.sekolahId) {
      return res.status(400).json({ error: "Kombinasi sekolah dan jalur tidak valid." });
    }
    const jenis = aturan.jenisJalur(jalur);

    if (aturan.JENIS_JALUR[jenis].urut === "jarak") {
      if (!lokasiAda) {
        skorPilihan.push({ skor: 0, jarak_km: null, catatan_skor: "Lokasi tidak tersedia" });
      } else if (sekolah.latitude == null || sekolah.longitude == null) {
        skorPilihan.push({ skor: 0, jarak_km: null, catatan_skor: "Koordinat sekolah belum diatur" });
      } else {
        const jarak = zonasi.hitungJarakKm(latitude, longitude, Number(sekolah.latitude), Number(sekolah.longitude));
        skorPilihan.push({ skor: Math.round(zonasi.skorDariJarak(jarak)), jarak_km: Number(jarak.toFixed(2)), catatan_skor: null });
      }
    } else if (jenis === "prestasi_akademik") {
      if (nilai === null) {
        return res.status(400).json({ error: `Nilai rapor wajib diisi untuk jalur ${jalur.nama}.` });
      }
      skorPilihan.push({ skor: Math.round(nilai), jarak_km: null, catatan_skor: null });
    } else {
      skorPilihan.push({ skor: 0, jarak_km: null, catatan_skor: "Menunggu skor dari panitia" });
    }
  }


  // Kategori jalur khusus (afirmasi/mutasi/prestasi nonakademik) wajib sesuai jalur yang dipilih
  const kategori = aturan.validasiKategoriJalur(jalurDipilih.map((j) => aturan.jenisJalur(j)), req.body);
  if (kategori.error) return res.status(400).json({ error: kategori.error });
  // Hanya kolom yang terisi yang dikirim, supaya pendaftaran jalur biasa tetap jalan walau migration v7.2 belum dijalankan
  const kolomKategori = Object.fromEntries(Object.entries(kategori.data).filter(([, v]) => v != null));

  // FR-09: Pra-Verifikasi NIK -- hanya flag, tidak menolak pendaftaran
  const catatanNik = validasi.validasiNIK(nikBersih);

  const alamatBersih = typeof alamat === "string" && alamat.trim() ? alamat.trim() : null;

  const { data: pendaftarBaru, error: err1 } = await supabase
    .from("pendaftar")
    .insert({
      // nomor tidak dikirim: diisi otomatis oleh sequence database (migration v6.3)
      nama, nik: nikBersih, tanggal_lahir: tanggalLahir,
      email: emailPendaftar,
      password_hash: auth.hashPassword(password),
      status_berkas: "Menunggu Verifikasi", status_global: "Aktif",
      sekolah_aktif_id: pilihan[0].sekolahId, prioritas_aktif: 1,
      catatan_validasi_nik: catatanNik,
      latitude: lokasiAda ? latitude : null,
      longitude: lokasiAda ? longitude : null,
      akurasi_lokasi_m: lokasiAda && typeof akurasiLokasi === "number" ? Math.round(akurasiLokasi) : null,
      alamat: alamatBersih,
      nilai_rapor: nilai,
      nilai_rapor_awal: nilai,
      ...kolomKategori,
    })
    .select()
    .single();
  if (err1) {
    // Dua pendaftaran dengan NIK sama dikirim bersamaan: ditahan unique index (migration v6.9)
    if (err1.code === "23505" && /nik/i.test(err1.message)) return res.status(409).json({ error: PESAN_NIK_TERDAFTAR });
    return res.status(500).json({ error: err1.message });
  }
  await auth.catatAksi(kunciDaftar);

  const rows = pilihan.map((p, i) => ({
    pendaftar_id: pendaftarBaru.id,
    sekolah_id: p.sekolahId,
    urutan_prioritas: i + 1,
    jalur_id: p.jalurId,
    ...skorPilihan[i],
    status: i === 0 ? "Menunggu Verifikasi Berkas" : "Menunggu Giliran",
  }));
  // Simpan pilihan dan buat sesi login (otomatis login supaya bisa langsung unggah berkas) secara paralel
  const [{ error: err2 }, token] = await Promise.all([
    supabase.from("pilihan").insert(rows),
    auth.buatSesi("pendaftar", { pendaftarId: pendaftarBaru.id }),
  ]);
  if (err2) return res.status(500).json({ error: err2.message });
  res.cookie("sid", token, auth.opsiCookie(req));

  res.status(201).json({ nomor: pendaftarBaru.nomor, id: pendaftarBaru.id, jenisDokumen: berkasUntukJalur(jalurDipilih) });

  // Pra-Verifikasi alamat vs GPS dijalankan SETELAH respons terkirim, supaya pendaftar tidak
  // menunggu layanan peta (1–7 detik). Hasilnya hanya flag untuk panitia, tidak menolak pendaftaran.
  // waitUntil: di Vercel, fungsi tetap hidup sampai proses ini selesai (di localhost tidak berpengaruh).
  if (lokasiAda && alamatBersih) {
    waitUntil(validasi
      .validasiAlamat(alamatBersih, latitude, longitude)
      .then((cek) =>
        supabase
          .from("pendaftar")
          .update({
            alamat_latitude: cek.latitude ?? null,
            alamat_longitude: cek.longitude ?? null,
            alamat_presisi: cek.presisi ?? null,
            catatan_validasi_alamat: cek.catatan ?? null,
          })
          .eq("id", pendaftarBaru.id)
      )
      .catch((err) => console.error("[alamat] Cek alamat gagal:", err.message)));
  }
});

app.post("/api/pendaftar/:id/dokumen", auth.requirePendaftarLogin, upload.single("file"), async (req, res) => {
  const pendaftarId = Number(req.params.id);
  if (req.pendaftar.id !== pendaftarId) {
    return res.status(403).json({ error: "Anda hanya dapat mengunggah berkas milik sendiri." });
  }
  const { jenis } = req.body;
  if (!req.file) return res.status(400).json({ error: "File tidak ditemukan." });
  // Jenis berkas yang boleh diunggah = berkas dasar + berkas tambahan dari semua jalur yang dipilih pendaftar
  const [{ data: pilihanSaya }, { data: semuaJalur }] = await Promise.all([
    supabase.from("pilihan").select("jalur_id").eq("pendaftar_id", pendaftarId),
    supabase.from("jalur").select("*"),
  ]);
  const jenisBoleh = berkasUntukJalur((pilihanSaya || []).map((p) => (semuaJalur || []).find((j) => j.id === p.jalur_id)));
  if (!jenisBoleh.includes(jenis)) return res.status(400).json({ error: "Jenis dokumen tidak dikenal untuk jalur yang Anda pilih." });
  if (!TIPE_FILE_DIIZINKAN.includes(req.file.mimetype)) {
    return res.status(400).json({ error: "Format file harus PDF, JPG, atau PNG." });
  }

  await engine.prosesRevisiKedaluwarsa();
  const { data: pendaftar } = await supabase.from("pendaftar").select("status_global, status_berkas").eq("id", pendaftarId).single();
  if (!pendaftar || pendaftar.status_global !== "Aktif") {
    return res.status(409).json({ error: "Pendaftaran sudah selesai diproses, berkas tidak dapat diubah lagi." });
  }
  if (pendaftar.status_berkas === "Lengkap") {
    return res.status(409).json({ error: "Berkas sudah diverifikasi Lengkap oleh panitia, tidak dapat diganti." });
  }

  try {
    const { data: berkasLama } = await supabase.from("dokumen").select("id, url").eq("pendaftar_id", pendaftarId).eq("jenis", jenis);
    const url = await storage.uploadBerkas(pendaftarId, jenis, req.file);
    // FR-09: Pra-Verifikasi Berkas -- hanya flag, panitia yang tetap memutuskan
    const catatanValidasi = validasi.validasiBerkas(req.file);
    const { data, error } = await supabase
      .from("dokumen")
      .insert({ pendaftar_id: pendaftarId, jenis, nama_file: req.file.originalname, url, catatan_validasi: catatanValidasi })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    // Berkas baru berhasil disimpan -- hapus versi lama dengan jenis yang sama
    if (berkasLama?.length) {
      await supabase.from("dokumen").delete().in("id", berkasLama.map((d) => d.id));
      await storage.hapusBerkas(berkasLama.map((d) => d.url));
    }

    // Berkas diunggah ulang saat "Kurang Lengkap" -> kembali ke antrean verifikasi panitia
    await engine.tandaiSudahRevisi(pendaftarId);

    const [dokumenTertanda] = await storage.tandatanganiDokumen([data]);
    res.status(201).json(dokumenTertanda);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================================================
   PANEL PANITIA (wajib login panitia)
   ========================================================= */

app.patch("/api/pendaftar/:id/berkas", auth.requirePanitiaLogin, async (req, res) => {
  const pendaftarId = Number(req.params.id);
  if (!["Lengkap", "Kurang Lengkap", "Ditolak"].includes(req.body.status)) {
    return res.status(400).json({ error: "Status verifikasi tidak dikenal." });
  }
  const { data: pendaftar } = await supabase.from("pendaftar").select("*").eq("id", pendaftarId).single();
  if (!pendaftar || pendaftar.sekolah_aktif_id !== req.panitia.sekolahId) {
    return res.status(403).json({ error: "Pendaftar ini tidak sedang aktif di sekolah Anda." });
  }
  // Pendaftar yang sudah final (diterima / tidak diterima) tidak boleh diubah lagi status berkasnya --
  // mengubah pilihan "Diterima" kembali ke "Menunggu Seleksi" akan membuat kuota terlampaui
  if (pendaftar.status_global !== "Aktif") {
    return res.status(409).json({ error: "Pendaftaran ini sudah selesai diproses; status berkas tidak dapat diubah lagi." });
  }
  if (req.body.status === "Lengkap") {
    const jalurAktif = await jalurAktifPendaftar(pendaftarId, pendaftar.prioritas_aktif);
    const { data: dokumen } = await supabase.from("dokumen").select("jenis").eq("pendaftar_id", pendaftarId);
    const belumAda = berkasUntukJalur([jalurAktif]).filter((j) => !(dokumen || []).some((d) => d.jenis === j));
    if (belumAda.length) {
      return res.status(409).json({
        error: `Belum bisa ditandai Lengkap: ${belumAda.join(", ")} belum diunggah. Gunakan tombol "Kurang" untuk meminta pendaftar melengkapi berkas.`,
      });
    }
    if (aturan.jenisJalur(jalurAktif) === "prestasi_nonakademik" && pendaftar.skor_nonakademik == null) {
      return res.status(409).json({ error: "Beri skor prestasi nonakademik (0–100) dari sertifikat terlebih dahulu, lalu tandai Lengkap." });
    }
  }
  const catatan = typeof req.body.catatan === "string" ? req.body.catatan.trim().slice(0, 500) : null;
  await engine.verifikasiBerkas(pendaftarId, req.body.status, catatan || null);
  await catatAktivitas(req, `Verifikasi berkas: ${req.body.status}`, { pendaftarId, detail: catatan || null });
  res.json({ ok: true });
});

app.patch("/api/pendaftar/:id/nilai-rapor", auth.requirePanitiaLogin, async (req, res) => {
  const pendaftarId = Number(req.params.id);
  const nilaiBaru = Number(req.body.nilaiRapor);
  if (req.body.nilaiRapor === "" || req.body.nilaiRapor == null || !Number.isFinite(nilaiBaru) || nilaiBaru < 0 || nilaiBaru > 100) {
    return res.status(400).json({ error: "Nilai rapor harus berupa angka 0–100." });
  }

  const { data: pendaftar } = await supabase
    .from("pendaftar")
    .select("sekolah_aktif_id, status_global, nilai_rapor, nilai_rapor_awal")
    .eq("id", pendaftarId)
    .single();
  if (!pendaftar || pendaftar.sekolah_aktif_id !== req.panitia.sekolahId) {
    return res.status(403).json({ error: "Pendaftar ini tidak sedang aktif di sekolah Anda." });
  }
  if (pendaftar.status_global !== "Aktif") {
    return res.status(409).json({ error: "Pendaftaran sudah selesai diproses, nilai tidak dapat dikoreksi." });
  }

  await supabase
    .from("pendaftar")
    .update({
      nilai_rapor: nilaiBaru,
      // nilai asli isian pendaftar tetap disimpan untuk jejak audit
      nilai_rapor_awal: pendaftar.nilai_rapor_awal ?? pendaftar.nilai_rapor,
      nilai_rapor_dikoreksi_oleh: `${req.panitia.nama} (${req.panitia.username})`,
      nilai_rapor_dikoreksi_at: new Date().toISOString(),
    })
    .eq("id", pendaftarId);

  // Perbarui skor di pilihan jalur prestasi yang belum diputuskan (termasuk pilihan cadangan)
  const { data: semuaJalur } = await supabase.from("jalur").select("*");
  const jalurPrestasi = semuaJalur.filter((j) => aturan.jenisJalur(j) === "prestasi_akademik");
  const { data: diperbarui } = await supabase
    .from("pilihan")
    .update({ skor: Math.round(nilaiBaru) })
    .eq("pendaftar_id", pendaftarId)
    .in("jalur_id", jalurPrestasi.map((j) => j.id))
    .in("status", ["Menunggu Giliran", "Menunggu Verifikasi Berkas", "Menunggu Seleksi"])
    .select("id");

  const nilaiLama = pendaftar.nilai_rapor ?? "-";
  await catatAktivitas(req, "Koreksi nilai rapor", { pendaftarId, detail: pendaftar.nilai_rapor == null ? `diisi ${nilaiBaru}` : `${nilaiLama} → ${nilaiBaru}` });
  await engine.tambahNotifikasi(
    pendaftarId,
    `Nilai rapor Anda dikoreksi panitia dari ${nilaiLama} menjadi ${nilaiBaru} sesuai berkas rapor yang diunggah.`
  );

  res.json({ ok: true, pilihanDiperbarui: diperbarui?.length || 0 });
});

// Jalur Prestasi Nonakademik: panitia memberi skor 0–100 setelah memeriksa sertifikat (lomba, OSIS, pramuka, dll.)
app.patch("/api/pendaftar/:id/skor-nonakademik", auth.requirePanitiaLogin, async (req, res) => {
  const pendaftarId = Number(req.params.id);
  const skor = Number(req.body.skor);
  if (req.body.skor === "" || req.body.skor == null || !Number.isFinite(skor) || skor < 0 || skor > 100) {
    return res.status(400).json({ error: "Skor harus berupa angka 0–100." });
  }
  const { data: pendaftar } = await supabase.from("pendaftar").select("*").eq("id", pendaftarId).single();
  if (!pendaftar || pendaftar.sekolah_aktif_id !== req.panitia.sekolahId) {
    return res.status(403).json({ error: "Pendaftar ini tidak sedang aktif di sekolah Anda." });
  }
  if (pendaftar.status_global !== "Aktif") {
    return res.status(409).json({ error: "Pendaftaran sudah selesai diproses, skor tidak dapat diubah." });
  }
  const jalurAktif = await jalurAktifPendaftar(pendaftarId, pendaftar.prioritas_aktif);
  if (aturan.jenisJalur(jalurAktif) !== "prestasi_nonakademik") {
    return res.status(409).json({ error: "Pilihan yang sedang diproses bukan jalur Prestasi Nonakademik." });
  }

  const { error } = await supabase.from("pendaftar").update({
    skor_nonakademik: skor,
    skor_nonakademik_oleh: `${req.panitia.nama} (${req.panitia.username})`,
    skor_nonakademik_at: new Date().toISOString(),
  }).eq("id", pendaftarId);
  if (error) return res.status(500).json({ error: `Gagal menyimpan skor (sudah jalankan migration v7.1?): ${error.message}` });

  // Skor berlaku untuk pilihan aktif (jalur prestasi nonakademik di sekolah ini)
  await supabase.from("pilihan").update({ skor: Math.round(skor), catatan_skor: null })
    .eq("pendaftar_id", pendaftarId).eq("urutan_prioritas", pendaftar.prioritas_aktif);
  await catatAktivitas(req, "Skor prestasi nonakademik", { pendaftarId, detail: pendaftar.skor_nonakademik == null ? `diberi ${skor}` : `${pendaftar.skor_nonakademik} → ${skor}` });
  await engine.tambahNotifikasi(pendaftarId, `Panitia memberi skor prestasi nonakademik ${skor} berdasarkan sertifikat yang Anda unggah.`);
  res.json({ ok: true });
});

app.get("/api/sekolah/:id/antrean", auth.requirePanitiaLogin, async (req, res) => {
  const sekolahId = Number(req.params.id);
  if (sekolahId !== req.panitia.sekolahId) {
    return res.status(403).json({ error: "Anda hanya dapat melihat antrean sekolah Anda sendiri." });
  }
  await engine.prosesRevisiKedaluwarsa();

  const { data: pendaftarAktif, error } = await supabase
    .from("pendaftar")
    .select("*")
    .eq("sekolah_aktif_id", sekolahId)
    .eq("status_global", "Aktif")
    .order("id");
  if (error) return res.status(500).json({ error: error.message });

  // Ambil pilihan, dokumen, dan jalur untuk SEMUA pendaftar sekaligus (bukan per pendaftar),
  // supaya jumlah query tetap walau antrean panjang -- penting di Vercel yang tiap query-nya lewat jaringan.
  const ids = pendaftarAktif.map((p) => p.id);
  const [{ data: jalurList }, { data: semuaPilihan }, { data: semuaDokumen }] = await Promise.all([
    supabase.from("jalur").select("*"),
    ids.length ? supabase.from("pilihan").select("*").in("pendaftar_id", ids) : { data: [] },
    ids.length ? supabase.from("dokumen").select("*").in("pendaftar_id", ids).order("id") : { data: [] },
  ]);
  const dokumenTertanda = await storage.tandatanganiDokumen(semuaDokumen || []);
  const namaJalur = (id) => jalurList.find((j) => j.id === id)?.nama || "-";

  const rows = [];
  for (const p of pendaftarAktif) {
    const pil = semuaPilihan.find((x) => x.pendaftar_id === p.id && x.urutan_prioritas === p.prioritas_aktif);
    if (!pil) continue;
    const dokumen = dokumenTertanda.filter((d) => d.pendaftar_id === p.id);
    const jalurAktif = jalurList.find((j) => j.id === pil.jalur_id);
    const berkasWajib = berkasUntukJalur([jalurAktif]);

    rows.push({
      pendaftar_id: p.id, nomor: p.nomor, nama: p.nama, nik: p.nik,
      nilai_rapor: p.nilai_rapor, nilai_rapor_awal: p.nilai_rapor_awal,
      nilai_rapor_dikoreksi_oleh: p.nilai_rapor_dikoreksi_oleh,
      status_berkas: p.status_berkas, prioritas_aktif: p.prioritas_aktif,
      pilihan_id: pil.id, jalur_id: pil.jalur_id, skor: pil.skor,
      status_pilihan: pil.status, jalur_nama: namaJalur(pil.jalur_id),
      jarak_km: pil.jarak_km, catatan_skor: pil.catatan_skor,
      syarat_radius_km: jalurAktif?.syarat_radius_km ?? null,
      syarat_nilai_minimum: jalurAktif?.syarat_nilai_minimum ?? null,
      jalur_jenis: aturan.jenisJalur(jalurAktif),
      skor_nonakademik: p.skor_nonakademik ?? null, skor_nonakademik_oleh: p.skor_nonakademik_oleh ?? null,
      kategori_afirmasi: p.kategori_afirmasi ?? null, kategori_mutasi: p.kategori_mutasi ?? null,
      keterangan_prestasi: p.keterangan_prestasi ?? null,
      dokumen,
      berkas_wajib: berkasWajib,
      berkas_belum_ada: berkasWajib.filter((j) => !dokumen.some((d) => d.jenis === j)),
      catatan_validasi_nik: p.catatan_validasi_nik,
      batas_revisi_at: p.batas_revisi_at, catatan_revisi: p.catatan_revisi,
      alamat: p.alamat, latitude: p.latitude, longitude: p.longitude, akurasi_lokasi_m: p.akurasi_lokasi_m,
      alamat_latitude: p.alamat_latitude, alamat_longitude: p.alamat_longitude, alamat_presisi: p.alamat_presisi,
      catatan_validasi_alamat: p.catatan_validasi_alamat,
    });
  }
  res.json(rows);
});

app.post("/api/jalur/:id/jalankan-seleksi", auth.requirePanitiaLogin, async (req, res) => {
  const jalurId = Number(req.params.id);

  const { data: jalur } = await supabase.from("jalur").select("sekolah_id, nama").eq("id", jalurId).single();
  if (!jalur || jalur.sekolah_id !== req.panitia.sekolahId) {
    return res.status(403).json({ error: "Jalur ini bukan milik sekolah Anda." });
  }

  const tahapan = await statusTahapan();
  if (tahapan.aktif && tahapan.dibuka) {
    return res.status(409).json({
      error: "Pendaftaran masih dibuka. Tutup pendaftaran terlebih dahulu sebelum menjalankan seleksi, supaya semua pendaftar ikut dibandingkan secara adil.",
    });
  }

  const kunci = await ambilKunciSeleksi(jalurId, `${req.panitia.nama} (${req.panitia.username})`);
  if (!kunci) {
    return res.status(409).json({ error: "Seleksi untuk jalur ini sedang diproses. Tunggu sebentar sebelum mencoba lagi." });
  }

  try {
    await engine.prosesRevisiKedaluwarsa();
    const hasil = await engine.jalankanSeleksiJalur(jalurId);
    await catatAktivitas(req, `Menjalankan seleksi jalur ${jalur.nama}`, {
      detail: `${hasil.jumlahDiproses} diproses: ${hasil.diterima} diterima, ${hasil.ditolakKuota} tidak masuk kuota, ${hasil.ditolakSyarat} tidak memenuhi syarat`,
    });
    res.json({ ok: true, ...hasil });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await lepasKunciSeleksi(jalurId, kunci);
  }
});

/* =========================================================
   LUPA PASSWORD PENDAFTAR (migration v6.8)
   ========================================================= */
const MENIT_BERLAKU_RESET = 30;
const hashToken = (t) => crypto.createHash("sha256").update(t).digest("hex");

app.post("/api/auth/lupa-password", async (req, res) => {
  const nomor = String(req.body.nomor || "").trim();
  const emailInput = String(req.body.email || "").trim().toLowerCase();
  if (!nomor || !emailInput) return res.status(400).json({ error: "Nomor pendaftaran dan email wajib diisi." });

  // Pesan selalu sama, supaya orang lain tidak bisa menebak nomor/email mana yang terdaftar
  const pesanUmum = "Jika nomor pendaftaran dan email cocok, link untuk membuat password baru sudah dikirim ke email tersebut (cek juga folder Spam). Link berlaku 30 menit.";

  const kunci = auth.kunciLogin("reset", nomor, req.ip);
  const tunggu = await auth.cekBatasLogin(kunci);
  if (tunggu) return res.status(429).json({ error: `Terlalu banyak permintaan. Coba lagi dalam ${tunggu} menit.` });
  await auth.catatLoginGagal(kunci); // setiap permintaan dihitung, supaya tidak bisa dipakai untuk spam email

  const { data: pendaftar } = await supabase.from("pendaftar").select("id, nama, nomor, email").eq("nomor", nomor).maybeSingle();
  if (!pendaftar || String(pendaftar.email || "").toLowerCase() !== emailInput) return res.json({ ok: true, pesan: pesanUmum });

  const token = crypto.randomBytes(32).toString("hex");
  const { error } = await supabase.from("reset_password").insert({
    token_hash: hashToken(token),
    pendaftar_id: pendaftar.id,
    kadaluarsa_at: new Date(Date.now() + MENIT_BERLAKU_RESET * 60 * 1000).toISOString(),
  });
  if (error) return res.status(500).json({ error: `Gagal membuat link reset (sudah jalankan migration v6.8?): ${error.message}` });

  // Alamat situs diambil dari pengaturan server, BUKAN dari header Host kiriman browser
  // (header Host bisa dipalsukan sehingga link reset mengarah ke situs penyerang).
  const link = `${alamatSitus()}/reset.html?token=${token}`;
  const hasil = await email.kirimEmail(
    pendaftar.email,
    `Buat Password Baru — ${pendaftar.nomor} - SiPPDB`,
    `Halo <strong>${escHtml(pendaftar.nama)}</strong>,<br><br>` +
      `Kami menerima permintaan untuk membuat password baru akun pendaftaran <strong>${escHtml(pendaftar.nomor)}</strong>.<br><br>` +
      `<a href="${link}" style="display:inline-block;background:#1B3358;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Buat Password Baru</a><br><br>` +
      `Link ini berlaku ${MENIT_BERLAKU_RESET} menit dan hanya bisa dipakai sekali. Jika Anda tidak merasa meminta, abaikan email ini — password Anda tidak berubah.`
  );
  if (!hasil.terkirim) console.error("[reset] Email reset gagal dikirim:", hasil.alasan);
  res.json({ ok: true, pesan: pesanUmum });
});

app.post("/api/auth/reset-password", async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: "Data tidak lengkap." });
  if (String(password).length < 6) return res.status(400).json({ error: "Password minimal 6 karakter." });

  const { data: baris } = await supabase.from("reset_password").select("*").eq("token_hash", hashToken(String(token))).maybeSingle();
  if (!baris || baris.dipakai_at || new Date(baris.kadaluarsa_at) < new Date()) {
    return res.status(400).json({ error: "Link sudah tidak berlaku (kedaluwarsa atau sudah dipakai). Silakan minta link baru." });
  }

  await supabase.from("pendaftar").update({ password_hash: auth.hashPassword(password) }).eq("id", baris.pendaftar_id);
  await supabase.from("reset_password").update({ dipakai_at: new Date().toISOString() }).eq("token_hash", baris.token_hash);
  await auth.hapusSesiPendaftar(baris.pendaftar_id); // keluarkan sesi lama di perangkat lain

  const { data: p } = await supabase.from("pendaftar").select("nomor").eq("id", baris.pendaftar_id).single();
  await engine.tambahNotifikasi(baris.pendaftar_id, "Password akun pendaftaran Anda baru saja diganti. Jika bukan Anda yang menggantinya, segera hubungi panitia.");
  res.json({ ok: true, nomor: p?.nomor });
});

/* =========================================================
   STATISTIK & EXPORT (panel panitia)
   ========================================================= */

/** Ringkasan per jalur dari baris-baris pilihan */
function hitungStatistikJalur(jalur, pilihanJalur) {
  const hitung = (status) => pilihanJalur.filter((p) => p.status === status).length;
  const diterima = hitung("Diterima");
  return {
    jalur_id: jalur.id,
    nama: jalur.nama,
    jenis: aturan.jenisJalur(jalur),
    kuota: jalur.kuota,
    syarat_radius_km: jalur.syarat_radius_km,
    syarat_nilai_minimum: jalur.syarat_nilai_minimum,
    peminat: pilihanJalur.length,
    menunggu_verifikasi: hitung("Menunggu Verifikasi Berkas"),
    menunggu_seleksi: hitung("Menunggu Seleksi"),
    cadangan: hitung("Menunggu Giliran"),
    diterima,
    ditolak: hitung("Ditolak"),
    sisa_kuota: Math.max(0, jalur.kuota - diterima),
  };
}

app.get("/api/sekolah/:id/statistik", auth.requirePanitiaLogin, async (req, res) => {
  const sekolahId = Number(req.params.id);
  if (sekolahId !== req.panitia.sekolahId) return res.status(403).json({ error: "Hanya untuk sekolah Anda sendiri." });

  const [{ data: jalurList }, { data: pilihan }] = await Promise.all([
    supabase.from("jalur").select("*").eq("sekolah_id", sekolahId).order("id"),
    supabase.from("pilihan").select("jalur_id, status").eq("sekolah_id", sekolahId),
  ]);
  res.json(jalurList.map((j) => hitungStatistikJalur(j, pilihan.filter((p) => p.jalur_id === j.id))));
});

// Excel berbahasa Indonesia memakai koma sebagai pemisah desimal (3.36 bisa terbaca sebagai tanggal)
const desimalId = (v) => (v == null || v === "" ? "" : String(v).replace(".", ","));

/** CSV yang langsung rapi dibuka di Excel versi Indonesia (pemisah titik koma + BOM UTF-8) */
const LABEL_KATEGORI = { ...aturan.KATEGORI_AFIRMASI, ...aturan.KATEGORI_MUTASI };

function keCsv(baris) {
  const sel = (v) => {
    let s = v == null ? "" : String(v);
    // Cegah CSV injection: teks isian yang diawali = + - @ dijalankan Excel sebagai rumus.
    // Diberi awalan ' supaya tampil sebagai teks biasa. Angka (mis. -7,69) dibiarkan.
    if (typeof v === "string" && /^[=+\-@\t\r]./s.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + baris.map((r) => r.map(sel).join(";")).join("\r\n");
}

/**
 * Log aktivitas untuk panitia. Tanpa ?pendaftar: semua aktivitas di sekolah ini.
 * Dengan ?pendaftar=ID: riwayat keputusan pendaftar itu di semua sekolah (mis. alasan ditolak di pilihan 1),
 * hanya boleh untuk pendaftar yang sedang aktif di sekolah panitia.
 */
app.get("/api/sekolah/:id/log-aktivitas", auth.requirePanitiaLogin, async (req, res) => {
  const sekolahId = Number(req.params.id);
  if (sekolahId !== req.panitia.sekolahId) return res.status(403).json({ error: "Hanya untuk sekolah Anda sendiri." });

  let query = supabase.from("log_aktivitas").select("*").order("waktu", { ascending: false });
  if (req.query.pendaftar) {
    const pendaftarId = Number(req.query.pendaftar);
    const { data: p } = await supabase.from("pendaftar").select("sekolah_aktif_id").eq("id", pendaftarId).single();
    if (!p || p.sekolah_aktif_id !== sekolahId) return res.status(403).json({ error: "Pendaftar ini tidak sedang aktif di sekolah Anda." });
    query = query.eq("pendaftar_id", pendaftarId).limit(50);
  } else {
    query = query.eq("sekolah_id", sekolahId).limit(100);
  }
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: `Log belum tersedia (sudah jalankan migration v7.3?): ${error.message}` });
  res.json(await lengkapiLog(data));
});

/** Tambahkan nama sekolah & nomor pendaftar ke baris log (untuk ditampilkan) */
async function lengkapiLog(baris) {
  const idPendaftar = [...new Set(baris.map((l) => l.pendaftar_id).filter(Boolean))];
  const [{ data: sekolahList }, { data: pendaftarList }] = await Promise.all([
    supabase.from("sekolah").select("id, nama"),
    idPendaftar.length ? supabase.from("pendaftar").select("id, nomor, nama").in("id", idPendaftar) : { data: [] },
  ]);
  return baris.map((l) => {
    const p = pendaftarList.find((x) => x.id === l.pendaftar_id);
    return {
      ...l,
      sekolah_nama: sekolahList.find((s) => s.id === l.sekolah_id)?.nama || null,
      pendaftar_nomor: p?.nomor || null, pendaftar_nama: p?.nama || null,
    };
  });
}

app.get("/api/sekolah/:id/export.csv", auth.requirePanitiaLogin, async (req, res) => {
  const sekolahId = Number(req.params.id);
  if (sekolahId !== req.panitia.sekolahId) return res.status(403).json({ error: "Hanya untuk sekolah Anda sendiri." });

  const [{ data: sekolah }, { data: jalurList }, { data: pilihan }] = await Promise.all([
    supabase.from("sekolah").select("nama").eq("id", sekolahId).single(),
    supabase.from("jalur").select("id, nama").eq("sekolah_id", sekolahId),
    supabase.from("pilihan").select("*").eq("sekolah_id", sekolahId).order("id"),
  ]);
  const ids = [...new Set(pilihan.map((p) => p.pendaftar_id))];
  const { data: pendaftarList } = ids.length
    ? await supabase.from("pendaftar").select("*").in("id", ids)
    : { data: [] };

  const header = [
    "Nomor", "Nama", "NIK", "Tanggal Lahir", "Email", "Alamat", "Pilihan Ke-", "Jalur", "Jarak (km)", "Skor",
    "Nilai Rapor", "Kategori Afirmasi", "Kategori Mutasi", "Keterangan Prestasi", "Skor Nonakademik",
    "Status di Sekolah Ini", "Alasan Penolakan", "Status Berkas", "Status Akhir", "Waktu Daftar",
  ];
  const baris = pilihan.map((pl) => {
    const p = pendaftarList.find((x) => x.id === pl.pendaftar_id) || {};
    return [
      p.nomor, p.nama, p.nik, p.tanggal_lahir, p.email, p.alamat, pl.urutan_prioritas,
      jalurList.find((j) => j.id === pl.jalur_id)?.nama, desimalId(pl.jarak_km), pl.skor, desimalId(p.nilai_rapor),
      LABEL_KATEGORI[p.kategori_afirmasi] || p.kategori_afirmasi, LABEL_KATEGORI[p.kategori_mutasi] || p.kategori_mutasi,
      p.keterangan_prestasi, p.skor_nonakademik,
      pl.status, pl.alasan_penolakan, p.status_berkas, p.status_global,
      p.created_at ? String(p.created_at).slice(0, 19).replace("T", " ") : "",
    ];
  });

  const namaFile = `pendaftar-${String(sekolah?.nama || "sekolah").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${namaFile}"`);
  await catatAktivitas(req, "Mengunduh data pendaftar (CSV)", { detail: `${baris.length} baris` });
  res.send(keCsv([header, ...baris]));
});

/* =========================================================
   ADMIN DINAS (migration v6.8) -- halaman /admin.html
   ========================================================= */

app.post("/api/auth/admin/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username dan password wajib diisi." });

  const kunci = auth.kunciLogin("admin", username, req.ip);
  const tunggu = await auth.cekBatasLogin(kunci);
  if (tunggu) return res.status(429).json({ error: `Terlalu banyak percobaan login gagal. Coba lagi dalam ${tunggu} menit.` });

  const { data: akun, error } = await supabase.from("akun_admin").select("*").eq("username", username).maybeSingle();
  if (error) return res.status(500).json({ error: `Tabel admin belum ada (jalankan migration v6.8): ${error.message}` });
  if (!akun || !auth.verifyPassword(password, akun.password_hash)) {
    await auth.catatLoginGagal(kunci);
    return res.status(401).json({ error: "Username atau password salah." });
  }
  await auth.resetLoginGagal(kunci);

  const token = await auth.buatSesi("admin", { adminId: akun.id });
  res.cookie("sid", token, auth.opsiCookie(req));
  res.json({ ok: true, nama: akun.nama });
});

/** Ringkasan seluruh sekolah untuk dashboard admin */
app.get("/api/admin/ringkasan", auth.requireAdminLogin, async (req, res) => {
  const [{ data: sekolahList }, { data: jalurList }, { data: pilihan }, { data: panitia }, { data: pendaftar }] = await Promise.all([
    supabase.from("sekolah").select("*").order("id"),
    supabase.from("jalur").select("*").order("id"),
    supabase.from("pilihan").select("jalur_id, status"),
    supabase.from("akun_panitia").select("id, username, nama, sekolah_id").order("id"),
    supabase.from("pendaftar").select("status_global"),
  ]);
  const hitungGlobal = (s) => pendaftar.filter((p) => p.status_global === s).length;

  res.json({
    total: {
      pendaftar: pendaftar.length,
      aktif: hitungGlobal("Aktif"),
      diterima: hitungGlobal("Diterima Final"),
      tidakDiterima: hitungGlobal("Tidak Diterima Final"),
      sekolah: sekolahList.length,
    },
    tahapan: await statusTahapan(),
    sekolah: sekolahList.map((s) => ({
      ...s,
      jalur: jalurList.filter((j) => j.sekolah_id === s.id).map((j) => hitungStatistikJalur(j, pilihan.filter((p) => p.jalur_id === j.id))),
      panitia: panitia.filter((a) => a.sekolah_id === s.id),
    })),
  });
});

const angkaAtauNull = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

app.get("/api/admin/log-aktivitas", auth.requireAdminLogin, async (req, res) => {
  let query = supabase.from("log_aktivitas").select("*").order("waktu", { ascending: false }).limit(150);
  if (req.query.sekolah) query = query.eq("sekolah_id", Number(req.query.sekolah));
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: `Log belum tersedia (sudah jalankan migration v7.3?): ${error.message}` });
  res.json(await lengkapiLog(data));
});

app.patch("/api/admin/jalur/:id", auth.requireAdminLogin, async (req, res) => {
  const kuota = Number(req.body.kuota);
  const radius = angkaAtauNull(req.body.syarat_radius_km);
  const nilaiMin = angkaAtauNull(req.body.syarat_nilai_minimum);
  if (!Number.isInteger(kuota) || kuota < 0 || kuota > 1000) return res.status(400).json({ error: "Kuota harus bilangan bulat 0–1000." });
  if (radius !== null && (!Number.isFinite(radius) || radius <= 0 || radius > 50)) return res.status(400).json({ error: "Radius harus 0–50 km." });
  if (nilaiMin !== null && (!Number.isFinite(nilaiMin) || nilaiMin < 0 || nilaiMin > 100)) return res.status(400).json({ error: "Nilai minimum harus 0–100." });

  const { data: jalur } = await supabase.from("jalur").select("*").eq("id", Number(req.params.id)).single();
  if (!jalur) return res.status(404).json({ error: "Jalur tidak ditemukan." });

  const perubahan = { kuota };
  // Jenis jalur tidak diubah: domisili memakai radius, prestasi memakai nilai minimum (nonakademik boleh kosong)
  const jenis = aturan.jenisJalur(jalur);
  if (jenis === "domisili") perubahan.syarat_radius_km = radius ?? jalur.syarat_radius_km;
  if (jenis === "prestasi_akademik") perubahan.syarat_nilai_minimum = nilaiMin ?? jalur.syarat_nilai_minimum;
  if (jenis === "prestasi_nonakademik") perubahan.syarat_nilai_minimum = nilaiMin;

  const { error } = await supabase.from("jalur").update(perubahan).eq("id", jalur.id);
  if (error) return res.status(500).json({ error: error.message });
  const ringkas = (j) => [`kuota ${j.kuota}`, j.syarat_radius_km != null && `radius ${j.syarat_radius_km} km`, j.syarat_nilai_minimum != null && `min ${j.syarat_nilai_minimum}`].filter(Boolean).join(", ");
  const sesudah = { ...jalur, ...perubahan };
  if (ringkas(jalur) !== ringkas(sesudah)) {
    await catatAktivitas(req, `Mengubah jalur ${jalur.nama}`, { sekolahId: jalur.sekolah_id, detail: `${ringkas(jalur)} → ${ringkas(sesudah)}` });
  }
  res.json({ ok: true });
});

app.post("/api/admin/sekolah", auth.requireAdminLogin, async (req, res) => {
  const b = req.body;
  const nama = String(b.nama || "").trim();
  const lat = Number(b.latitude), lng = Number(b.longitude);
  const radius = Number(b.radiusDomisili), nilaiMin = Number(b.nilaiMinimum);
  // Kuota 5 jalur SPMB (porsi yang sesuai regulasi diatur Admin Dinas; panel admin memberi peringatan)
  const kuota = {
    domisili: Number(b.kuotaDomisili), afirmasi: Number(b.kuotaAfirmasi), mutasi: Number(b.kuotaMutasi),
    prestasi_akademik: Number(b.kuotaPrestasiAkademik), prestasi_nonakademik: Number(b.kuotaPrestasiNonakademik),
  };
  const username = String(b.usernamePanitia || "").trim().toLowerCase();
  const passwordPanitia = String(b.passwordPanitia || "");

  if (!nama) return res.status(400).json({ error: "Nama sekolah wajib diisi." });
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return res.status(400).json({ error: "Koordinat sekolah tidak valid." });
  if (!(radius > 0 && radius <= 50)) return res.status(400).json({ error: "Radius domisili harus 0–50 km." });
  if (!Object.values(kuota).every((k) => Number.isInteger(k) && k >= 0)) return res.status(400).json({ error: "Kuota setiap jalur harus bilangan bulat ≥ 0." });
  if (!(nilaiMin >= 0 && nilaiMin <= 100)) return res.status(400).json({ error: "Nilai minimum prestasi harus 0–100." });
  if (!/^[a-z0-9_]{4,40}$/.test(username)) return res.status(400).json({ error: "Username panitia 4–40 karakter: huruf kecil, angka, atau garis bawah." });
  if (passwordPanitia.length < 6) return res.status(400).json({ error: "Password panitia minimal 6 karakter." });

  const [{ data: adaSekolah }, { data: adaUser }] = await Promise.all([
    supabase.from("sekolah").select("id").eq("nama", nama).maybeSingle(),
    supabase.from("akun_panitia").select("id").eq("username", username).maybeSingle(),
  ]);
  if (adaSekolah) return res.status(409).json({ error: "Sekolah dengan nama itu sudah ada." });
  if (adaUser) return res.status(409).json({ error: "Username panitia sudah dipakai." });

  const { data: sekolah, error: e1 } = await supabase
    .from("sekolah")
    .insert({ nama, latitude: lat, longitude: lng, alamat: String(b.alamat || "").trim() || null })
    .select()
    .single();
  if (e1) return res.status(500).json({ error: e1.message });

  const { error: e2 } = await supabase.from("jalur").insert([
    ...Object.entries(aturan.JENIS_JALUR).map(([jenis, info]) => ({
      sekolah_id: sekolah.id, nama: info.label, jenis, kuota: kuota[jenis],
      syarat_radius_km: jenis === "domisili" ? radius : null,
      syarat_nilai_minimum: jenis === "prestasi_akademik" ? nilaiMin : null,
    })),
  ]);
  const { error: e3 } = await supabase.from("akun_panitia").insert({
    username, password_hash: auth.hashPassword(passwordPanitia), nama: `Panitia ${nama}`, sekolah_id: sekolah.id,
  });
  if (e2 || e3) return res.status(500).json({ error: (e2 || e3).message });
  await catatAktivitas(req, "Menambah sekolah", { sekolahId: sekolah.id, detail: `${nama} + akun panitia ${username}` });
  res.status(201).json({ ok: true, id: sekolah.id });
});

app.post("/api/admin/panitia/:id/reset-password", auth.requireAdminLogin, async (req, res) => {
  const passwordBaru = String(req.body.passwordBaru || "");
  if (passwordBaru.length < 6) return res.status(400).json({ error: "Password minimal 6 karakter." });
  const panitiaId = Number(req.params.id);
  const { data, error } = await supabase
    .from("akun_panitia")
    .update({ password_hash: auth.hashPassword(passwordBaru) })
    .eq("id", panitiaId)
    .select("username");
  if (error) return res.status(500).json({ error: error.message });
  if (!data.length) return res.status(404).json({ error: "Akun panitia tidak ditemukan." });
  await supabase.from("sesi").delete().eq("tipe", "panitia").eq("panitia_id", panitiaId); // paksa login ulang
  await catatAktivitas(req, "Reset password panitia", { detail: data[0].username });
  res.json({ ok: true, username: data[0].username });
});

/* =========================================================
   PENANGANAN ERROR TERPUSAT -- balasan selalu JSON berbahasa Indonesia,
   tanpa membocorkan detail teknis (stack trace) ke pengguna.
   ========================================================= */

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Alamat API tidak ditemukan." });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof multer.MulterError) {
    const pesan = err.code === "LIMIT_FILE_SIZE" ? "Ukuran file maksimal 5 MB." : `Unggahan gagal: ${err.message}`;
    return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: pesan });
  }
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Format data yang dikirim tidak valid." });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Data yang dikirim terlalu besar." });
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ error: "Terjadi kesalahan di server. Silakan coba lagi beberapa saat lagi." });
});

storage.pastikanBucketAda();

app.listen(PORT, () => {
  console.log(`SiPPDB (Supabase + Auth + Upload, sesi via DB) server berjalan di http://localhost:${PORT}`);
});
