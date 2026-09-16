require("dotenv").config();
const express = require("express");
const path = require("path");
const supabase = require("./supabase");
const engine = require("./engine");

const app = express();
const PORT = process.env.PORT || 3000;

// Penjaga sederhana supaya satu jalur tidak diproses dua kali secara bersamaan
// (mitigasi race condition yang tercatat di PRD bagian 13 - Risiko dan Mitigasi)
const jalurSedangDiproses = new Set();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---- Sekolah & Jalur ----
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

// ---- Pendaftar (ringkas, untuk Beranda & Pengumuman) ----
app.get("/api/pendaftar", async (req, res) => {
  const { data: pendaftarList, error } = await supabase.from("pendaftar").select("*").order("id");
  if (error) return res.status(500).json({ error: error.message });

  const { data: sekolahList } = await supabase.from("sekolah").select("*");
  const namaSekolah = (id) => sekolahList.find((s) => s.id === id)?.nama || null;

  const rows = pendaftarList.map((p) => ({ ...p, sekolah_aktif_nama: namaSekolah(p.sekolah_aktif_id) }));
  res.json(rows);
});

// ---- Detail satu pendaftar (untuk Cek Status) ----
app.get("/api/pendaftar/nomor/:nomor", async (req, res) => {
  const { data: pendaftar, error } = await supabase.from("pendaftar").select("*").eq("nomor", req.params.nomor).single();
  if (error || !pendaftar) return res.status(404).json({ error: "Nomor pendaftaran tidak ditemukan." });

  const [{ data: pilihanRaw }, { data: riwayatRaw }, { data: notifikasi }, { data: sekolahList }, { data: jalurList }] = await Promise.all([
    supabase.from("pilihan").select("*").eq("pendaftar_id", pendaftar.id).order("urutan_prioritas"),
    supabase.from("riwayat_transfer").select("*").eq("pendaftar_id", pendaftar.id).order("id"),
    supabase.from("notifikasi").select("*").eq("pendaftar_id", pendaftar.id).order("id", { ascending: false }),
    supabase.from("sekolah").select("*"),
    supabase.from("jalur").select("*"),
  ]);

  const namaSekolah = (id) => sekolahList.find((s) => s.id === id)?.nama || "-";
  const namaJalur = (id) => jalurList.find((j) => j.id === id)?.nama || "-";

  const pilihan = pilihanRaw.map((p) => ({ ...p, sekolah_nama: namaSekolah(p.sekolah_id), jalur_nama: namaJalur(p.jalur_id) }));
  const riwayat = riwayatRaw.map((r) => ({ ...r, dari_nama: namaSekolah(r.dari_sekolah_id), ke_nama: namaSekolah(r.ke_sekolah_id) }));

  res.json({ pendaftar, pilihan, riwayat, notifikasi });
});

// ---- Pendaftaran baru (FR-01): hingga 3 pilihan sekolah berjenjang ----
app.post("/api/pendaftar", async (req, res) => {
  const { nama, nik, tanggalLahir, pilihan } = req.body; // pilihan: [{sekolahId, jalurId}, ...] max 3
  if (!nama || !nik || !tanggalLahir || !Array.isArray(pilihan) || pilihan.length === 0) {
    return res.status(400).json({ error: "Data pendaftaran belum lengkap." });
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
    skor: Math.floor(55 + Math.random() * 45), // simulasi skor komposit
    status: i === 0 ? "Menunggu Verifikasi Berkas" : "Menunggu Giliran",
  }));
  const { error: err2 } = await supabase.from("pilihan").insert(rows);
  if (err2) return res.status(500).json({ error: err2.message });

  res.status(201).json({ nomor, id: pendaftarBaru.id });
});

// ---- FR-02: Verifikasi berkas ----
app.patch("/api/pendaftar/:id/berkas", async (req, res) => {
  await engine.verifikasiBerkas(Number(req.params.id), req.body.status);
  res.json({ ok: true });
});

// ---- Daftar pendaftar aktif di satu sekolah (untuk Panel Panitia) ----
app.get("/api/sekolah/:id/antrean", async (req, res) => {
  const sekolahId = Number(req.params.id);
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
    rows.push({
      pendaftar_id: p.id, nomor: p.nomor, nama: p.nama, nik: p.nik,
      status_berkas: p.status_berkas, prioritas_aktif: p.prioritas_aktif,
      pilihan_id: pil.id, jalur_id: pil.jalur_id, skor: pil.skor,
      status_pilihan: pil.status, jalur_nama: namaJalur(pil.jalur_id),
    });
  }
  res.json(rows);
});

// ---- FR-04 + FR-05: Jalankan seleksi untuk satu jalur (memicu auto-transfer bila ditolak) ----
app.post("/api/jalur/:id/jalankan-seleksi", async (req, res) => {
  const jalurId = Number(req.params.id);

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

app.listen(PORT, () => {
  console.log(`SiPPDB (Supabase) server berjalan di http://localhost:${PORT}`);
});
