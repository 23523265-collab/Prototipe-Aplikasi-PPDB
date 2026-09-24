/**
 * RESET BERKAS DEMO — hapus semua file berkas pendaftar di Supabase Storage.
 * Pasangan dari reset-data-demo.sql (Supabase tidak mengizinkan hapus file storage lewat SQL).
 *
 * ⚠ TIDAK BISA DIBATALKAN.
 * Pakai:  node reset-berkas-demo.js         -> hanya menampilkan jumlah file (tidak menghapus)
 *         node reset-berkas-demo.js --ya    -> benar-benar menghapus
 */
require("dotenv").config({ quiet: true });
const supabase = require("./supabase");
const { BUCKET } = require("./storage");

async function daftarSemuaFile() {
  const paths = [];
  const { data: folders, error } = await supabase.storage.from(BUCKET).list("", { limit: 1000 });
  if (error) throw new Error(error.message);
  for (const item of folders) {
    if (item.id) { paths.push(item.name); continue; } // file di root bucket
    const { data: files, error: err } = await supabase.storage.from(BUCKET).list(item.name, { limit: 1000 });
    if (err) throw new Error(err.message);
    files.forEach((f) => paths.push(`${item.name}/${f.name}`));
  }
  return paths;
}

(async () => {
  const paths = await daftarSemuaFile();
  console.log(`Bucket "${BUCKET}": ${paths.length} file berkas pendaftar.`);

  if (!process.argv.includes("--ya")) {
    console.log("Belum ada yang dihapus. Jalankan dengan --ya untuk menghapus semuanya.");
    return;
  }

  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await supabase.storage.from(BUCKET).remove(paths.slice(i, i + 100));
    if (error) throw new Error(error.message);
  }
  console.log(`Selesai: ${paths.length} file dihapus.`);
})().catch((err) => {
  console.error("Gagal:", err.message);
  process.exit(1);
});
