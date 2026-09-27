const RADIUS_BUMI_KM = 6371;

const keRadian = (derajat) => (derajat * Math.PI) / 180;

/** Jarak garis lurus antara dua titik GPS (rumus Haversine), dalam km. */
function hitungJarakKm(lat1, lng1, lat2, lng2) {
  const dLat = keRadian(lat2 - lat1);
  const dLng = keRadian(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(keRadian(lat1)) * Math.cos(keRadian(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIUS_BUMI_KM * Math.asin(Math.sqrt(a));
}

/** Skor zonasi: 100 untuk jarak 0, berkurang 10 poin per km, minimal 0. */
function skorDariJarak(jarakKm) {
  return Math.max(0, Math.min(100, 100 - 10 * jarakKm));
}

module.exports = { hitungJarakKm, skorDariJarak };
