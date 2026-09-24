-- =========================================================
-- MIGRASI v5 — Pra-Verifikasi Berkas & NIK Otomatis (FR-09)
-- Jalankan ini SETELAH migration-v4.2-email.sql
-- Aman dijalankan berulang kali.
--
-- (Disusun ulang dari kode: file patch v5 aslinya kosong. Kolom ini
--  sudah dipakai oleh validasi.js dan server.js sejak versi 5.)
-- =========================================================

-- Peringatan otomatis untuk NIK (panjang bukan 16 digit, bukan angka, angka berulang)
alter table pendaftar add column if not exists catatan_validasi_nik text;

-- Peringatan otomatis untuk berkas (file terlalu kecil, isi tidak sesuai format/diganti ekstensi)
alter table dokumen add column if not exists catatan_validasi text;

-- Cek hasil (harus muncul 2 baris)
select table_name, column_name from information_schema.columns
where (table_name = 'pendaftar' and column_name = 'catatan_validasi_nik')
   or (table_name = 'dokumen' and column_name = 'catatan_validasi');
