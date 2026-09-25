const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { validasiUmur, samarkanNama, hitungSisaKuota, tentukanHasilSeleksi } = require("../aturan");

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
    assert.match(hasil.tidakMemenuhi[0].alasan, /Di luar radius zonasi: jarak 3\.50 km melebihi batas 3 km/);
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

  test("tidak ada kandidat -> hasil kosong", () => {
    const hasil = tentukanHasilSeleksi([], { syarat_radius_km: 3 }, info, 3);
    assert.deepEqual(hasil, { diterima: [], ditolakKuota: [], tidakMemenuhi: [] });
  });
});
