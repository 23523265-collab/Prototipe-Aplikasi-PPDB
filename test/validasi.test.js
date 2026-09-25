const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { validasiNIK, validasiBerkas } = require("../validasi");

describe("validasiNIK (hanya peringatan untuk panitia, tidak menolak)", () => {
  test("16 digit angka wajar -> tidak ada catatan", () => {
    assert.equal(validasiNIK("3404011205100001"), null);
  });
  test("mengandung huruf", () => {
    assert.match(validasiNIK("34040112051000AB"), /selain angka/);
  });
  test("panjang bukan 16 digit", () => {
    assert.match(validasiNIK("340401120510000"), /15 digit, seharusnya 16/);
  });
  test("angka sama berulang", () => {
    assert.match(validasiNIK("1111111111111111"), /berulang/);
  });
});

describe("validasiBerkas (ukuran & isi file vs tipe yang diklaim)", () => {
  const isi = (awal, ukuranKb) => Buffer.concat([Buffer.from(awal, "hex"), Buffer.alloc(ukuranKb * 1024)]);

  test("PDF asli berukuran wajar -> tidak ada catatan", () => {
    assert.equal(validasiBerkas({ buffer: isi("255044462d", 50), mimetype: "application/pdf" }), null);
  });
  test("JPG dan PNG asli dikenali", () => {
    assert.equal(validasiBerkas({ buffer: isi("ffd8ffe0", 50), mimetype: "image/jpeg" }), null);
    assert.equal(validasiBerkas({ buffer: isi("89504e470d0a1a0a", 50), mimetype: "image/png" }), null);
  });
  test("file yang diganti ekstensinya (isi PNG, diklaim PDF) ditandai", () => {
    assert.match(validasiBerkas({ buffer: isi("89504e47", 50), mimetype: "application/pdf" }), /diganti nama ekstensinya/);
  });
  test("file sangat kecil ditandai kemungkinan kosong/rusak", () => {
    assert.match(validasiBerkas({ buffer: isi("25504446", 1), mimetype: "application/pdf" }), /sangat kecil/);
  });
});
