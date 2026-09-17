const supabase = require("./supabase");

const BUCKET = "berkas-pendaftar";

/** Dipanggil sekali saat server start: pastikan bucket penyimpanan berkas sudah ada. */
async function pastikanBucketAda() {
  try {
    const { data: buckets, error } = await supabase.storage.listBuckets();
    if (error) {
      console.error("[storage] Gagal mengecek bucket:", error.message);
      return;
    }
    const sudahAda = buckets.some((b) => b.name === BUCKET);
    if (sudahAda) return;

    const { error: createError } = await supabase.storage.createBucket(BUCKET, {
      public: true, // Prototipe: file bisa diakses via URL langsung. Produksi sebaiknya private + signed URL.
      fileSizeLimit: "5MB",
    });
    if (createError) {
      console.error("[storage] Gagal membuat bucket:", createError.message);
    } else {
      console.log(`[storage] Bucket "${BUCKET}" berhasil dibuat.`);
    }
  } catch (err) {
    console.error("[storage] Tidak dapat menghubungi Supabase Storage saat startup:", err.message);
  }
}

/** Upload satu file (buffer) ke Supabase Storage, kembalikan URL publiknya. */
async function uploadBerkas(pendaftarId, jenis, file) {
  const ext = file.originalname.split(".").pop();
  const path = `${pendaftarId}/${jenis.replace(/\s+/g, "-")}-${Date.now()}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file.buffer, {
    contentType: file.mimetype,
    upsert: true,
  });
  if (error) throw new Error(`Upload gagal: ${error.message}`);

  const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return publicUrlData.publicUrl;
}

module.exports = { pastikanBucketAda, uploadBerkas, BUCKET };
