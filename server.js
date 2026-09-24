require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const path = require("path");
const supabase = require("./supabase");
const engine = require("./engine");
const auth = require("./auth");
const storage = require("./storage");
const validasi = require("./validasi");
const zonasi = require("./zonasi");
const { waitUntil } = require("@vercel/functions");
const crypto = require("crypto");
const email = require("./email");

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Penjaga sederhana supaya satu jalur tidak diproses dua kali secara bersamaan
// (mitigasi race condition yang tercatat di PRD bagian 13 - Risiko dan Mitigasi)
const jalurSedangDiproses = new Set();

const JENIS_DOKUMEN = ["Kartu Keluarga", "Akta Kelahiran", "Rapor Terakhir"];
const TIPE_FILE_DIIZINKAN = ["application/pdf", "image/jpeg", "image/png"];

/**
 * Batas usia calon siswa SMA dihitung pada 1 Juli tahun ajaran berjalan
 * (acuan aturan SPMB: usia paling tinggi 21 tahun). Batas bawah 12 tahun untuk menangkap salah ketik.
 * Mengembalikan pesan error, atau null kalau valid.
 */
const USIA_MIN = 12;
const USIA_MAKS = 21;
function validasiUmur(tanggalLahir) {
  const lahir = new Date(`${tanggalLahir}T00:00:00Z`);
  if (Number.isNaN(lahir.getTime())) return "Tanggal lahir tidak valid.";
  if (lahir > new Date()) return "Tanggal lahir tidak boleh di masa depan.";
  const acuan = new Date(Date.UTC(new Date().getUTCFullYear(), 6, 1)); // 1 Juli tahun ini
  let usia = acuan.getUTCFullYear() - lahir.getUTCFullYear();
  if (acuan < new Date(Date.UTC(acuan.getUTCFullYear(), lahir.getUTCMonth(), lahir.getUTCDate()))) usia--;
  if (usia < USIA_MIN) return `Usia pendaftar ${usia} tahun (per 1 Juli ${acuan.getUTCFullYear()}). Usia minimal ${USIA_MIN} tahun -- periksa kembali tanggal lahir.`;
  if (usia > USIA_MAKS) return `Usia pendaftar ${usia} tahun (per 1 Juli ${acuan.getUTCFullYear()}). Usia maksimal calon siswa SMA adalah ${USIA_MAKS} tahun.`;
  return null;
}

// Escape teks sebelum dimasukkan ke HTML email
const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));

/** "Ahmad Fadhil" -> "Ah*** Fa****": 2 huruf awal tiap kata tetap, sisanya disamarkan. */
function samarkanNama(nama) {
  return String(nama || "")
    .trim()
    .split(/\s+/)
    .filter((kata) => /[\p{L}\p{N}]/u.test(kata)) // lewati "kata" berupa tanda baca saja, mis. "-"
    .map((kata) => (kata.length <= 2 ? kata[0] + "*" : kata.slice(0, 2) + "*".repeat(Math.min(kata.length - 2, 5))))
    .join(" ");
}

