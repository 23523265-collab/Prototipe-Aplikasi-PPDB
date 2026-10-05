const supabase = require("./supabase");
const aturan = require("./aturan");
const email = require("./email");

// Escape nama pendaftar sebelum dimasukkan ke HTML email
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const JAM_MASA_REVISI = 48; // waktu pendaftar untuk mengunggah ulang berkas yang "Kurang Lengkap"

const formatWaktuWIB = (d) =>
  new Date(d).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "long", timeStyle: "short" }) + " WIB";

async function getSekolahNama(id) {
  const { data } = await supabase.from("sekolah").select("nama").eq("id", id).single();
  return data?.nama || "Sekolah";
}

async function tambahNotifikasi(pendaftarId, isi) {
  await supabase.from("notifikasi").insert({ pendaftar_id: pendaftarId, isi_pesan: isi });

  // FR-08: kirim juga notifikasi via email (di luar tampilan di aplikasi)
  const { data: pendaftar } = await supabase
    .from("pendaftar")
    .select("nama, email, nomor")
    .eq("id", pendaftarId)
    .single();

  if (pendaftar?.email) {
    await email.kirimEmail(
      pendaftar.email,
      `Update Status Pendaftaran ${pendaftar.nomor} - SiPPDB`,
      `Halo <strong>${esc(pendaftar.nama)}</strong>,<br><br>${isi}<br><br>Cek status lengkap pendaftaran Anda di aplikasi SiPPDB.`
    );
  }
}

/**
 * Semua perubahan status inti dijalankan sebagai fungsi PostgreSQL (migration v7.7) = satu transaksi:
 * berhasil semua atau dibatalkan semua, dengan baris pendaftar dikunci selama proses.
 * Notifikasi/email dikirim SETELAH transaksi berhasil.
 */
async function transaksi(nama, args) {
  const { data, error } = await supabase.rpc(nama, args);
  if (error) throw new Error(`Proses ${nama} gagal (sudah jalankan migration v7.7?): ${error.message}`);
  return data;
}

/** Notifikasi hasil tolak: dialihkan ke pilihan berikutnya, atau seluruh pilihan sudah habis */
async function kabariPenolakan(pendaftarId, hasil, alasan) {
  if (hasil?.hasil !== "dialihkan" && hasil?.hasil !== "final") return;
  const sekolahLama = await getSekolahNama(hasil.dari_sekolah_id);
  if (hasil.hasil === "dialihkan") {
    const sekolahBaru = await getSekolahNama(hasil.ke_sekolah_id);
    await tambahNotifikasi(pendaftarId,
      `Anda belum diterima di ${sekolahLama} (${alasan}). Pendaftaran otomatis dialihkan untuk diproses di ${sekolahBaru} (Pilihan ${hasil.prioritas_baru}).`);
  } else {
    await tambahNotifikasi(pendaftarId,
      `Anda belum diterima di ${sekolahLama} (${alasan}). Seluruh pilihan sekolah telah diproses — status akhir: Tidak Diterima.`);
  }
}

/**
 * FR-05: Auto-Transfer Antar Sekolah (Cascading Assignment)
 * Dipanggil setiap kali pendaftar ditolak di sekolah yang sedang aktif.
 * cekRevisi: hanya bila masa revisi benar-benar lewat (diperiksa ulang di dalam transaksi).
 */
async function tolakDanAlihkan(pendaftarId, alasan, { cekRevisi = false } = {}) {
  const hasil = await transaksi("sippdb_tolak_dan_alihkan", { p_pendaftar_id: pendaftarId, p_alasan: alasan, p_cek_revisi: cekRevisi });
  await kabariPenolakan(pendaftarId, hasil, alasan);
  return hasil;
}

/** FR-04: terima di pilihan aktif; kuota jalur diperiksa ulang di dalam transaksi. Hasil: diterima | kuota_penuh | dilewati */
async function terimaFinal(pendaftarId, jalurId) {
  const hasil = await transaksi("sippdb_terima", { p_pendaftar_id: pendaftarId, p_jalur_id: jalurId, p_jam_daftar_ulang: aturan.JAM_DAFTAR_ULANG });
  if (hasil?.hasil === "diterima") {
    const sekolahNama = await getSekolahNama(hasil.sekolah_id);
    await tambahNotifikasi(pendaftarId,
      `Selamat! Anda dinyatakan DITERIMA di ${sekolahNama}. Lakukan konfirmasi DAFTAR ULANG di menu Cek Status paling lambat ${formatWaktuWIB(hasil.batas_daftar_ulang)}. Jika tidak, kursi akan dilepas untuk pendaftar lain.`);
  }
  return hasil;
}

