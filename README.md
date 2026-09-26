# SiPPDB — Prototipe PPDB Multi-Sekolah dengan Auto-Transfer

Prototipe sistem Penerimaan Peserta Didik Baru (PPDB/SPMB) tingkat SMA untuk wilayah Kota Yogyakarta dan Sleman.
Calon siswa **mendaftar sekali dan memilih hingga 3 sekolah**. Kalau tidak diterima di pilihan 1, pendaftaran
**otomatis dialihkan** ke pilihan berikutnya tanpa perlu mendaftar ulang.

**Demo online:** https://prototipe-aplikasi-ppdb.vercel.app
**Panel panitia:** https://prototipe-aplikasi-ppdb.vercel.app/panitia.html
**Admin Dinas:** https://prototipe-aplikasi-ppdb.vercel.app/admin.html

---

## Fitur Utama

### Pendaftar
- Formulir pendaftaran dengan hingga 3 pilihan sekolah, masing-masing dengan jalur **Zonasi** atau **Prestasi**.
- **Cek jarak ke sekolah** sebelum mendaftar: jarak dari lokasi GPS ke tiap sekolah, beserta tanda ✓/✕ masuk radius zonasi.
- Unggah berkas (Kartu Keluarga, Akta Kelahiran, Rapor) — bisa diganti selama belum diverifikasi.
- **Cek Status**: posisi pendaftaran, jarak, skor, riwayat pengalihan, dan notifikasi.
- **Notifikasi email** setiap ada perubahan status (verifikasi, pengalihan, diterima/ditolak, koreksi nilai).
- **Cetak bukti pendaftaran** (siap cetak / simpan PDF lewat menu Print browser).
- **Lupa password**: link buat password baru dikirim ke email, berlaku 30 menit dan sekali pakai.

### Panitia (halaman terpisah, wajib login)
- Antrean pendaftar yang sedang aktif di sekolahnya, dengan **tab penyaring & pencarian**. Klik satu baris untuk membuka
  **panel detail** (berkas, peringatan otomatis, lokasi, nilai, dan tombol verifikasi).
- **Peringatan otomatis**
  (NIK tidak wajar, berkas rusak/diganti ekstensi, alamat tidak cocok dengan titik GPS).
- **Peta lokasi rumah**: titik GPS, hasil pencarian alamat, sekolah, dan lingkaran radius zonasi.
- Verifikasi berkas: **Lengkap** (hanya bisa jika KK, Akta, dan Rapor sudah diunggah), **Kurang Lengkap** (pendaftar diberi masa revisi 2×24 jam), atau **Tolak**.
- **Koreksi nilai rapor** setelah dicocokkan dengan berkas (nilai asli tetap tercatat).
- **Statistik per jalur**: peminat, sisa kuota, menunggu verifikasi/seleksi, ditolak.
- **Unduh data pendaftar (Excel/CSV)** untuk sekolahnya sendiri.
- **Jalankan seleksi** per jalur (hanya saat pendaftaran ditutup) dengan ringkasan hasil.

### Admin Dinas (halaman terpisah, wajib login)
- **Tahapan PPDB**: buka/tutup pendaftaran untuk semua sekolah.
- Ringkasan seluruh wilayah: total pendaftar, diproses, diterima.
- Ubah **kuota, radius zonasi, dan nilai minimum prestasi** per sekolah.
- **Tambah sekolah baru** (lengkap dengan jalur Zonasi/Prestasi dan akun panitianya).
- **Reset password akun panitia**.

### Aturan Seleksi
| Jalur | Syarat | Urutan peringkat |
|---|---|---|
| **Zonasi** | Jarak rumah–sekolah ≤ radius (Kota Yogyakarta 3 km, Sleman 5 km) | Jarak terdekat |
| **Prestasi** | Nilai rapor ≥ nilai minimum jalur (75) | Nilai tertinggi |

- Jika jarak/nilai sama: **usia lebih tua** didahulukan, lalu yang **mendaftar lebih awal**.
- Kuota dihitung dari sisa kursi (dikurangi yang sudah diterima), sehingga seleksi ulang tidak melebihi kuota.
- Pendaftar yang ditolak otomatis dialihkan ke pilihan berikutnya; jika pilihan habis → **Tidak Diterima Final**.
- Di jalur Zonasi, kolom skor hanya konversi jarak (`100 − 10 × km`); yang menentukan tetap jaraknya.

