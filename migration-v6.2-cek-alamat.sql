-- =========================================================
-- MIGRASI v6.2 — Pra-Verifikasi Alamat vs Titik GPS (geocoding)
-- Jalankan ini SETELAH migration-v6.1-lokasi.sql
-- Aman dijalankan berulang kali.
-- =========================================================

-- Titik hasil pencarian alamat di OpenStreetMap (Nominatim)
alter table pendaftar add column if not exists alamat_latitude numeric;
alter table pendaftar add column if not exists alamat_longitude numeric;

-- Tingkat ketepatan hasil pencarian: 'jalan' atau 'wilayah' (kelurahan/kecamatan)
alter table pendaftar add column if not exists alamat_presisi text;

-- Peringatan otomatis bila alamat dan GPS tidak cocok (null = tidak ada masalah)
alter table pendaftar add column if not exists catatan_validasi_alamat text;

-- Cek hasil (harus muncul 4 baris)
select column_name, data_type from information_schema.columns
where table_name = 'pendaftar'
  and column_name in ('alamat_latitude', 'alamat_longitude', 'alamat_presisi', 'catatan_validasi_alamat');
