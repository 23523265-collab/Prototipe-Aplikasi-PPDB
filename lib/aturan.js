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

/* ---------------------------------------------------------
   Jalur SPMB 2026 (migration v7.1)
   - urut      : "jarak" (terdekat dulu) atau "skor" (tertinggi dulu)
   - radius    : wajib berada dalam radius jalur (hanya domisili)
   - nilaiMin  : skor harus >= syarat_nilai_minimum jalur (jika diisi)
   - dokumen   : berkas tambahan di luar berkas dasar
   --------------------------------------------------------- */
const DOKUMEN_DASAR = ["Kartu Keluarga", "Akta Kelahiran", "Rapor Terakhir"];
const JENIS_JALUR = {
  domisili: { label: "Domisili", urut: "jarak", radius: true, nilaiMin: false, dokumen: [] },
  afirmasi: { label: "Afirmasi", urut: "jarak", radius: false, nilaiMin: false, dokumen: ["Bukti Afirmasi"] },
  mutasi: { label: "Mutasi", urut: "jarak", radius: false, nilaiMin: false, dokumen: ["Surat Mutasi"] },
  prestasi_akademik: { label: "Prestasi Akademik", urut: "skor", radius: false, nilaiMin: true, dokumen: [] },
  prestasi_nonakademik: { label: "Prestasi Nonakademik", urut: "skor", radius: false, nilaiMin: true, dokumen: ["Sertifikat Prestasi"] },
};

/** Kategori yang dipilih calon siswa untuk jalur khusus (migration v7.2) */
const KATEGORI_AFIRMASI = { kip: "Pemegang KIP", pkh: "Peserta PKH", dtks: "Terdaftar DTKS", disabilitas: "Penyandang disabilitas" };
const KATEGORI_MUTASI = { pindah_tugas: "Orang tua/wali pindah tugas", anak_gtk: "Anak guru/tenaga kependidikan" };

/**
 * Validasi kategori sesuai jalur yang dipilih. Kategori yang tidak relevan dibuang (null).
 * Mengembalikan { error } atau { data: { kategori_afirmasi, kategori_mutasi, keterangan_prestasi } }.
 */
function validasiKategoriJalur(daftarJenis, masukan = {}) {
  const pakai = (j) => daftarJenis.includes(j);
  const data = { kategori_afirmasi: null, kategori_mutasi: null, keterangan_prestasi: null };
  if (pakai("afirmasi")) {
    if (!KATEGORI_AFIRMASI[masukan.kategoriAfirmasi]) return { error: "Pilih kategori afirmasi (KIP, PKH, DTKS, atau disabilitas)." };
    data.kategori_afirmasi = masukan.kategoriAfirmasi;
  }
  if (pakai("mutasi")) {
    if (!KATEGORI_MUTASI[masukan.kategoriMutasi]) return { error: "Pilih kategori mutasi (pindah tugas orang tua atau anak guru/tenaga kependidikan)." };
    data.kategori_mutasi = masukan.kategoriMutasi;
  }
  if (pakai("prestasi_nonakademik")) {
    const ket = String(masukan.keteranganPrestasi || "").trim();
    if (ket.length < 5) return { error: "Tuliskan prestasi nonakademik (nama lomba/kegiatan dan tingkatnya)." };
    data.keterangan_prestasi = ket.slice(0, 300);
  }
  return { data };
}

/** Jenis jalur; untuk data sebelum migration v7.1 ditebak dari syaratnya. */
function jenisJalur(jalur) {
  if (jalur?.jenis && JENIS_JALUR[jalur.jenis]) return jalur.jenis;
  if (jalur?.syarat_radius_km != null) return "domisili";
  if (jalur?.syarat_nilai_minimum != null) return "prestasi_akademik";
  return "domisili";
}

