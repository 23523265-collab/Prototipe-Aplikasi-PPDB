const supabase = require("./supabase");
const aturan = require("./aturan");
const email = require("./email");

// Escape nama pendaftar sebelum dimasukkan ke HTML email
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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
 * FR-05: Auto-Transfer Antar Sekolah (Cascading Assignment)
 * Dipanggil setiap kali pendaftar ditolak di sekolah yang sedang aktif.
 */
async function tolakDanAlihkan(pendaftarId, alasanKategori) {
  const { data: pendaftar } = await supabase.from("pendaftar").select("*").eq("id", pendaftarId).single();
  if (!pendaftar || pendaftar.status_global !== "Aktif") return;

  const { data: pilihanAktif } = await supabase
    .from("pilihan")
    .select("*")
    .eq("pendaftar_id", pendaftarId)
    .eq("urutan_prioritas", pendaftar.prioritas_aktif)
    .single();

  await supabase.from("pilihan").update({ status: "Ditolak", alasan_penolakan: alasanKategori }).eq("id", pilihanAktif.id);

  const sekolahLama = await getSekolahNama(pilihanAktif.sekolah_id);

  const { data: pilihanBerikutnya } = await supabase
    .from("pilihan")
    .select("*")
    .eq("pendaftar_id", pendaftarId)
    .eq("urutan_prioritas", pendaftar.prioritas_aktif + 1)
    .maybeSingle();

  if (pilihanBerikutnya) {
    const sekolahBaru = await getSekolahNama(pilihanBerikutnya.sekolah_id);

    await supabase
      .from("pendaftar")
      .update({
        sekolah_aktif_id: pilihanBerikutnya.sekolah_id,
        prioritas_aktif: pendaftar.prioritas_aktif + 1,
        status_berkas: "Menunggu Verifikasi",
        batas_revisi_at: null,
        catatan_revisi: null,
      })
      .eq("id", pendaftarId);

    await supabase.from("pilihan").update({ status: "Menunggu Verifikasi Berkas" }).eq("id", pilihanBerikutnya.id);

    await supabase.from("riwayat_transfer").insert({
      pendaftar_id: pendaftarId,
      dari_sekolah_id: pilihanAktif.sekolah_id,
      ke_sekolah_id: pilihanBerikutnya.sekolah_id,
      alasan: alasanKategori,
    });

    await tambahNotifikasi(
      pendaftarId,
      `Anda belum diterima di ${sekolahLama} (${alasanKategori}). Pendaftaran otomatis dialihkan untuk diproses di ${sekolahBaru} (Pilihan ${pendaftar.prioritas_aktif + 1}).`
    );
  } else {
    await supabase.from("pendaftar").update({ status_global: "Tidak Diterima Final" }).eq("id", pendaftarId);
    await tambahNotifikasi(
      pendaftarId,
      `Anda belum diterima di ${sekolahLama} (${alasanKategori}). Seluruh pilihan sekolah telah diproses — status akhir: Tidak Diterima.`
    );
  }
}

async function terimaFinal(pendaftarId) {
  const { data: pendaftar } = await supabase.from("pendaftar").select("*").eq("id", pendaftarId).single();
  const { data: pilihanAktif } = await supabase
    .from("pilihan")
    .select("*")
    .eq("pendaftar_id", pendaftarId)
    .eq("urutan_prioritas", pendaftar.prioritas_aktif)
    .single();

  await supabase.from("pilihan").update({ status: "Diterima" }).eq("id", pilihanAktif.id);
  await supabase.from("pendaftar").update({ status_global: "Diterima Final" }).eq("id", pendaftarId);
  await supabase
    .from("pilihan")
    .update({ status: "Dibatalkan" })
    .eq("pendaftar_id", pendaftarId)
    .gt("urutan_prioritas", pendaftar.prioritas_aktif);

  const sekolahNama = await getSekolahNama(pilihanAktif.sekolah_id);
  await tambahNotifikasi(pendaftarId, `Selamat! Anda dinyatakan DITERIMA di ${sekolahNama}.`);
}

const JAM_MASA_REVISI = 48; // waktu pendaftar untuk mengunggah ulang berkas yang "Kurang Lengkap"

const formatWaktuWIB = (d) =>
  new Date(d).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "long", timeStyle: "short" }) + " WIB";

