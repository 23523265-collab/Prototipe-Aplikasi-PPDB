-- =========================================================
-- MIGRASI v6 — Zonasi Berbasis Jarak GPS (Haversine)
-- Jalankan ini SETELAH migrasi v4, v4.1, dan v5.
-- Aman dijalankan berulang kali.
-- =========================================================

-- Koordinat sekolah
alter table sekolah add column if not exists latitude numeric;
alter table sekolah add column if not exists longitude numeric;

-- Koordinat rumah pendaftar (dari GPS browser) + nilai rapor self-reported
alter table pendaftar add column if not exists latitude numeric;
alter table pendaftar add column if not exists longitude numeric;
alter table pendaftar add column if not exists nilai_rapor numeric;

-- Radius maksimum jalur zonasi (null = bukan jalur zonasi)
alter table jalur add column if not exists syarat_radius_km numeric;

-- Jarak rumah pendaftar ke sekolah pilihan, dan catatan bila skor tidak bisa dihitung
alter table pilihan add column if not exists jarak_km numeric;
alter table pilihan add column if not exists catatan_skor text;

-- Koordinat contoh di area Kota Yogyakarta (jarak antar sekolah ± 2–4 km)
update sekolah set latitude = -7.7829, longitude = 110.3671 where nama = 'SMA Negeri 2'; -- sekitar Jetis
update sekolah set latitude = -7.7956, longitude = 110.3900 where nama = 'SMA Negeri 5'; -- sekitar Gondokusuman
update sekolah set latitude = -7.8150, longitude = 110.3780 where nama = 'SMA Negeri 8'; -- sekitar Mergangsan

-- Semua jalur Zonasi yang sudah ada: radius 3 km
update jalur set syarat_radius_km = 3 where nama = 'Zonasi' and syarat_radius_km is null;

-- Cek hasil
select id, nama, latitude, longitude from sekolah order by id;
select id, sekolah_id, nama, kuota, syarat_nilai_minimum, syarat_radius_km from jalur order by id;
