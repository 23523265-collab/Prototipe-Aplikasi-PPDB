-- =========================================================
-- MIGRASI v4.1 — Perbaikan Sesi Login (kompatibel Vercel Serverless)
-- Jalankan ini SETELAH migration-v4-auth-upload.sql
-- Aman dijalankan berulang kali.
-- =========================================================

-- Sebelumnya sesi login disimpan di memori server (express-session),
-- yang TIDAK berfungsi di lingkungan serverless seperti Vercel karena
-- tiap request bisa dilayani instance server yang berbeda.
-- Solusinya: simpan sesi login di database, bukan di memori.

create table if not exists sesi (
  token text primary key,
  tipe text not null, -- 'pendaftar' | 'panitia'
  pendaftar_id integer references pendaftar(id),
  panitia_id integer references akun_panitia(id),
  dibuat_at timestamp default now(),
  kadaluarsa_at timestamp not null
);

-- Cek hasil (harus menunjukkan tabel sesi baru saja dibuat)
select table_name from information_schema.tables where table_name = 'sesi';