/** Berkas wajib untuk sekumpulan jalur (berkas dasar + berkas tambahan tiap jalur, tanpa duplikat). */
function dokumenWajib(daftarJalur) {
  const tambahan = daftarJalur.flatMap((j) => JENIS_JALUR[jenisJalur(j)].dokumen);
  return [...new Set([...DOKUMEN_DASAR, ...tambahan])];
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
  const jenis = jenisJalur(jalur);
  const aturanJalur = JENIS_JALUR[jenis];
  const radius = Number(jalur.syarat_radius_km);
  const nilaiMin = aturanJalur.nilaiMin && jalur.syarat_nilai_minimum != null ? Number(jalur.syarat_nilai_minimum) : null;
  const namaSkor = jenis === "prestasi_nonakademik" ? "Skor prestasi nonakademik" : "Nilai rapor";

  // 1) Pisahkan kandidat yang tidak memenuhi syarat dasar jalur.
  //    Afirmasi & mutasi tidak punya syarat angka: kelayakannya dibuktikan lewat berkas yang sudah diverifikasi panitia.
  const memenuhiSyarat = [];
  const tidakMemenuhi = [];
  for (const k of kandidat) {
    if (aturanJalur.radius && k.jarak_km == null) {
      tidakMemenuhi.push({ k, alasan: `Jarak tidak dapat dihitung (${k.catatan_skor || "lokasi tidak tersedia"})` });
    } else if (aturanJalur.radius && Number(k.jarak_km) > radius) {
      tidakMemenuhi.push({ k, alasan: `Di luar radius domisili: jarak ${Number(k.jarak_km).toFixed(2)} km melebihi batas ${radius} km` });
    } else if (nilaiMin != null && k.skor < nilaiMin) {
      tidakMemenuhi.push({ k, alasan: `${namaSkor} ${k.skor} di bawah syarat minimum ${nilaiMin}` });
    } else {
      memenuhiSyarat.push(k);
    }
  }

  // 2) Urutkan: domisili/afirmasi/mutasi berdasarkan jarak terdekat (tanpa lokasi di urutan terakhir),
  //    prestasi berdasarkan skor tertinggi.
  // Bila jarak/skor sama: usia lebih tua (tanggal lahir lebih awal) didahulukan, lalu yang mendaftar lebih awal.
  const info = (k) => infoPendaftar(k.pendaftar_id) || {};
  const penentuSeri = (a, b) => {
    const pa = info(a), pb = info(b);
    return String(pa.tanggal_lahir).localeCompare(String(pb.tanggal_lahir))
      || String(pa.created_at).localeCompare(String(pb.created_at));
  };
  const jarakUrut = (k) => (k.jarak_km == null ? Infinity : Number(k.jarak_km));
  memenuhiSyarat.sort(aturanJalur.urut === "jarak"
    ? (a, b) => (jarakUrut(a) - jarakUrut(b)) || penentuSeri(a, b)
    : (a, b) => b.skor - a.skor || penentuSeri(a, b));

  // 3) Terima sejumlah sisa kuota teratas, sisanya ditolak karena kuota
  return {
    diterima: memenuhiSyarat.slice(0, sisaKuota),
    ditolakKuota: memenuhiSyarat.slice(sisaKuota),
    tidakMemenuhi,
  };
}

/**
 * FR-11: Estimasi posisi sementara satu pendaftar di jalurnya, memakai aturan yang SAMA dengan seleksi
 * (tentukanHasilSeleksi), sehingga estimasi dan hasil akhir tidak pernah memakai rumus berbeda.
 *  pesaing : semua kandidat yang masih bersaing di jalur ini, termasuk pendaftar itu sendiri
 * Mengembalikan { memenuhiSyarat, alasan, posisi, jumlahPesaing, sisaKuota, masukKuota },
 * atau null kalau pendaftar tidak ada di daftar pesaing.
 */
function estimasiPeringkat(pendaftarId, pesaing, jalur, infoPendaftar, sisaKuota) {
  const hasil = tentukanHasilSeleksi(pesaing, jalur, infoPendaftar, sisaKuota);
  const urutan = [...hasil.diterima, ...hasil.ditolakKuota];
  const gagal = hasil.tidakMemenuhi.find(({ k }) => k.pendaftar_id === pendaftarId);
  if (gagal) {
    return { memenuhiSyarat: false, alasan: gagal.alasan, posisi: null, jumlahPesaing: urutan.length, sisaKuota, masukKuota: false };
  }
  const indeks = urutan.findIndex((k) => k.pendaftar_id === pendaftarId);
  if (indeks < 0) return null;
  return { memenuhiSyarat: true, alasan: null, posisi: indeks + 1, jumlahPesaing: urutan.length, sisaKuota, masukKuota: indeks < sisaKuota };
}

/**
 * K2: Daftar ulang. Siswa yang diterima wajib mengonfirmasi dalam JAM_DAFTAR_ULANG jam;
 * bila lewat, kursinya dilepas dan dapat diisi lewat seleksi tahap 2.
 */
const JAM_DAFTAR_ULANG = 72;

function batasDaftarUlang(waktuDiterima = new Date()) {
  return new Date(new Date(waktuDiterima).getTime() + JAM_DAFTAR_ULANG * 60 * 60 * 1000);
}

/** "sudah" | "belum" | "lewat" (batas terlewati, kursi harus dilepas) | null (bukan siswa yang diterima) */
function statusDaftarUlang(p, sekarang = new Date()) {
  if (p.status_global === "Tidak Daftar Ulang") return "lewat";
  if (p.status_global === "Mengundurkan Diri") return p.daftar_ulang_batas_at ? "mundur" : null;
  if (p.status_global !== "Diterima Final") return null;
  if (p.daftar_ulang_at) return "sudah";
  if (p.daftar_ulang_batas_at && new Date(p.daftar_ulang_batas_at) < new Date(sekarang)) return "lewat";
  return "belum";
}

/** K4: pendaftar boleh mengundurkan diri selama masih diproses, atau sudah diterima (kursi dilepas) */
function bisaMundur(p) {
  return p?.status_global === "Aktif" || p?.status_global === "Diterima Final";
}

module.exports = {
  USIA_MIN, USIA_MAKS, DOKUMEN_DASAR, JENIS_JALUR, KATEGORI_AFIRMASI, KATEGORI_MUTASI, JAM_DAFTAR_ULANG,
  validasiUmur, samarkanNama, hitungSisaKuota, tentukanHasilSeleksi, estimasiPeringkat, jenisJalur, dokumenWajib, validasiKategoriJalur,
  batasDaftarUlang, statusDaftarUlang, bisaMundur,
};
