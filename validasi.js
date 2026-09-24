/**
 * FR-09: Pra-Verifikasi Berkas Berbantuan Validasi Otomatis
 *
 * Prinsip penting (sesuai PRD): validasi ini HANYA memberi flag/peringatan,
 * TIDAK PERNAH menolak pendaftaran atau berkas secara otomatis.
 * Keputusan akhir selalu di tangan panitia manusia.
 */

const { hitungJarakKm } = require("./zonasi");

// Magic bytes: beberapa byte pertama tiap jenis file yang jadi "tanda tangan"-nya.
// Ini dipakai untuk mendeteksi file yang di-rename (mis. file .txt diubah namanya jadi .pdf).
function cocokMagicBytes(buffer, mimetype) {
  if (buffer.length < 4) return false;
  const hex = buffer.subarray(0, 4).toString("hex").toLowerCase();

  if (mimetype === "application/pdf") return hex.startsWith("25504446"); // %PDF
  if (mimetype === "image/jpeg") return hex.startsWith("ffd8ff");
  if (mimetype === "image/png") return hex.startsWith("89504e47");
  return true; // tipe lain tidak dicek ketat, supaya tidak salah tolak
}

/** Validasi satu file yang baru diunggah. Mengembalikan catatan (string) atau null kalau tidak ada masalah. */
function validasiBerkas(file) {
  const catatan = [];

  // 1. Ukuran terlalu kecil -- kemungkinan file kosong/rusak/screenshot placeholder
  const KB = 1024;
  if (file.buffer.length < 5 * KB) {
    catatan.push(`Ukuran file sangat kecil (${Math.round(file.buffer.length / KB)} KB) -- kemungkinan file kosong atau rusak.`);
  }

  // 2. Isi file tidak cocok dengan tipe yang diklaim (indikasi file di-rename)
  if (!cocokMagicBytes(file.buffer, file.mimetype)) {
    catatan.push(`Isi file tidak sesuai format ${file.mimetype} yang seharusnya -- kemungkinan file diganti nama ekstensinya.`);
  }

  return catatan.length > 0 ? catatan.join(" ") : null;
}

/** Validasi NIK saat pendaftaran. Mengembalikan catatan (string) atau null kalau tidak ada masalah. */
function validasiNIK(nik) {
  const catatan = [];

  if (!/^\d+$/.test(nik)) {
    catatan.push("NIK mengandung karakter selain angka.");
  }
  if (nik.length !== 16) {
    catatan.push(`Panjang NIK ${nik.length} digit, seharusnya 16 digit.`);
  }
  if (/^(\d)\1+$/.test(nik)) {
    catatan.push("NIK terdiri dari angka yang sama berulang -- kemungkinan data belum diisi dengan benar.");
  }

  return catatan.length > 0 ? catatan.join(" ") : null;
}

/* ---------------------------------------------------------
   Pra-Verifikasi Alamat vs Titik GPS
   Alamat diubah jadi koordinat lewat Nominatim (OpenStreetMap),
   lalu dibandingkan dengan titik GPS dari browser pendaftar.
   --------------------------------------------------------- */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
// Kebijakan Nominatim: wajib User-Agent yang jelas dan maksimal 1 request/detik
const NOMINATIM_UA = "SiPPDB-prototype/6.7";
const BATAS_KM_JALAN = 1;   // hasil ketemu sampai level jalan/bangunan
const BATAS_KM_WILAYAH = 3; // hasil hanya ketemu level kelurahan/kecamatan
const RADIUS_CARI_DEKAT_KM = 2; // "apakah ada jalan/tempat bernama ini di sekitar titik GPS?"
const TIPE_PRESISI_JALAN = ["road", "house", "building", "residential", "amenity", "hamlet", "neighbourhood", "isolated_dwelling"];
// Wilayah layanan PPDB (DIY): pencarian dibatasi di sini supaya "Jalan Kaliurang" tidak nyasar ke Malang
const VIEWBOX_WILAYAH = [110.0, -7.54, 110.86, -8.22]; // kiri, atas, kanan, bawah

const jeda = (ms) => new Promise((r) => setTimeout(r, ms));

