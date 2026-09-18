require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const path = require("path");
const supabase = require("./supabase");
const engine = require("./engine");
const auth = require("./auth");
const storage = require("./storage");

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Penjaga sederhana supaya satu jalur tidak diproses dua kali secara bersamaan
// (mitigasi race condition yang tercatat di PRD bagian 13 - Risiko dan Mitigasi)
const jalurSedangDiproses = new Set();

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

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
  } else {
    const { data } = await supabase.from("akun_panitia").select("id, nama, sekolah_id").eq("id", sesi.panitia_id).single();
    return res.json({ pendaftar: null, panitia: data ? { id: data.id, nama: data.nama, sekolahId: data.sekolah_id } : null });
  }
});

app.post("/api/auth/pendaftar/login", async (req, res) => {
  const { nomor, password } = req.body;
  if (!nomor || !password) return res.status(400).json({ error: "Nomor dan password wajib diisi." });

  const { data: pendaftar, error } = await supabase.from("pendaftar").select("*").eq("nomor", nomor).single();
  if (error || !pendaftar) return res.status(401).json({ error: "Nomor pendaftaran atau password salah." });
  if (!auth.verifyPassword(password, pendaftar.password_hash)) {
    return res.status(401).json({ error: "Nomor pendaftaran atau password salah." });
  }

  const token = await auth.buatSesi("pendaftar", { pendaftarId: pendaftar.id });
  res.cookie("sid", token, auth.opsiCookie(req));
  res.json({ ok: true, nomor: pendaftar.nomor, nama: pendaftar.nama });
});

app.post("/api/auth/panitia/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username dan password wajib diisi." });

  const { data: akun, error } = await supabase.from("akun_panitia").select("*").eq("username", username).single();
  if (error || !akun) return res.status(401).json({ error: "Username atau password salah." });
  if (!auth.verifyPassword(password, akun.password_hash)) {
    return res.status(401).json({ error: "Username atau password salah." });
  }

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

  const rows = pendaftarList.map((p) => ({
    id: p.id, nomor: p.nomor, nama: p.nama, status_global: p.status_global,
    prioritas_aktif: p.prioritas_aktif, sekolah_aktif_id: p.sekolah_aktif_id,
    sekolah_aktif_nama: namaSekolah(p.sekolah_aktif_id),
  }));
  res.json(rows);
});

app.get("/api/pendaftar/nomor/:nomor", auth.requirePendaftarLogin, async (req, res) => {
  if (req.pendaftar.nomor !== req.params.nomor) {
    return res.status(403).json({ error: "Anda hanya dapat melihat status pendaftaran milik sendiri." });
  }

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
  res.json({ pendaftar: pendaftarAman, pilihan, riwayat, notifikasi, dokumen });
});

