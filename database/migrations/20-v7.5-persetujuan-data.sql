-- =========================================================
-- MIGRATION v7.5 — Bukti persetujuan pengolahan data pribadi (UU No. 27 Tahun 2022 tentang PDP)
-- Aman dijalankan ulang.
--
-- Calon peserta didik umumnya masih anak, sehingga pengolahan datanya memerlukan persetujuan
-- orang tua/wali. Saat mendaftar, pemberi persetujuan mencentang pernyataan persetujuan;
-- server mencatat waktu persetujuan dan versi Kebijakan Privasi yang disetujui (/privasi.html).
-- =========================================================

alter table pendaftar add column if not exists persetujuan_data_at timestamptz;
alter table pendaftar add column if not exists versi_kebijakan_privasi text;

-- Cek: dua kolom harus muncul
select column_name from information_schema.columns
where table_name = 'pendaftar' and column_name in ('persetujuan_data_at', 'versi_kebijakan_privasi');
