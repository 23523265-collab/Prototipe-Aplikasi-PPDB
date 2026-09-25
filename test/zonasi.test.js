const { test } = require("node:test");
const assert = require("node:assert/strict");
const { hitungJarakKm, skorDariJarak } = require("../zonasi");

test("jarak titik yang sama adalah 0 km", () => {
  assert.equal(hitungJarakKm(-7.7829, 110.3671, -7.7829, 110.3671), 0);
});

test("1 derajat lintang ≈ 111,19 km (Haversine, jari-jari bumi 6371 km)", () => {
  assert.ok(Math.abs(hitungJarakKm(0, 0, 1, 0) - 111.195) < 0.01);
});

test("jarak simetris: A→B sama dengan B→A", () => {
  const ab = hitungJarakKm(-7.6905, 110.4108, -7.7829, 110.3671);
  const ba = hitungJarakKm(-7.7829, 110.3671, -7.6905, 110.4108);
  assert.ok(Math.abs(ab - ba) < 1e-9);
});

test("jarak nyata: Jl. Kaliurang km 12,5 ke Tugu Yogyakarta ± 11 km", () => {
  const km = hitungJarakKm(-7.6905, 110.4108, -7.7829, 110.3671);
  assert.ok(km > 10.5 && km < 12, `didapat ${km.toFixed(2)} km`);
});

test("skor zonasi = 100 − 10 × km", () => {
  assert.equal(skorDariJarak(0), 100);
  assert.equal(skorDariJarak(1), 90);
  assert.ok(Math.abs(skorDariJarak(3.4) - 66) < 1e-9);
});

test("skor zonasi dibatasi 0–100 (tidak negatif untuk jarak jauh)", () => {
  assert.equal(skorDariJarak(10), 0);
  assert.equal(skorDariJarak(25), 0);
  assert.equal(skorDariJarak(-1), 100);
});