/**
 * K2: Lepaskan kursi siswa yang tidak mengonfirmasi daftar ulang sampai batas waktu.
 * Status pilihan "Diterima" -> "Tidak Daftar Ulang" sehingga sisa kuota jalur bertambah lagi
 * dan panitia dapat menjalankan seleksi tahap 2. Diproses saat halaman dibuka / sebelum seleksi.
 */
async function prosesDaftarUlangKedaluwarsa() {
  const { data, error } = await supabase
    .from("pendaftar")
    .select("id")
    .eq("status_global", "Diterima Final")
    .is("daftar_ulang_at", null)
    .lt("daftar_ulang_batas_at", new Date().toISOString());
  if (error) {
    console.warn("[engine] Cek daftar ulang dilewati:", error.message);
    return 0;
  }
  let dilepas = 0;
  for (const p of data) {
    const hasil = await transaksi("sippdb_lepas_kursi", { p_pendaftar_id: p.id });
    if (hasil?.hasil !== "dilepas") continue; // sudah diproses permintaan lain / baru saja dikonfirmasi
    dilepas++;
    const sekolahNama = await getSekolahNama(hasil.sekolah_id);
    await tambahNotifikasi(p.id, `Batas daftar ulang di ${sekolahNama} (${formatWaktuWIB(hasil.batas)}) telah lewat tanpa konfirmasi. Kursi Anda dilepas untuk pendaftar lain.`);
  }
  return dilepas;
}

/** FR-02: Verifikasi berkas oleh panitia sekolah yang sedang aktif */
async function verifikasiBerkas(pendaftarId, statusBaru, catatan = null) {
  const hasil = await transaksi("sippdb_verifikasi", {
    p_pendaftar_id: pendaftarId, p_status: statusBaru, p_catatan: catatan || null, p_jam_revisi: JAM_MASA_REVISI,
  });
  if (hasil?.hasil === "kurang") {
    const sekolahNama = await getSekolahNama(hasil.sekolah_id);
    await tambahNotifikasi(
      pendaftarId,
      `Berkas Anda di ${sekolahNama} dinyatakan Kurang Lengkap${catatan ? ` (catatan panitia: ${catatan})` : ""}. ` +
        `Silakan unggah ulang berkas melalui menu Cek Status paling lambat ${formatWaktuWIB(hasil.batas_revisi)}. ` +
        `Jika tidak direvisi sampai batas waktu tersebut, pendaftaran otomatis dialihkan ke pilihan sekolah berikutnya.`
    );
  } else if (hasil?.hasil === "lengkap") {
    const sekolahNama = await getSekolahNama(hasil.sekolah_id);
    await tambahNotifikasi(
      pendaftarId,
      `Berkas Anda di ${sekolahNama} telah diverifikasi dan dinyatakan Lengkap. Pendaftaran Anda akan diproses ke tahap seleksi.`
    );
  } else {
    await kabariPenolakan(pendaftarId, hasil, "Berkas tidak lengkap/tidak sesuai");
  }
  return hasil;
}

/**
 * Alihkan pendaftar yang masa revisinya sudah lewat tanpa unggah ulang.
 * Tidak ada cron di prototipe ini, jadi fungsi ini dipanggil saat panitia membuka antrean,
 * saat pendaftar membuka status, dan sebelum seleksi dijalankan.
 */
async function prosesRevisiKedaluwarsa() {
  const { data, error } = await supabase
    .from("pendaftar")
    .select("id")
    .eq("status_global", "Aktif")
    .eq("status_berkas", "Kurang Lengkap")
    .lt("batas_revisi_at", new Date().toISOString());
  if (error) {
    console.warn("[engine] Cek masa revisi dilewati:", error.message);
    return 0;
  }
  for (const p of data) {
    await tolakDanAlihkan(p.id, "Berkas tidak direvisi sampai batas waktu", { cekRevisi: true });
  }
  return data.length;
}

/** Pendaftar mengunggah berkas saat berstatus Kurang Lengkap: kembali ke antrean verifikasi panitia. */
async function tandaiSudahRevisi(pendaftarId) {
  // satu perintah bersyarat (atomik): hanya berubah bila memang masih Kurang Lengkap
  const { data: diubah } = await supabase
    .from("pendaftar")
    .update({ status_berkas: "Menunggu Verifikasi", batas_revisi_at: null })
    .eq("id", pendaftarId)
    .eq("status_berkas", "Kurang Lengkap")
    .eq("status_global", "Aktif")
    .select("sekolah_aktif_id");
  if (!diubah?.length) return;
  const sekolahNama = await getSekolahNama(diubah[0].sekolah_aktif_id);
  await tambahNotifikasi(pendaftarId, `Revisi berkas Anda telah diterima dan akan diverifikasi ulang oleh panitia ${sekolahNama}.`);
}