/** FR-02: Verifikasi berkas oleh panitia sekolah yang sedang aktif */
async function verifikasiBerkas(pendaftarId, statusBaru, catatan = null) {
  if (statusBaru === "Kurang Lengkap") {
    // Tidak langsung dialihkan: pendaftar diberi masa revisi untuk mengunggah ulang
    const batas = new Date(Date.now() + JAM_MASA_REVISI * 60 * 60 * 1000);
    await supabase
      .from("pendaftar")
      .update({ status_berkas: "Kurang Lengkap", batas_revisi_at: batas.toISOString(), catatan_revisi: catatan || null })
      .eq("id", pendaftarId);

    const { data: pendaftar } = await supabase.from("pendaftar").select("sekolah_aktif_id").eq("id", pendaftarId).single();
    const sekolahNama = await getSekolahNama(pendaftar.sekolah_aktif_id);
    await tambahNotifikasi(
      pendaftarId,
      `Berkas Anda di ${sekolahNama} dinyatakan Kurang Lengkap${catatan ? ` (catatan panitia: ${catatan})` : ""}. ` +
        `Silakan unggah ulang berkas melalui menu Cek Status paling lambat ${formatWaktuWIB(batas)}. ` +
        `Jika tidak direvisi sampai batas waktu tersebut, pendaftaran otomatis dialihkan ke pilihan sekolah berikutnya.`
    );
    return;
  }

  await supabase
    .from("pendaftar")
    .update({ status_berkas: statusBaru, batas_revisi_at: null, catatan_revisi: null })
    .eq("id", pendaftarId);

  if (statusBaru === "Lengkap") {
    const { data: pendaftar } = await supabase.from("pendaftar").select("*").eq("id", pendaftarId).single();
    const { data: pilihanAktif } = await supabase
      .from("pilihan")
      .select("*")
      .eq("pendaftar_id", pendaftarId)
      .eq("urutan_prioritas", pendaftar.prioritas_aktif)
      .single();
    await supabase.from("pilihan").update({ status: "Menunggu Seleksi" }).eq("id", pilihanAktif.id);

    const sekolahNama = await getSekolahNama(pilihanAktif.sekolah_id);
    await tambahNotifikasi(
      pendaftarId,
      `Berkas Anda di ${sekolahNama} telah diverifikasi dan dinyatakan Lengkap. Pendaftaran Anda akan diproses ke tahap seleksi.`
    );
  } else if (statusBaru === "Ditolak") {
    await tolakDanAlihkan(pendaftarId, "Berkas tidak lengkap/tidak sesuai");
  }
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
    await tolakDanAlihkan(p.id, "Berkas tidak direvisi sampai batas waktu");
  }
  return data.length;
}

/** Pendaftar mengunggah berkas saat berstatus Kurang Lengkap: kembali ke antrean verifikasi panitia. */
async function tandaiSudahRevisi(pendaftarId) {
  const { data: pendaftar } = await supabase.from("pendaftar").select("status_berkas, sekolah_aktif_id").eq("id", pendaftarId).single();
  if (pendaftar?.status_berkas !== "Kurang Lengkap") return;
  await supabase
    .from("pendaftar")
    .update({ status_berkas: "Menunggu Verifikasi", batas_revisi_at: null })
    .eq("id", pendaftarId);
  const sekolahNama = await getSekolahNama(pendaftar.sekolah_aktif_id);
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

  for (const k of hasil.diterima) await terimaFinal(k.pendaftar_id);
  for (const k of hasil.ditolakKuota) await tolakDanAlihkan(k.pendaftar_id, "Tidak masuk kuota");
  for (const { k, alasan } of hasil.tidakMemenuhi) await tolakDanAlihkan(k.pendaftar_id, alasan);

  return {
    jumlahDiproses: kandidat.length,
    diterima: hasil.diterima.length,
    ditolakKuota: hasil.ditolakKuota.length,
    ditolakSyarat: hasil.tidakMemenuhi.length,
    sisaKuotaSebelum: sisaKuota,
    kuota: jalur.kuota,
  };
}

module.exports = {
  verifikasiBerkas, jalankanSeleksiJalur, tolakDanAlihkan, terimaFinal, tambahNotifikasi,
  prosesRevisiKedaluwarsa, tandaiSudahRevisi,
};
