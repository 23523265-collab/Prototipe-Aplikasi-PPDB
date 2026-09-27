const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { validasiUmur, samarkanNama, hitungSisaKuota, tentukanHasilSeleksi, jenisJalur, dokumenWajib, validasiKategoriJalur } = require("../lib/aturan");

describe("kategori jalur khusus", () => {
  test("wajib diisi sesuai jalur yang dipilih", () => {
    assert.match(validasiKategoriJalur(["afirmasi"], {}).error, /kategori afirmasi/);
    assert.match(validasiKategoriJalur(["mutasi"], { kategoriMutasi: "pensiun" }).error, /kategori mutasi/);
    assert.match(validasiKategoriJalur(["prestasi_nonakademik"], { keteranganPrestasi: " " }).error, /prestasi nonakademik/);
  });
  test("kategori jalur yang tidak dipilih dibuang", () => {
    const { data } = validasiKategoriJalur(["domisili", "afirmasi"], { kategoriAfirmasi: "kip", kategoriMutasi: "anak_gtk", keteranganPrestasi: "Juara 1 OSN" });
    assert.deepEqual(data, { kategori_afirmasi: "kip", kategori_mutasi: null, keterangan_prestasi: null });
  });
});

describe("jalur SPMB: jenis & berkas wajib", () => {
  test("jenis dari kolom jenis; data lama ditebak dari syaratnya", () => {
    assert.equal(jenisJalur({ jenis: "mutasi" }), "mutasi");
    assert.equal(jenisJalur({ syarat_radius_km: 3 }), "domisili");
    assert.equal(jenisJalur({ syarat_nilai_minimum: 75 }), "prestasi_akademik");
  });
  test("berkas dasar + berkas tambahan sesuai jalur yang dipilih, tanpa duplikat", () => {
    assert.deepEqual(dokumenWajib([{ jenis: "domisili" }]), ["Kartu Keluarga", "Akta Kelahiran", "Rapor Terakhir"]);
    assert.deepEqual(
      dokumenWajib([{ jenis: "afirmasi" }, { jenis: "prestasi_nonakademik" }, { jenis: "afirmasi" }]),
      ["Kartu Keluarga", "Akta Kelahiran", "Rapor Terakhir", "Bukti Afirmasi", "Sertifikat Prestasi"]
    );
  });
});

// Tanggal "hari ini" dikunci supaya hasil tes tidak berubah tiap tahun
const HARI_INI = new Date("2026-09-25T00:00:00Z"); // acuan usia: 1 Juli 2026

describe("validasiUmur (12–21 tahun per 1 Juli)", () => {
  test("usia 16 tahun valid", () => {
    assert.equal(validasiUmur("2010-05-12", HARI_INI), null);
  });
  test("batas bawah: tepat 12 tahun pada 1 Juli valid, sehari lebih muda ditolak", () => {
    assert.equal(validasiUmur("2014-07-01", HARI_INI), null);
    assert.match(validasiUmur("2014-07-02", HARI_INI), /minimal 12 tahun/);
  });
  test("batas atas: 21 tahun valid, 22 tahun ditolak", () => {
    assert.equal(validasiUmur("2004-07-02", HARI_INI), null); // baru 22 tahun pada 2 Juli
    assert.match(validasiUmur("2004-07-01", HARI_INI), /maksimal calon siswa SMA adalah 21 tahun/);
  });
  test("tanggal di masa depan dan format salah ditolak", () => {
    assert.match(validasiUmur("2027-01-01", HARI_INI), /masa depan/);
    assert.equal(validasiUmur("bukan-tanggal", HARI_INI), "Tanggal lahir tidak valid.");
  });
});

describe("samarkanNama (privasi di halaman Pengumuman)", () => {
  test("2 huruf awal tiap kata tetap, sisanya bintang (maks. 5)", () => {
    assert.equal(samarkanNama("Ahmad Fadhil"), "Ah*** Fa****");
    assert.equal(samarkanNama("Muhammad Agil Mubarak"), "Mu***** Ag** Mu*****");
  });
  test("kata pendek, tanda baca, spasi berlebih, dan nama kosong", () => {
    assert.equal(samarkanNama("Al"), "A*");
    assert.equal(samarkanNama("  Budi  -  Santoso "), "Bu** Sa*****");
    assert.equal(samarkanNama(""), "");
    assert.equal(samarkanNama(null), "");
  });
});

describe("hitungSisaKuota", () => {
  test("kuota dikurangi yang sudah diterima, tidak pernah negatif", () => {
    assert.equal(hitungSisaKuota(3, 1), 2);
    assert.equal(hitungSisaKuota(3, 0), 3);
    assert.equal(hitungSisaKuota(3, null), 3);
    assert.equal(hitungSisaKuota(3, 5), 0);
  });
});

