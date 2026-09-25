/* =========================================================
   Aturan bisnis PPDB dalam bentuk fungsi murni (tanpa database/jaringan),
   supaya bisa diuji otomatis lewat `npm test` (lihat folder test/).
   Dipakai oleh server.js (validasi pendaftaran) dan engine.js (seleksi).
   ========================================================= */

/**
 * Batas usia calon siswa SMA dihitung pada 1 Juli tahun ajaran berjalan
 * (acuan aturan SPMB: usia paling tinggi 21 tahun). Batas bawah 12 tahun untuk menangkap salah ketik.
 * Mengembalikan pesan error, atau null kalau valid.
 */
const USIA_MIN = 12;
const USIA_MAKS = 21;
function validasiUmur(tanggalLahir, sekarang = new Date()) {
  const lahir = new Date(`${tanggalLahir}T00:00:00Z`);
  if (Number.isNaN(lahir.getTime())) return "Tanggal lahir tidak valid.";
  if (lahir > sekarang) return "Tanggal lahir tidak boleh di masa depan.";
  const acuan = new Date(Date.UTC(sekarang.getUTCFullYear(), 6, 1)); // 1 Juli tahun ini
  let usia = acuan.getUTCFullYear() - lahir.getUTCFullYear();
  if (acuan < new Date(Date.UTC(acuan.getUTCFullYear(), lahir.getUTCMonth(), lahir.getUTCDate()))) usia--;
  if (usia < USIA_MIN) return `Usia pendaftar ${usia} tahun (per 1 Juli ${acuan.getUTCFullYear()}). Usia minimal ${USIA_MIN} tahun -- periksa kembali tanggal lahir.`;
  if (usia > USIA_MAKS) return `Usia pendaftar ${usia} tahun (per 1 Juli ${acuan.getUTCFullYear()}). Usia maksimal calon siswa SMA adalah ${USIA_MAKS} tahun.`;
  return null;
}

/** "Ahmad Fadhil" -> "Ah*** Fa****": 2 huruf awal tiap kata tetap, sisanya disamarkan. */
function samarkanNama(nama) {
  return String(nama || "")
    .trim()
    .split(/\s+/)
    .filter((kata) => /[\p{L}\p{N}]/u.test(kata)) // lewati "kata" berupa tanda baca saja, mis. "-"
    .map((kata) => (kata.length <= 2 ? kata[0] + "*" : kata.slice(0, 2) + "*".repeat(Math.min(kata.length - 2, 5))))
    .join(" ");
}

/** Kursi yang masih tersedia: kuota dikurangi yang sudah diterima di seleksi sebelumnya (tidak pernah negatif). */
function hitungSisaKuota(kuota, sudahDiterima) {
  return Math.max(0, Number(kuota) - (Number(sudahDiterima) || 0));
}

/**
 * FR-04: Tentukan hasil seleksi satu jalur.
 *  kandidat       : baris pilihan { pendaftar_id, skor, jarak_km, catatan_skor }
 *  jalur          : { syarat_radius_km, syarat_nilai_minimum }
 *  infoPendaftar  : pendaftar_id -> { tanggal_lahir, created_at } (untuk penentu seri)
 *  sisaKuota      : kursi yang masih tersedia
 * Mengembalikan { diterima: [...], ditolakKuota: [...], tidakMemenuhi: [{ k, alasan }] }.
 */
function tentukanHasilSeleksi(kandidat, jalur, infoPendaftar, sisaKuota) {
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

  // 2) Urutkan: zonasi berdasarkan jarak terdekat, jalur lain berdasarkan skor tertinggi.
  // Bila jarak/skor sama: usia lebih tua (tanggal lahir lebih awal) didahulukan, lalu yang mendaftar lebih awal.
  const info = (k) => infoPendaftar(k.pendaftar_id) || {};
  const penentuSeri = (a, b) => {
    const pa = info(a), pb = info(b);
    return String(pa.tanggal_lahir).localeCompare(String(pb.tanggal_lahir))
      || String(pa.created_at).localeCompare(String(pb.created_at));
  };
  memenuhiSyarat.sort(isZonasi
    ? (a, b) => Number(a.jarak_km) - Number(b.jarak_km) || penentuSeri(a, b)
    : (a, b) => b.skor - a.skor || penentuSeri(a, b));

  // 3) Terima sejumlah sisa kuota teratas, sisanya ditolak karena kuota
  return {
    diterima: memenuhiSyarat.slice(0, sisaKuota),
    ditolakKuota: memenuhiSyarat.slice(sisaKuota),
    tidakMemenuhi,
  };
}

module.exports = { USIA_MIN, USIA_MAKS, validasiUmur, samarkanNama, hitungSisaKuota, tentukanHasilSeleksi };
