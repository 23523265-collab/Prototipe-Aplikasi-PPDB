-- =========================================================
-- MIGRASI v6.1 — Data Verifikasi Lokasi untuk Panitia
-- Jalankan ini SETELAH migration-v6-zonasi.sql
-- Aman dijalankan berulang kali.
-- =========================================================

-- Alamat rumah sesuai Kartu Keluarga (diketik pendaftar), untuk dicocokkan panitia dengan titik GPS
alter table pendaftar add column if not exists alamat text;

-- Akurasi GPS dari browser (radius ketidakpastian, dalam meter)
alter table pendaftar add column if not exists akurasi_lokasi_m numeric;

-- Cek hasil (harus muncul 2 baris)
select column_name, data_type from information_schema.columns
where table_name = 'pendaftar' and column_name in ('alamat', 'akurasi_lokasi_m');