// Rapikan penulisan alamat yang umum di Indonesia, lalu buang bagian yang tidak dikenali Nominatim
function bersihkanAlamat(alamat) {
  return alamat
    .replace(/\b(jln|jl)\b\.?\s*/gi, "Jalan ")
    .replace(/\bgg\b\.?\s*/gi, "Gang ")
    .replace(/\bkm\.?\s*\d+([.,]\d+)?/gi, "")          // "km 12,5" -- patok jalan, tidak ada di peta
    .replace(/\bRT\.?\s*\d+\s*(\/|,)?\s*(RW\.?\s*\d+)?/gi, "")
    .replace(/\bRW\.?\s*\d+/gi, "")
    .replace(/\b(No|Nomor)\.?\s*\d+[A-Za-z]?/gi, "")
    .replace(/\b\d{5}\b/g, "")
    .split(",").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
}

async function cariKoordinat(query, viewbox) {
  const url = `${NOMINATIM_URL}?format=jsonv2&limit=1&countrycodes=id&bounded=1&viewbox=${viewbox.join(",")}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "User-Agent": NOMINATIM_UA }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const [hasil] = await res.json();
  return hasil || null;
}

function kotakSekitar(lat, lng, km) {
  const dLat = km / 111;
  const dLng = km / (111 * Math.cos((lat * Math.PI) / 180));
  return [lng - dLng, lat + dLat, lng + dLng, lat - dLat];
}

/**
 * Bandingkan alamat dengan titik GPS. Mengembalikan
 * { catatan, latitude, longitude, presisi } -- catatan null berarti tidak ada masalah.
 * Tidak pernah melempar error: kalau layanan peta gagal, pendaftaran tetap jalan.
 *
 * Langkah: (1) cari nama jalan/tempat itu di sekitar titik GPS -- cocok untuk jalan panjang
 * seperti Jl. Kaliurang yang tidak bisa diwakili satu titik; (2) kalau tidak ada di sekitar,
 * cari di seluruh wilayah DIY lalu ukur selisihnya dengan titik GPS.
 */
async function validasiAlamat(alamat, latGps, lngGps) {
  const kosong = { catatan: null, latitude: null, longitude: null, presisi: null };
  if (!alamat || latGps == null || lngGps == null) return kosong;

  const bagian = bersihkanAlamat(alamat);
  if (bagian.length === 0) return kosong;

  // Coba alamat lengkap dulu, lalu buang bagian terdepan satu per satu (maks. 3 percobaan)
  const percobaan = [];
  for (let i = 0; i < bagian.length && percobaan.length < 3; i++) {
    if (i > 0 && bagian.length - i < 2) break; // jangan sampai tinggal nama kota saja
    percobaan.push(bagian.slice(i).join(", "));
  }

  const sekitarGps = kotakSekitar(latGps, lngGps, RADIUS_CARI_DEKAT_KM);
  let permintaan = 0;
  const cari = async (q, box) => {
    if (permintaan++ > 0) await jeda(1100);
    return cariKoordinat(q, box);
  };

  try {
    for (let i = 0; i < percobaan.length; i++) {
      // (1) Ada di sekitar titik GPS -> alamat konsisten dengan lokasi
      const dekat = await cari(percobaan[i], sekitarGps);
      if (dekat) {
        const presisi = i === 0 && TIPE_PRESISI_JALAN.includes(dekat.addresstype) ? "jalan" : "wilayah";
        return { catatan: null, latitude: Number(dekat.lat), longitude: Number(dekat.lon), presisi };
      }

      // (2) Tidak ada di sekitar GPS -- cari di seluruh wilayah, ukur selisihnya
      const hasil = await cari(percobaan[i], VIEWBOX_WILAYAH);
      if (!hasil) continue;

      const lat = Number(hasil.lat);
      const lng = Number(hasil.lon);
      const presisi = i === 0 && TIPE_PRESISI_JALAN.includes(hasil.addresstype) ? "jalan" : "wilayah";
      const batas = presisi === "jalan" ? BATAS_KM_JALAN : BATAS_KM_WILAYAH;
      const selisih = hitungJarakKm(latGps, lngGps, lat, lng);

      const catatan = selisih > batas
        ? `Alamat dan titik GPS berselisih ${selisih.toFixed(1)} km (ketepatan pencarian: level ${presisi}) -- kemungkinan tidak cocok, cocokkan dengan KK.`
        : null;
      return { catatan, latitude: lat, longitude: lng, presisi };
    }
    return { ...kosong, catatan: "Alamat tidak ditemukan di peta OpenStreetMap -- cocokkan titik GPS dengan alamat di KK secara manual." };
  } catch (err) {
    return { ...kosong, catatan: `Alamat tidak dapat dicek otomatis (${err.message}) -- periksa manual.` };
  }
}

module.exports = { validasiBerkas, validasiNIK, validasiAlamat };
