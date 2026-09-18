const supabase = require("./supabase");
const email = require("./email");

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
      `Halo <strong>${pendaftar.nama}</strong>,<br><br>${isi}<br><br>Cek status lengkap pendaftaran Anda di aplikasi SiPPDB.`
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

/** FR-02: Verifikasi berkas oleh panitia sekolah yang sedang aktif */
async function verifikasiBerkas(pendaftarId, statusBaru) {
  await supabase.from("pendaftar").update({ status_berkas: statusBaru }).eq("id", pendaftarId);

  if (statusBaru === "Lengkap") {
    const { data: pendaftar } = await supabase.from("pendaftar").select("*").eq("id", pendaftarId).single();
    const { data: pilihanAktif } = await supabase
      .from("pilihan")
      .select("*")
      .eq("pendaftar_id", pendaftarId)
      .eq("urutan_prioritas", pendaftar.prioritas_aktif)
      .single();
    await supabase.from("pilihan").update({ status: "Menunggu Seleksi" }).eq("id", pilihanAktif.id);
  } else if (statusBaru === "Kurang Lengkap" || statusBaru === "Ditolak") {
    await tolakDanAlihkan(pendaftarId, "Berkas tidak lengkap/tidak sesuai");
  }
}

/** FR-04 + FR-05: Jalankan seleksi & perankingan untuk satu jalur (memicu auto-transfer bila ditolak) */
async function jalankanSeleksiJalur(jalurId) {
  const { data: jalur } = await supabase.from("jalur").select("*").eq("id", jalurId).single();
  const { data: kandidat } = await supabase
    .from("pilihan")
    .select("*")
    .eq("jalur_id", jalurId)
    .eq("status", "Menunggu Seleksi")
    .order("skor", { ascending: false });

  for (let idx = 0; idx < kandidat.length; idx++) {
    const k = kandidat[idx];
    if (idx < jalur.kuota) {
      await terimaFinal(k.pendaftar_id);
    } else if (jalur.syarat_nilai_minimum && k.skor < jalur.syarat_nilai_minimum) {
      await tolakDanAlihkan(k.pendaftar_id, "Nilai rapor tidak memenuhi syarat minimum jalur");
    } else {
      await tolakDanAlihkan(k.pendaftar_id, "Tidak memenuhi batas zonasi/kuota");
    }
  }

  return kandidat.length;
}

module.exports = { verifikasiBerkas, jalankanSeleksiJalur, tolakDanAlihkan, terimaFinal };