// Di balik proxy (mis. Vercel), IP asli pengunjung ada di header X-Forwarded-For
app.set("trust proxy", 1);
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
  res.json(data);
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

  const pilihan = pilihanRaw.map((p) => ({ ...p, sekolah_nama: namaSekolah(p.sekolah_id), jalur_nama: namaJalur(p.jalur_id) }));
  const riwayat = riwayatRaw.map((r) => ({ ...r, dari_nama: namaSekolah(r.dari_sekolah_id), ke_nama: namaSekolah(r.ke_sekolah_id) }));

  const { password_hash, ...pendaftarAman } = pendaftar;
  res.json({ pendaftar: pendaftarAman, pilihan, riwayat, notifikasi, dokumen: await storage.tandatanganiDokumen(dokumen), jenisDokumen: JENIS_DOKUMEN });
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

  // Skor tiap pilihan: zonasi dari jarak GPS, prestasi dari nilai rapor
  const skorPilihan = [];
  for (const p of pilihan) {
    const jalur = jalurDipilih.find((j) => j.id === p.jalurId);
    const sekolah = sekolahDipilih.find((s) => s.id === p.sekolahId);
    if (!jalur || !sekolah || jalur.sekolah_id !== p.sekolahId) {
      return res.status(400).json({ error: "Kombinasi sekolah dan jalur tidak valid." });
    }

    if (jalur.syarat_radius_km != null) {
      if (!lokasiAda) {
        skorPilihan.push({ skor: 0, jarak_km: null, catatan_skor: "Lokasi tidak tersedia" });
      } else if (sekolah.latitude == null || sekolah.longitude == null) {
        skorPilihan.push({ skor: 0, jarak_km: null, catatan_skor: "Koordinat sekolah belum diatur" });
      } else {
        const jarak = zonasi.hitungJarakKm(latitude, longitude, Number(sekolah.latitude), Number(sekolah.longitude));
        skorPilihan.push({ skor: Math.round(zonasi.skorDariJarak(jarak)), jarak_km: Number(jarak.toFixed(2)), catatan_skor: null });
      }
    } else if (jalur.syarat_nilai_minimum != null) {
      if (nilai === null) {
        return res.status(400).json({ error: `Nilai rapor wajib diisi untuk jalur ${jalur.nama}.` });
      }
      skorPilihan.push({ skor: Math.round(nilai), jarak_km: null, catatan_skor: null });
    } else {
      skorPilihan.push({ skor: nilai === null ? 0 : Math.round(nilai), jarak_km: null, catatan_skor: null });
    }
  }


  // FR-09: Pra-Verifikasi NIK -- hanya flag, tidak menolak pendaftaran
  const catatanNik = validasi.validasiNIK(nik);

  const alamatBersih = typeof alamat === "string" && alamat.trim() ? alamat.trim() : null;

  const { data: pendaftarBaru, error: err1 } = await supabase
    .from("pendaftar")
    .insert({
      // nomor tidak dikirim: diisi otomatis oleh sequence database (migration v6.3)
      nama, nik, tanggal_lahir: tanggalLahir,
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
    })
    .select()
    .single();
  if (err1) return res.status(500).json({ error: err1.message });

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

  res.status(201).json({ nomor: pendaftarBaru.nomor, id: pendaftarBaru.id });

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
  if (!JENIS_DOKUMEN.includes(jenis)) return res.status(400).json({ error: "Jenis dokumen tidak dikenal." });
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
  const { data: pendaftar } = await supabase.from("pendaftar").select("sekolah_aktif_id").eq("id", pendaftarId).single();
  if (!pendaftar || pendaftar.sekolah_aktif_id !== req.panitia.sekolahId) {
    return res.status(403).json({ error: "Pendaftar ini tidak sedang aktif di sekolah Anda." });
  }
  const catatan = typeof req.body.catatan === "string" ? req.body.catatan.trim().slice(0, 500) : null;
  await engine.verifikasiBerkas(pendaftarId, req.body.status, catatan || null);
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
  const { data: jalurPrestasi } = await supabase.from("jalur").select("id").not("syarat_nilai_minimum", "is", null);
  const { data: diperbarui } = await supabase
    .from("pilihan")
    .update({ skor: Math.round(nilaiBaru) })
    .eq("pendaftar_id", pendaftarId)
    .in("jalur_id", jalurPrestasi.map((j) => j.id))
    .in("status", ["Menunggu Giliran", "Menunggu Verifikasi Berkas", "Menunggu Seleksi"])
    .select("id");

  const nilaiLama = pendaftar.nilai_rapor ?? "-";
  await engine.tambahNotifikasi(
    pendaftarId,
    `Nilai rapor Anda dikoreksi panitia dari ${nilaiLama} menjadi ${nilaiBaru} sesuai berkas rapor yang diunggah.`
  );

  res.json({ ok: true, pilihanDiperbarui: diperbarui?.length || 0 });
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

    rows.push({
      pendaftar_id: p.id, nomor: p.nomor, nama: p.nama, nik: p.nik,
      nilai_rapor: p.nilai_rapor, nilai_rapor_awal: p.nilai_rapor_awal,
      nilai_rapor_dikoreksi_oleh: p.nilai_rapor_dikoreksi_oleh,
      status_berkas: p.status_berkas, prioritas_aktif: p.prioritas_aktif,
      pilihan_id: pil.id, jalur_id: pil.jalur_id, skor: pil.skor,
      status_pilihan: pil.status, jalur_nama: namaJalur(pil.jalur_id),
      jarak_km: pil.jarak_km, catatan_skor: pil.catatan_skor,
      syarat_radius_km: jalurList.find((j) => j.id === pil.jalur_id)?.syarat_radius_km ?? null,
      dokumen,
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

  const { data: jalur } = await supabase.from("jalur").select("sekolah_id").eq("id", jalurId).single();
  if (!jalur || jalur.sekolah_id !== req.panitia.sekolahId) {
    return res.status(403).json({ error: "Jalur ini bukan milik sekolah Anda." });
  }

  const tahapan = await statusTahapan();
  if (tahapan.aktif && tahapan.dibuka) {
    return res.status(409).json({
      error: "Pendaftaran masih dibuka. Tutup pendaftaran terlebih dahulu sebelum menjalankan seleksi, supaya semua pendaftar ikut dibandingkan secara adil.",
    });
  }

  if (jalurSedangDiproses.has(jalurId)) {
    return res.status(409).json({ error: "Seleksi untuk jalur ini sedang diproses. Tunggu sebentar sebelum mencoba lagi." });
  }

  jalurSedangDiproses.add(jalurId);
  try {
    await engine.prosesRevisiKedaluwarsa();
    const hasil = await engine.jalankanSeleksiJalur(jalurId);
    res.json({ ok: true, ...hasil });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    jalurSedangDiproses.delete(jalurId);
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

  const link = `${req.protocol}://${req.get("host")}/reset.html?token=${token}`;
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
function keCsv(baris) {
  const sel = (v) => {
    const s = v == null ? "" : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + baris.map((r) => r.map(sel).join(";")).join("\r\n");
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
    "Nilai Rapor", "Status di Sekolah Ini", "Alasan Penolakan", "Status Berkas", "Status Akhir", "Waktu Daftar",
  ];
  const baris = pilihan.map((pl) => {
    const p = pendaftarList.find((x) => x.id === pl.pendaftar_id) || {};
    return [
      p.nomor, p.nama, p.nik, p.tanggal_lahir, p.email, p.alamat, pl.urutan_prioritas,
      jalurList.find((j) => j.id === pl.jalur_id)?.nama, desimalId(pl.jarak_km), pl.skor, desimalId(p.nilai_rapor),
      pl.status, pl.alasan_penolakan, p.status_berkas, p.status_global,
      p.created_at ? String(p.created_at).slice(0, 19).replace("T", " ") : "",
    ];
  });

  const namaFile = `pendaftar-${String(sekolah?.nama || "sekolah").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${namaFile}"`);
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
  // Jenis jalur tidak diubah: zonasi tetap pakai radius, prestasi tetap pakai nilai minimum
  if (jalur.syarat_radius_km != null) perubahan.syarat_radius_km = radius ?? jalur.syarat_radius_km;
  if (jalur.syarat_nilai_minimum != null) perubahan.syarat_nilai_minimum = nilaiMin ?? jalur.syarat_nilai_minimum;

  const { error } = await supabase.from("jalur").update(perubahan).eq("id", jalur.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.post("/api/admin/sekolah", auth.requireAdminLogin, async (req, res) => {
  const b = req.body;
  const nama = String(b.nama || "").trim();
  const lat = Number(b.latitude), lng = Number(b.longitude);
  const radius = Number(b.radiusZonasi), kuotaZ = Number(b.kuotaZonasi), kuotaP = Number(b.kuotaPrestasi), nilaiMin = Number(b.nilaiMinimum);
  const username = String(b.usernamePanitia || "").trim().toLowerCase();
  const passwordPanitia = String(b.passwordPanitia || "");

  if (!nama) return res.status(400).json({ error: "Nama sekolah wajib diisi." });
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return res.status(400).json({ error: "Koordinat sekolah tidak valid." });
  if (!(radius > 0 && radius <= 50)) return res.status(400).json({ error: "Radius zonasi harus 0–50 km." });
  if (![kuotaZ, kuotaP].every((k) => Number.isInteger(k) && k >= 0)) return res.status(400).json({ error: "Kuota harus bilangan bulat ≥ 0." });
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
    { sekolah_id: sekolah.id, nama: "Zonasi", kuota: kuotaZ, syarat_nilai_minimum: null, syarat_radius_km: radius },
    { sekolah_id: sekolah.id, nama: "Prestasi", kuota: kuotaP, syarat_nilai_minimum: nilaiMin, syarat_radius_km: null },
  ]);
  const { error: e3 } = await supabase.from("akun_panitia").insert({
    username, password_hash: auth.hashPassword(passwordPanitia), nama: `Panitia ${nama}`, sekolah_id: sekolah.id,
  });
  if (e2 || e3) return res.status(500).json({ error: (e2 || e3).message });
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
  res.json({ ok: true, username: data[0].username });
});

storage.pastikanBucketAda();

app.listen(PORT, () => {
  console.log(`SiPPDB (Supabase + Auth + Upload, sesi via DB) server berjalan di http://localhost:${PORT}`);
});
