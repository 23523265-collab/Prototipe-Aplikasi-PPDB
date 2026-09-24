const supabase = require("./supabase");
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

  const isZonasi = jalur.syarat_radius_km != null;
  const radius = Number(jalur.syarat_radius_km);

  // 1) Pisahkan kandidat yang tidak memenuhi syarat dasar jalur
  const memenuhiSyarat = [];
  const tidakMemenuhi = [];
  for (const k of kandidat) {
    if (isZonasi) {
      if (k.jarak_km == null) {
        tidakMemenuhi.push({ k, alasan: `Jarak tidak dapat dihitung (${k.catatan_skor || "lokasi tidak tersedia"})` });
      } else if (Number(k.jarak_km) > radius) {
        tidakMemenuhi.push({ k, alasan: `Di luar radius zonasi: jarak ${Number(k.jarak_km).toFixed(2)} km melebihi batas ${radius} km` });
      } else {
        memenuhiSyarat.push(k);
      }
    } else if (jalur.syarat_nilai_minimum != null && k.skor < jalur.syarat_nilai_minimum) {
      tidakMemenuhi.push({ k, alasan: `Nilai rapor ${k.skor} di bawah syarat minimum ${jalur.syarat_nilai_minimum}` });
    } else {
      memenuhiSyarat.push(k);
    }
  }

  // 2) Urutkan: zonasi berdasarkan jarak terdekat, jalur lain berdasarkan skor tertinggi
  // Bila jarak (zonasi) atau skor (jalur lain) sama: usia lebih tua didahulukan, lalu yang mendaftar lebih awal
  const infoPendaftar = (k) => pendaftarTerkait.find((x) => x.id === k.pendaftar_id) || {};
  const penentuSeri = (a, b) => {
    const pa = infoPendaftar(a), pb = infoPendaftar(b);
    return String(pa.tanggal_lahir).localeCompare(String(pb.tanggal_lahir))
      || String(pa.created_at).localeCompare(String(pb.created_at));
  };
  memenuhiSyarat.sort(isZonasi
    ? (a, b) => Number(a.jarak_km) - Number(b.jarak_km) || penentuSeri(a, b)
    : (a, b) => b.skor - a.skor || penentuSeri(a, b));

  // 3) Terima sejumlah kuota teratas, sisanya ditolak karena kuota
  // Kuota dikurangi yang sudah diterima di seleksi sebelumnya, supaya seleksi berulang tidak melebihi kuota
  const { count: sudahDiterima } = await supabase
    .from("pilihan")
    .select("id", { count: "exact", head: true })
    .eq("jalur_id", jalurId)
    .eq("status", "Diterima");
  const sisaKuota = Math.max(0, jalur.kuota - (sudahDiterima || 0));

  const diterima = Math.min(sisaKuota, memenuhiSyarat.length);
  for (let idx = 0; idx < memenuhiSyarat.length; idx++) {
    if (idx < sisaKuota) {
      await terimaFinal(memenuhiSyarat[idx].pendaftar_id);
    } else {
      await tolakDanAlihkan(memenuhiSyarat[idx].pendaftar_id, "Tidak masuk kuota");
    }
  }
  for (const { k, alasan } of tidakMemenuhi) {
    await tolakDanAlihkan(k.pendaftar_id, alasan);
  }

  return {
    jumlahDiproses: kandidat.length,
    diterima,
    ditolakKuota: memenuhiSyarat.length - diterima,
    ditolakSyarat: tidakMemenuhi.length,
    sisaKuotaSebelum: sisaKuota,
    kuota: jalur.kuota,
  };
}

module.exports = {
  verifikasiBerkas, jalankanSeleksiJalur, tolakDanAlihkan, terimaFinal, tambahNotifikasi,
  prosesRevisiKedaluwarsa, tandaiSudahRevisi,
};
