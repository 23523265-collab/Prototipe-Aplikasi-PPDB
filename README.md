# SiPPDB v3 — Multi-Sekolah + Auto-Transfer, Database Supabase

Versi ini sama persis fiturnya dengan v2 (pendaftaran multi-sekolah, Auto-Transfer, alasan penolakan), tapi database-nya diganti dari SQLite (file lokal) ke **Supabase** (PostgreSQL yang di-hosting online) — jadi datanya tersimpan permanen di cloud, bukan cuma di laptop kamu, dan siap untuk deploy publik.

## Langkah Setup (wajib dilakukan sebelum `npm start`)

### 1. Buat project Supabase
Buka [supabase.com](https://supabase.com), daftar (bisa pakai akun GitHub), klik **New Project**. Isi nama bebas, pilih region **Singapore** (paling dekat), buat password database (simpan baik-baik), tunggu 1-2 menit sampai selesai dibuat.

### 2. Jalankan schema database
Di dashboard Supabase project kamu, buka menu **SQL Editor** di sidebar kiri → **New Query**. Buka file `supabase-schema.sql` yang ada di folder ini, copy semua isinya, paste ke SQL Editor, lalu klik **Run**. Ini akan membuat semua tabel dan mengisi 3 sekolah + 9 pendaftar contoh sekaligus.

### 3. Ambil API credentials
Di dashboard Supabase, buka **Settings** (ikon gerigi) → **API**. Salin dua nilai ini:
- **Project URL**
- **service_role key** (klik "Reveal" — pastikan ambil yang `service_role`, BUKAN `anon public`)

### 4. Isi file `.env`
Copy `.env.example` jadi `.env`:
```
cp .env.example .env
```
Buka file `.env`, isi seperti ini:
```
SUPABASE_URL=https://xxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=ey...(key panjang dari dashboard)
```

**PENTING:** jangan pernah upload file `.env` ke GitHub — sudah otomatis diabaikan lewat `.gitignore`, tapi tetap hati-hati saat `git add`.

### 5. Install dan jalankan
```
npm install
npm start
```
Buka `http://localhost:3000`.

## Kenapa pakai `service_role` key, bukan `anon` key?

Karena semua akses database di project ini dilakukan dari **backend** (Express server), bukan langsung dari browser — jadi key ini aman disimpan di server dan tidak pernah dikirim ke pengguna. `service_role` key ini seperti kunci master, jangan pernah ditaruh di kode frontend (`public/js/app.js`) atau di-commit ke Git.

## Cara Mencoba Alur Auto-Transfer

Sama seperti v2:
1. Menu **Verifikasi & Seleksi** → pilih sekolah → tandai beberapa pendaftar **Lengkap**.
2. Klik **Jalankan Seleksi** di salah satu jalur.
3. Yang tidak masuk kuota otomatis pindah ke Pilihan berikutnya — cek lewat **Cek Status** atau tabel **Pengumuman**.

## Struktur Project

```
ppdb-project-v3/
├── supabase-schema.sql   # Jalankan sekali di SQL Editor Supabase
├── supabase.js            # Koneksi ke Supabase
├── engine.js               # Mesin Auto-Transfer (FR-05) & seleksi (FR-04)
├── server.js                # Express server + REST API
├── .env.example              # Template — copy jadi .env dan isi sendiri
├── .env                        # (dibuat sendiri, TIDAK di-commit ke git)
├── package.json
└── public/
    ├── index.html
    ├── css/style.css
    └── js/app.js
```

## Troubleshooting

| Gejala | Kemungkinan Penyebab |
|---|---|
| Error "SUPABASE_URL dan/atau SUPABASE_SERVICE_KEY belum diisi" saat `npm start` | File `.env` belum diisi atau salah nama file (harus persis `.env`, bukan `.env.txt`) |
| Data kosong / error 500 di semua halaman | Schema belum dijalankan di SQL Editor, atau `service_role` key salah copy |
| Error "relation does not exist" | Schema SQL belum ke-run sepenuhnya — coba jalankan ulang `supabase-schema.sql` |
| Berhasil jalan tapi data pendaftar kosong (bukan 9) | Seed di SQL sengaja dilewati kalau tabel `sekolah` sudah ada isinya — cek tabel `pendaftar` langsung di menu **Table Editor** Supabase |

## Deploy ke Vercel

Karena database sekarang di Supabase (bukan file lokal), project ini **sudah aman di-deploy ke Vercel** tanpa masalah "data hilang" seperti kalau masih pakai SQLite/file JSON. Saat deploy, tambahkan `SUPABASE_URL` dan `SUPABASE_SERVICE_KEY` sebagai Environment Variables di dashboard Vercel (Settings → Environment Variables), sama seperti isi file `.env`.

## Menyimpan Progress dengan Git

```
git init
git add .
git commit -m "feat: migrasi ke Supabase (PostgreSQL)"
git remote add origin <link-repo-github-kamu>
git push -u origin main
```

## Catatan Jujur Sebelum Kamu Coba

Kode ini sudah aku cek sintaksnya valid dan modul-modulnya bisa dimuat tanpa error, tapi **belum bisa aku tes langsung terhubung ke Supabase sungguhan** karena aku tidak punya akses ke akun Supabase kamu. Kemungkinan besar akan langsung jalan begitu `.env` diisi dengan benar, tapi kalau ada error saat dites pertama kali, screenshot saja pesannya dan kirim ke aku — kita perbaiki bersama.
