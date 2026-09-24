const supabase = require("./supabase");

const BUCKET = "berkas-pendaftar";
const MASA_BERLAKU_LINK_DETIK = 60 * 60; // link berkas yang dibagikan ke browser kedaluwarsa dalam 1 jam

/**
 * Dipanggil sekali saat server start: pastikan bucket penyimpanan berkas ada dan PRIVATE.
 * Berkas KK/akta berisi data pribadi (NIK seluruh keluarga), jadi tidak boleh bisa dibuka
 * lewat URL publik -- akses hanya lewat signed URL yang dibuat server untuk user yang berhak.
 */
async function pastikanBucketAda() {
  try {
    const { data: buckets, error } = await supabase.storage.listBuckets();
    if (error) {
      console.error("[storage] Gagal mengecek bucket:", error.message);
      return;
    }
    const bucket = buckets.find((b) => b.name === BUCKET);

    if (!bucket) {
      const { error: createError } = await supabase.storage.createBucket(BUCKET, {
        public: false,
        fileSizeLimit: "5MB",
      });
      if (createError) console.error("[storage] Gagal membuat bucket:", createError.message);
      else console.log(`[storage] Bucket "${BUCKET}" (private) berhasil dibuat.`);
      return;
    }

    if (bucket.public) {
      const { error: updateError } = await supabase.storage.updateBucket(BUCKET, {
        public: false,
        fileSizeLimit: "5MB",
      });
      if (updateError) console.error("[storage] Gagal mengubah bucket jadi private:", updateError.message);
      else console.log(`[storage] Bucket "${BUCKET}" diubah menjadi private.`);
    }
  } catch (err) {
    console.error("[storage] Tidak dapat menghubungi Supabase Storage saat startup:", err.message);
  }
}

/**
 * Upload satu file (buffer) ke Supabase Storage.
 * Mengembalikan URL "publik" versi Supabase -- dipakai hanya sebagai penanda lokasi file
 * (bucket private, jadi URL ini tidak bisa dibuka langsung). Untuk dibuka, lihat tandatanganiDokumen().
 */
async function uploadBerkas(pendaftarId, jenis, file) {
  const ext = file.originalname.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${pendaftarId}/${jenis.replace(/\s+/g, "-")}-${Date.now()}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file.buffer, {
    contentType: file.mimetype,
    upsert: true,
  });
  if (error) throw new Error(`Upload gagal: ${error.message}`);

  const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return publicUrlData.publicUrl;
}

/** Ambil path file di bucket dari URL yang tersimpan di tabel dokumen. */
function pathDariUrl(url) {
  const penanda = `/object/public/${BUCKET}/`;
  const i = String(url || "").indexOf(penanda);
  return i === -1 ? null : decodeURIComponent(url.slice(i + penanda.length).split("?")[0]);
}

/** Ganti kolom url tiap dokumen dengan signed URL yang kedaluwarsa. */
async function tandatanganiDokumen(dokumenList) {
  if (!dokumenList || dokumenList.length === 0) return [];
  const paths = dokumenList.map((d) => pathDariUrl(d.url));
  const pathValid = paths.filter(Boolean);
  if (pathValid.length === 0) return dokumenList.map((d) => ({ ...d, url: null }));

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(pathValid, MASA_BERLAKU_LINK_DETIK);
  if (error) {
    console.error("[storage] Gagal membuat signed URL:", error.message);
    return dokumenList.map((d) => ({ ...d, url: null }));
  }
  const signedByPath = Object.fromEntries(data.map((x) => [x.path, x.signedUrl]));
  return dokumenList.map((d, i) => ({ ...d, url: signedByPath[paths[i]] || null }));
}

/** Hapus file dari bucket (dipakai saat berkas diganti). Gagal hapus tidak menggagalkan proses. */
async function hapusBerkas(urls) {
  const paths = urls.map(pathDariUrl).filter(Boolean);
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) console.error("[storage] Gagal menghapus berkas lama:", error.message);
}

module.exports = { pastikanBucketAda, uploadBerkas, tandatanganiDokumen, hapusBerkas, BUCKET };
