# SiPPDB v4 — Autentikasi + Upload Berkas Asli

Melanjutkan v3 (Supabase, multi-sekolah, Auto-Transfer), versi ini menambahkan:
- **Login pendaftar** (nomor pendaftaran + password) — menggantikan akses bebas ke Cek Status.
- **Login panitia** (username + password, terikat ke satu sekolah) — menggantikan dropdown pilih sekolah.
- **Upload berkas asli** (KK, Akta, Rapor) ke Supabase Storage — menggantikan simulasi checkbox.

## Kamu Sudah Punya Data di Supabase — Baca Ini Dulu

Karena kamu sudah menjalankan `supabase-schema.sql` sebelumnya dan sudah punya data pendaftar, **jangan jalankan ulang file itu**. Sebagai gantinya:

1. Buka **SQL Editor** di dashboard Supabase kamu (yang sama seperti sebelumnya).
2. Buka file **`migration-v4-auth-upload.sql`** dari folder ini, copy semua isinya.
3. Paste ke SQL Editor, klik **Run**.

Ini akan:
- Menambah kolom `password_hash` ke tabel `pendaftar` yang sudah ada (tanpa menghapus data).
- Membuat tabel baru `akun_panitia` dan `dokumen`.
- Membuat akun panitia contoh untuk tiap sekolah yang sudah ada di database kamu.
- Memberi password default ke pendaftar-pendaftar lama supaya tetap bisa login.

## Kredensial Login untuk Uji Coba

| Peran | Username/Nomor | Password |
|---|---|---|
| Panitia | `panitia_sekolah1`, `panitia_sekolah2`, dst (lihat hasil query terakhir di migrasi) | `panitia123` |
| Pendaftar lama (mis. PPDB-0001) | Nomor pendaftaran masing-masing | `pendaftar123` |
| Pendaftar baru | Nomor didapat setelah isi form pendaftaran | Password yang kamu buat sendiri saat mendaftar |

Setelah menjalankan migrasi, hasil query terakhir di SQL Editor akan menampilkan daftar username panitia yang persis dibuat untuk sekolah-sekolahmu — screenshot atau catat itu.

## Langkah Menjalankan

1. **Timpa file-file lama** di folder `ppdb-project-v3` kamu dengan semua file di folder ini (`server.js`, `public/`, `package.json`, dst) — atau langsung pakai folder ini sebagai project baru dan pindahkan `.env` kamu ke sini.
2. Tambahkan satu baris baru di file `.env` kamu:
   ```
   SESSION_SECRET=isi-bebas-string-acak-yang-panjang
   ```
   (Selain itu, `.env` kamu yang sudah ada — `SUPABASE_URL` dan `SUPABASE_SERVICE_KEY` — tetap dipakai apa adanya.)
3. Install dependency baru:
   ```
   npm install
   ```
4. Jalankan:
   ```
   npm start
   ```

Saat server pertama kali jalan, ia otomatis membuat **bucket penyimpanan file** bernama `berkas-pendaftar` di Supabase Storage kamu — tidak perlu setup manual di dashboard.

## Alur Baru yang Perlu Dites

1. **Daftar sebagai pendaftar baru** — isi form (sekarang ada field password), submit. Setelah berhasil, kamu akan otomatis diarahkan ke halaman upload berkas (tanpa perlu login ulang).
2. **Upload berkas** — pilih file asli (PDF/JPG/PNG) untuk KK, Akta, dan Rapor. Setiap file benar-benar terupload ke Supabase Storage.
3. **Cek Status** — sekarang minta login dulu (nomor + password). Setelah login, kamu bisa lihat status DAN link ke berkas yang sudah diupload.
4. **Panel Panitia** — sekarang minta login (username + password), bukan pilih dari dropdown. Setelah login, panitia hanya melihat antrean sekolahnya sendiri, dan juga bisa klik link untuk melihat berkas yang diupload pendaftar.

## Catatan Keamanan (Jujur, untuk Kamu Tahu)

- Bucket Supabase Storage dibuat **public** supaya sederhana untuk prototipe (file bisa diakses langsung lewat URL tanpa perlu token). Untuk versi produksi sungguhan, ini semestinya **private** dengan **signed URL** yang kedaluwarsa otomatis — sebutkan ini di laporan skripsi sebagai catatan pengembangan lanjutan.
- Session login disimpan di memori server (default `express-session`). Kalau server di-restart, semua orang otomatis logout. Untuk deploy produksi jangka panjang, session sebaiknya disimpan di Redis atau database — juga bisa disebutkan sebagai pengembangan lanjutan.
- Password di-hash dengan bcrypt (satu arah, tidak bisa dibalikin ke teks asli) — ini praktik yang benar dan tidak perlu diubah.

## Catatan Pengujian

Kode ini sudah dicek sintaksnya valid, servernya sudah dites bisa menyala tanpa error (termasuk saat koneksi Supabase gagal — tidak bikin crash), dan hash password sudah diverifikasi cocok. Tapi **belum bisa dites end-to-end terhubung ke Supabase sungguhan** dari sisi saya karena saya tidak punya akses langsung ke database kamu. Kemungkinan besar langsung jalan, tapi kalau ada error saat kamu coba, screenshot saja pesannya.