app.post("/api/pendaftar", async (req, res) => {
  const { nama, nik, tanggalLahir, email: emailPendaftar, password, pilihan } = req.body;
  if (!nama || !nik || !tanggalLahir || !emailPendaftar || !password || !Array.isArray(pilihan) || pilihan.length === 0) {
    return res.status(400).json({ error: "Data pendaftaran belum lengkap (termasuk email dan password)." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password minimal 6 karakter." });
  }
  if (pilihan.length > 3) {
    return res.status(400).json({ error: "Maksimal 3 pilihan sekolah." });
  }
  const sekolahIds = pilihan.map((p) => p.sekolahId);
  if (new Set(sekolahIds).size !== sekolahIds.length) {
    return res.status(400).json({ error: "Pilihan sekolah tidak boleh duplikat." });
  }

  const { count } = await supabase.from("pendaftar").select("*", { count: "exact", head: true });
  const nomor = `PPDB-${String((count || 0) + 1).padStart(4, "0")}`;

  const { data: pendaftarBaru, error: err1 } = await supabase
    .from("pendaftar")
    .insert({
      nomor, nama, nik, tanggal_lahir: tanggalLahir,
      email: emailPendaftar,
      password_hash: auth.hashPassword(password),
      status_berkas: "Menunggu Verifikasi", status_global: "Aktif",
      sekolah_aktif_id: pilihan[0].sekolahId, prioritas_aktif: 1,
    })
    .select()
    .single();
  if (err1) return res.status(500).json({ error: err1.message });

  const rows = pilihan.map((p, i) => ({
    pendaftar_id: pendaftarBaru.id,
    sekolah_id: p.sekolahId,
    urutan_prioritas: i + 1,
    jalur_id: p.jalurId,
    skor: Math.floor(55 + Math.random() * 45),
    status: i === 0 ? "Menunggu Verifikasi Berkas" : "Menunggu Giliran",
  }));
  const { error: err2 } = await supabase.from("pilihan").insert(rows);
  if (err2) return res.status(500).json({ error: err2.message });

  // Otomatis login setelah daftar, supaya bisa langsung unggah berkas
  const token = await auth.buatSesi("pendaftar", { pendaftarId: pendaftarBaru.id });
  res.cookie("sid", token, auth.opsiCookie(req));

  res.status(201).json({ nomor, id: pendaftarBaru.id });
});

app.post("/api/pendaftar/:id/dokumen", auth.requirePendaftarLogin, upload.single("file"), async (req, res) => {
  const pendaftarId = Number(req.params.id);
  if (req.pendaftar.id !== pendaftarId) {
    return res.status(403).json({ error: "Anda hanya dapat mengunggah berkas milik sendiri." });
  }
  const { jenis } = req.body;
  if (!req.file) return res.status(400).json({ error: "File tidak ditemukan." });
  if (!jenis) return res.status(400).json({ error: "Jenis dokumen wajib diisi." });

  try {
    const url = await storage.uploadBerkas(pendaftarId, jenis, req.file);
    const { data, error } = await supabase
      .from("dokumen")
      .insert({ pendaftar_id: pendaftarId, jenis, nama_file: req.file.originalname, url })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================================================
   PANEL PANITIA (wajib login panitia)
   ========================================================= */

app.patch("/api/pendaftar/:id/berkas", auth.requirePanitiaLogin, async (req, res) => {
  const pendaftarId = Number(req.params.id);
  const { data: pendaftar } = await supabase.from("pendaftar").select("sekolah_aktif_id").eq("id", pendaftarId).single();
  if (!pendaftar || pendaftar.sekolah_aktif_id !== req.panitia.sekolahId) {
    return res.status(403).json({ error: "Pendaftar ini tidak sedang aktif di sekolah Anda." });
  }
  await engine.verifikasiBerkas(pendaftarId, req.body.status);
  res.json({ ok: true });
});

app.get("/api/sekolah/:id/antrean", auth.requirePanitiaLogin, async (req, res) => {
  const sekolahId = Number(req.params.id);
  if (sekolahId !== req.panitia.sekolahId) {
    return res.status(403).json({ error: "Anda hanya dapat melihat antrean sekolah Anda sendiri." });
  }

  const { data: pendaftarAktif, error } = await supabase
    .from("pendaftar")
    .select("*")
    .eq("sekolah_aktif_id", sekolahId)
    .eq("status_global", "Aktif")
    .order("id");
  if (error) return res.status(500).json({ error: error.message });

  const { data: jalurList } = await supabase.from("jalur").select("*");
  const namaJalur = (id) => jalurList.find((j) => j.id === id)?.nama || "-";

  const rows = [];
  for (const p of pendaftarAktif) {
    const { data: pil } = await supabase
      .from("pilihan")
      .select("*")
      .eq("pendaftar_id", p.id)
      .eq("urutan_prioritas", p.prioritas_aktif)
      .single();
    if (!pil) continue;

    const { data: dokumen } = await supabase.from("dokumen").select("*").eq("pendaftar_id", p.id);

    rows.push({
      pendaftar_id: p.id, nomor: p.nomor, nama: p.nama, nik: p.nik,
      status_berkas: p.status_berkas, prioritas_aktif: p.prioritas_aktif,
      pilihan_id: pil.id, jalur_id: pil.jalur_id, skor: pil.skor,
      status_pilihan: pil.status, jalur_nama: namaJalur(pil.jalur_id),
      dokumen: dokumen || [],
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

  if (jalurSedangDiproses.has(jalurId)) {
    return res.status(409).json({ error: "Seleksi untuk jalur ini sedang diproses. Tunggu sebentar sebelum mencoba lagi." });
  }

  jalurSedangDiproses.add(jalurId);
  try {
    const jumlahDiproses = await engine.jalankanSeleksiJalur(jalurId);
    res.json({ ok: true, jumlahDiproses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    jalurSedangDiproses.delete(jalurId);
  }
});

storage.pastikanBucketAda();

app.listen(PORT, () => {
  console.log(`SiPPDB (Supabase + Auth + Upload, sesi via DB) server berjalan di http://localhost:${PORT}`);
});