/** FR-04 + FR-05: Jalankan seleksi & perankingan untuk satu jalur (memicu auto-transfer bila ditolak) */
async function jalankanSeleksiJalur(jalurId) {
  const { data: jalur } = await supabase.from("jalur").select("*").eq("id", jalurId).single();
  const { data: pilihanMenunggu } = await supabase
    .from("pilihan")
    .select("*")
    .eq("jalur_id", jalurId)
    .eq("status", "Menunggu Seleksi");

  // Hanya pendaftar yang masih Aktif dan memang sedang diproses di pilihan ini
  const { data: pendaftarTerkait } = await supabase
    .from("pendaftar")
    .select("id, status_global, prioritas_aktif, tanggal_lahir, created_at")
    .in("id", pilihanMenunggu.map((k) => k.pendaftar_id));
  const kandidat = pilihanMenunggu.filter((k) => {
    const p = pendaftarTerkait.find((x) => x.id === k.pendaftar_id);
    return p && p.status_global === "Aktif" && p.prioritas_aktif === k.urutan_prioritas;
  });

  // 1–2) Syarat dasar jalur + peringkat (jarak/skor, lalu usia, lalu waktu daftar) -- lihat aturan.js
  // 3) Kuota dikurangi yang sudah diterima di seleksi sebelumnya, supaya seleksi berulang tidak melebihi kuota
  const { count: sudahDiterima } = await supabase
    .from("pilihan")
    .select("id", { count: "exact", head: true })
    .eq("jalur_id", jalurId)
    .eq("status", "Diterima");
  const sisaKuota = aturan.hitungSisaKuota(jalur.kuota, sudahDiterima);
  const hasil = aturan.tentukanHasilSeleksi(
    kandidat, jalur, (id) => pendaftarTerkait.find((x) => x.id === id), sisaKuota
  );

  // Setiap siswa diproses dalam transaksinya sendiri; kuota diperiksa ulang di database saat menerima
  const hitung = { diterima: 0, ditolakKuota: 0, ditolakSyarat: 0 };
  for (const k of hasil.diterima) {
    const h = await terimaFinal(k.pendaftar_id, jalurId);
    if (h?.hasil === "diterima") hitung.diterima++;
    else if (h?.hasil === "kuota_penuh") {
      const t = await tolakDanAlihkan(k.pendaftar_id, "Tidak masuk kuota");
      if (t?.hasil !== "dilewati") hitung.ditolakKuota++;
    }
  }
  for (const k of hasil.ditolakKuota) {
    const t = await tolakDanAlihkan(k.pendaftar_id, "Tidak masuk kuota");
    if (t?.hasil !== "dilewati") hitung.ditolakKuota++;
  }
  for (const { k, alasan } of hasil.tidakMemenuhi) {
    const t = await tolakDanAlihkan(k.pendaftar_id, alasan);
    if (t?.hasil !== "dilewati") hitung.ditolakSyarat++;
  }

  return {
    jumlahDiproses: kandidat.length,
    ...hitung,
    sisaKuotaSebelum: sisaKuota,
    kuota: jalur.kuota,
  };
}

/** K4: pendaftar mengundurkan diri (transaksi sippdb_mundur, migration v7.8) */
async function mundur(pendaftarId, alasan) {
  const hasil = await transaksi("sippdb_mundur", { p_pendaftar_id: pendaftarId, p_alasan: alasan || null });
  if (hasil?.hasil === "mundur") {
    const sekolahNama = await getSekolahNama(hasil.sekolah_id);
    await tambahNotifikasi(pendaftarId, hasil.melepas_kursi
      ? `Anda telah mengundurkan diri dari ${sekolahNama}. Kursi Anda dilepas untuk pendaftar lain. Seluruh proses pendaftaran Anda selesai.`
      : `Anda telah mengundurkan diri dari proses penerimaan (sedang diproses di ${sekolahNama}). Seluruh pilihan sekolah dibatalkan.`);
  }
  return hasil;
}

module.exports = {
  mundur,
  verifikasiBerkas, jalankanSeleksiJalur, tolakDanAlihkan, terimaFinal, tambahNotifikasi,
  prosesRevisiKedaluwarsa, tandaiSudahRevisi, prosesDaftarUlangKedaluwarsa,
};
