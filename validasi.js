/**
 * FR-09: Pra-Verifikasi Berkas Berbantuan Validasi Otomatis
 *
 * Prinsip penting (sesuai PRD): validasi ini HANYA memberi flag/peringatan,
 * TIDAK PERNAH menolak pendaftaran atau berkas secara otomatis.
 * Keputusan akhir selalu di tangan panitia manusia.
 */

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

module.exports = { validasiBerkas, validasiNIK };