### Keamanan & Privasi
- Panel panitia dipisah dari situs pendaftar; semua endpoint panitia diperiksa di server.
- Berkas disimpan di bucket **private**, dibuka lewat *signed URL* yang kedaluwarsa dalam 1 jam.
- Semua data dari pengguna di-escape sebelum ditampilkan (mencegah XSS).
- Batas percobaan login: 5× gagal per akun / 20× per IP dalam 15 menit.
- **Satu NIK hanya bisa mendaftar sekali** (dicek di server + unique index database).
- Batas pendaftaran baru: 20× per IP per jam (anti spam/bot; longgar karena WiFi sekolah dipakai bersama).
- Pengaman seleksi ganda disimpan di database, sehingga satu jalur tidak bisa diseleksi bersamaan walau di Vercel.
- Nama di halaman Pengumuman disamarkan (mis. `Ah*** Fa****`) karena pendaftar di bawah umur.
- Validasi usia 12–21 tahun (per 1 Juli tahun berjalan).

---

## Teknologi
- **Backend:** Node.js + Express
- **Database & penyimpanan berkas:** Supabase (PostgreSQL + Storage)
- **Peta & geocoding:** OpenStreetMap (Leaflet, Nominatim)
- **Email:** Nodemailer via Gmail SMTP (port 587)
- **Hosting:** Vercel (deploy otomatis dari branch `main`)

## Struktur File

| File | Isi |
|---|---|
| `server.js` | Semua endpoint API |
| `engine.js` | Verifikasi berkas, seleksi, auto-transfer, masa revisi, notifikasi |
| `aturan.js` | Aturan murni yang diuji otomatis: syarat & peringkat seleksi, sisa kuota, batas usia, penyamaran nama |
| `zonasi.js` | Rumus Haversine dan konversi jarak → skor |
| `validasi.js` | Pra-verifikasi otomatis: NIK, berkas, alamat vs GPS |
| `auth.js` | Login, sesi (disimpan di database), batas percobaan login |
| `storage.js` | Upload berkas, signed URL, bucket private |
| `email.js` | Pengiriman email notifikasi |
| `public/index.html`, `public/js/app.js` | Situs pendaftar |
| `public/panitia.html`, `public/js/panitia.js` | Panel panitia |
| `public/admin.html`, `public/js/admin.js` | Panel Admin Dinas |
| `public/js/dialog.js`, `public/js/ikon.js` | Dialog/toast & ikon SVG yang dipakai semua halaman |
| `test/` | Unit test (`npm test`) |

---

## Menjalankan dari Awal

### 1. Environment variable
Salin `.env.example` menjadi `.env`, lalu isi:
```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=...          # service_role key (Settings → API)
SESSION_SECRET=string-acak-panjang
EMAIL_USER=alamat@gmail.com       # akun pengirim notifikasi
EMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx   # App Password Google (16 huruf, tanpa spasi)
```
`EMAIL_APP_PASSWORD` dibuat di https://myaccount.google.com/apppasswords (butuh Verifikasi 2 Langkah aktif).
Untuk Vercel, isi variabel yang sama di **Settings → Environment Variables**.

### 2. Database — jalankan di Supabase SQL Editor, berurutan
1. `supabase-schema.sql` — tabel dasar + data contoh
2. `migration-v4-auth-upload.sql` — login & berkas
3. `migration-v4.1-sesi.sql` — sesi login di database
4. `migration-v4.2-email.sql` — kolom email
5. `migration-v5-praverifikasi.sql` — peringatan otomatis NIK & berkas
6. `migration-v6-zonasi.sql` — koordinat, jarak, nilai rapor
7. `migration-v6.1-lokasi.sql` — alamat & akurasi GPS
8. `migration-v6.2-cek-alamat.sql` — hasil cek alamat vs GPS
9. `migration-v6.3-nomor-nilai.sql` — nomor pendaftaran (sequence) & koreksi nilai
10. `migration-v6.4-batas-login.sql` — batas percobaan login
11. `migration-v6.5-revisi-berkas.sql` — masa revisi berkas
12. `migration-v6.6-sekolah-asli.sql` — 15 SMA Negeri dengan koordinat asli + akun panitia
13. `migration-v6.7-tahapan.sql` — buka/tutup pendaftaran
14. `migration-v6.8-admin-reset.sql` — akun Admin Dinas & lupa password pendaftar
15. `migration-v6.9-nik-seleksi.sql` — NIK unik & kunci seleksi
16. `migration-v7.0-rls.sql` — Row Level Security di semua tabel (akses lewat anon key ditolak; server memakai service key)
17. `ganti-password-staf.sql` — **wajib**: ganti password bawaan Admin Dinas & panitia

