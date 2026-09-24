-- =========================================================
-- MIGRASI v6.5 — Masa Revisi Berkas "Kurang Lengkap"
-- Jalankan ini SETELAH migration-v6.4-batas-login.sql
-- Aman dijalankan berulang kali.
-- =========================================================

-- Batas waktu pendaftar mengunggah ulang berkas setelah ditandai "Kurang Lengkap".
-- Lewat batas ini tanpa revisi -> otomatis dialihkan ke pilihan sekolah berikutnya.
alter table pendaftar add column if not exists batas_revisi_at timestamptz;

-- Catatan panitia: berkas apa yang kurang / perlu diperbaiki
alter table pendaftar add column if not exists catatan_revisi text;

-- Cek hasil (harus muncul 2 baris)
select column_name, data_type from information_schema.columns
where table_name = 'pendaftar' and column_name in ('batas_revisi_at', 'catatan_revisi');