describe("tentukanHasilSeleksi", () => {
  // Data pendaftar untuk penentu seri: tanggal lahir lebih awal = lebih tua
  const pendaftar = {
    1: { tanggal_lahir: "2010-03-01", created_at: "2026-06-01T08:00:00" },
    2: { tanggal_lahir: "2009-11-20", created_at: "2026-06-02T08:00:00" }, // paling tua
    3: { tanggal_lahir: "2010-03-01", created_at: "2026-06-01T07:00:00" }, // lahir sama dgn #1, daftar lebih awal
    4: { tanggal_lahir: "2010-08-15", created_at: "2026-06-03T08:00:00" },
    5: { tanggal_lahir: "2010-01-10", created_at: "2026-06-04T08:00:00" },
  };
  const info = (id) => pendaftar[id];
  const id = (daftar) => daftar.map((k) => k.pendaftar_id);

  test("zonasi: di luar radius / tanpa lokasi ditolak syarat; sisanya urut jarak terdekat", () => {
    const jalur = { syarat_radius_km: 3, syarat_nilai_minimum: null };
    const kandidat = [
      { pendaftar_id: 1, jarak_km: 2.5 },
      { pendaftar_id: 2, jarak_km: 3.5 },
      { pendaftar_id: 3, jarak_km: 1.2 },
      { pendaftar_id: 4, jarak_km: null, catatan_skor: "Lokasi tidak tersedia" },
      { pendaftar_id: 5, jarak_km: 0.8 },
    ];
    const hasil = tentukanHasilSeleksi(kandidat, jalur, info, 2);
    assert.deepEqual(id(hasil.diterima), [5, 3]);
    assert.deepEqual(id(hasil.ditolakKuota), [1]);
    assert.deepEqual(hasil.tidakMemenuhi.map((x) => x.k.pendaftar_id), [2, 4]);
    assert.match(hasil.tidakMemenuhi[0].alasan, /Di luar radius domisili: jarak 3\.50 km melebihi batas 3 km/);
    assert.match(hasil.tidakMemenuhi[1].alasan, /Lokasi tidak tersedia/);
  });

  test("zonasi: jarak tepat sama dengan radius masih memenuhi syarat", () => {
    const hasil = tentukanHasilSeleksi([{ pendaftar_id: 1, jarak_km: 3 }], { syarat_radius_km: 3 }, info, 1);
    assert.deepEqual(id(hasil.diterima), [1]);
  });

  test("jarak sama: usia lebih tua didahulukan, lalu yang mendaftar lebih awal", () => {
    const jalur = { syarat_radius_km: 5 };
    const kandidat = [
      { pendaftar_id: 1, jarak_km: 2 },
      { pendaftar_id: 3, jarak_km: 2 },
      { pendaftar_id: 2, jarak_km: 2 },
    ];
    const hasil = tentukanHasilSeleksi(kandidat, jalur, info, 3);
    // #2 paling tua; #1 dan #3 lahir sama -> #3 mendaftar lebih awal
    assert.deepEqual(id(hasil.diterima), [2, 3, 1]);
  });

  test("prestasi: di bawah nilai minimum ditolak; urut nilai tertinggi, seri -> lebih tua", () => {
    const jalur = { syarat_radius_km: null, syarat_nilai_minimum: 75 };
    const kandidat = [
      { pendaftar_id: 1, skor: 90 },
      { pendaftar_id: 2, skor: 90 },
      { pendaftar_id: 3, skor: 74 },
      { pendaftar_id: 4, skor: 80 },
      { pendaftar_id: 5, skor: 75 }, // tepat minimum -> memenuhi
    ];
    const hasil = tentukanHasilSeleksi(kandidat, jalur, info, 2);
    assert.deepEqual(id(hasil.diterima), [2, 1]);
    assert.deepEqual(id(hasil.ditolakKuota), [4, 5]);
    assert.deepEqual(hasil.tidakMemenuhi.map((x) => x.k.pendaftar_id), [3]);
    assert.match(hasil.tidakMemenuhi[0].alasan, /Nilai rapor 74 di bawah syarat minimum 75/);
  });

  test("kuota habis (sisa 0): semua yang memenuhi syarat ditolak karena kuota", () => {
    const hasil = tentukanHasilSeleksi(
      [{ pendaftar_id: 1, jarak_km: 1 }, { pendaftar_id: 2, jarak_km: 2 }], { syarat_radius_km: 3 }, info, 0
    );
    assert.equal(hasil.diterima.length, 0);
    assert.deepEqual(id(hasil.ditolakKuota), [1, 2]);
  });

  test("afirmasi & mutasi: tanpa syarat radius, urut jarak terdekat, tanpa lokasi di urutan terakhir", () => {
    for (const jenis of ["afirmasi", "mutasi"]) {
      const kandidat = [
        { pendaftar_id: 1, jarak_km: 9.5 },            // jauh, tetap memenuhi syarat
        { pendaftar_id: 2, jarak_km: null },           // lokasi tidak ada -> paling akhir, bukan ditolak
        { pendaftar_id: 3, jarak_km: 2.1 },
      ];
      const hasil = tentukanHasilSeleksi(kandidat, { jenis, syarat_radius_km: null }, info, 2);
      assert.deepEqual(id(hasil.diterima), [3, 1], jenis);
      assert.deepEqual(id(hasil.ditolakKuota), [2], jenis);
      assert.equal(hasil.tidakMemenuhi.length, 0, jenis);
    }
  });

  test("prestasi nonakademik: urut skor panitia; nilai minimum hanya berlaku jika diisi", () => {
    const kandidat = [{ pendaftar_id: 1, skor: 60 }, { pendaftar_id: 4, skor: 85 }, { pendaftar_id: 5, skor: 85 }];
    const tanpaMin = tentukanHasilSeleksi(kandidat, { jenis: "prestasi_nonakademik", syarat_nilai_minimum: null }, info, 3);
    assert.deepEqual(id(tanpaMin.diterima), [5, 4, 1]); // #5 lahir lebih awal dari #4
    const denganMin = tentukanHasilSeleksi(kandidat, { jenis: "prestasi_nonakademik", syarat_nilai_minimum: 70 }, info, 3);
    assert.match(denganMin.tidakMemenuhi[0].alasan, /Skor prestasi nonakademik 60 di bawah syarat minimum 70/);
  });

  test("tidak ada kandidat -> hasil kosong", () => {
    const hasil = tentukanHasilSeleksi([], { syarat_radius_km: 3 }, info, 3);
    assert.deepEqual(hasil, { diterima: [], ditolakKuota: [], tidakMemenuhi: [] });
  });
});
