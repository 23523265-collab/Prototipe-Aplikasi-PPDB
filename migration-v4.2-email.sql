-- =========================================================
-- MIGRASI v4.2 — Notifikasi Email
-- Jalankan ini SETELAH migration-v4.1-sesi.sql
-- Aman dijalankan berulang kali.
-- =========================================================

alter table pendaftar add column if not exists email text;

-- Pendaftar lama (data contoh) belum punya email -- isi dengan email dummy
-- supaya tidak error, tapi TIDAK akan benar-benar mengirim notifikasi
-- (ganti manual lewat Table Editor kalau mau tes kirim ke pendaftar lama).
update pendaftar set email = 'contoh+' || nomor || '@example.com' where email is null;

select nomor, nama, email from pendaftar order by id;
