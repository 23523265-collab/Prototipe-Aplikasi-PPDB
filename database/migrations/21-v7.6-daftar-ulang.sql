-- =========================================================
-- MIGRATION v7.6 — Daftar ulang (konfirmasi kursi) + surat keterangan diterima
-- Aman dijalankan ulang.
--
-- Siswa yang diterima wajib mengonfirmasi daftar ulang dalam 3×24 jam.
--   daftar_ulang_batas_at : batas waktu konfirmasi (diisi saat diterima)
--   daftar_ulang_at       : waktu siswa mengonfirmasi (null = belum)
-- Bila batas terlewati: status_global & status pilihan menjadi 'Tidak Daftar Ulang',
-- kursi kembali tersedia, dan panitia dapat menjalankan seleksi tahap 2.
-- Pelepasan kursi otomatis dicatat di log_aktivitas dengan aktor_tipe 'sistem'.
-- =========================================================

alter table pendaftar add column if not exists daftar_ulang_batas_at timestamptz;
alter table pendaftar add column if not exists daftar_ulang_at timestamptz;

alter table log_aktivitas drop constraint if exists log_aktivitas_aktor_tipe_check;
alter table log_aktivitas add constraint log_aktivitas_aktor_tipe_check
  check (aktor_tipe in ('panitia', 'admin', 'pendaftar', 'sistem'));

-- Cek: dua kolom harus muncul
select column_name from information_schema.columns
where table_name = 'pendaftar' and column_name in ('daftar_ulang_batas_at', 'daftar_ulang_at');