Semua file migration aman dijalankan ulang.

### 3. Jalankan
```
npm install
npm start
```
Buka http://localhost:3000. Saat pertama jalan, server otomatis membuat bucket `berkas-pendaftar` (private).

> Fitur lokasi GPS butuh `localhost` atau HTTPS. Untuk mencoba dari HP, pakai alamat Vercel.

---

## Pengujian Otomatis
```
npm test
```
Menjalankan 27 unit test (bawaan Node.js, tanpa database) untuk: rumus jarak Haversine & skor zonasi,
syarat radius/nilai minimum, urutan peringkat dan penentu seri (usia lebih tua, lalu daftar lebih awal),
sisa kuota, batas usia 12–21 tahun, penyamaran nama, validasi NIK, dan deteksi berkas yang diganti ekstensinya.

---

## Akun

| Peran | Username |
|---|---|
| **Admin Dinas** | `admin_dinas` |
| Panitia SMA Negeri 1 Yogyakarta | `panitia_sma1` |
| Panitia SMA Negeri 2 / 5 / 8 Yogyakarta | `panitia_sekolah1` / `panitia_sekolah2` / `panitia_sekolah3` |
| Panitia SMA Negeri 1 / 2 Ngaglik | `panitia_sma1ngaglik` / `panitia_sma2ngaglik` |
| Panitia sekolah lain | `panitia_sma3` … `panitia_sma10`, `panitia_sma1depok`, `panitia_sma1mlati`, `panitia_sma1kalasan` |
| Pendaftar | Nomor pendaftaran (mis. `PPDB-0001`) + password yang dibuat saat mendaftar |

Password staf **tidak** dicantumkan di repo. Migration membuat akun dengan password bawaan yang sudah diketahui umum,
jadi setelah memasang database baru **wajib** jalankan `ganti-password-staf.sql` di SQL Editor:
password Admin Dinas ditentukan sendiri, password tiap panitia dibuat acak dan ditampilkan sekali di hasil query.
Password panitia dapat diganti lagi dari panel Admin Dinas.

## Reset Data Sebelum Demo
Menghapus semua pendaftar (sekolah, jalur, dan akun panitia tetap ada). **Tidak bisa dibatalkan.**
1. Jalankan `reset-data-demo.sql` di Supabase SQL Editor.
2. Hapus file berkas: `node reset-berkas-demo.js --ya` (tanpa `--ya` hanya menampilkan jumlah file).

Nomor pendaftaran kembali mulai dari `PPDB-0001` dan pendaftaran dibuka kembali.

---

## Keterbatasan (Pengembangan Lanjutan)
- **Password bawaan akun staf** dari migration wajib diganti lewat `ganti-password-staf.sql` sebelum dipakai.
- **Titik GPS dapat dipalsukan**; pengecekan alamat hanya petunjuk, keputusan akhir tetap di panitia
  dengan mencocokkan Kartu Keluarga.
- **Jarak zonasi = garis lurus (Haversine)**, bukan jarak tempuh jalan.
- **Geocoding memakai Nominatim gratis** (maks. 1 permintaan/detik) — untuk skala nyata perlu layanan berbayar
  atau server sendiri.
- **Format NIK belum diwajibkan 16 digit** — NIK tidak wajar hanya ditandai sebagai peringatan untuk panitia.
- **Tidak ada penjadwal otomatis (cron)**: masa revisi yang lewat diproses saat panitia/pendaftar membuka halaman.
- **Email via Gmail** dibatasi ±500 email/hari; produksi sebaiknya memakai layanan email khusus.
