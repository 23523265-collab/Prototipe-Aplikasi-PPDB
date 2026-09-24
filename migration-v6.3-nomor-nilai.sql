-- =========================================================
-- MIGRASI v6.3 — Nomor Pendaftaran via Sequence + Koreksi Nilai Rapor
-- Jalankan ini SETELAH migration-v6.2-cek-alamat.sql
-- Aman dijalankan berulang kali.
-- =========================================================

-- ---------------------------------------------------------
-- 1) Nomor pendaftaran dibuat database (sequence), bukan dari
--    "jumlah pendaftar + 1" -- supaya tidak bentrok saat dua orang
--    mendaftar bersamaan atau setelah ada data yang dihapus.
-- ---------------------------------------------------------
create sequence if not exists pendaftar_nomor_seq;

-- Lanjutkan dari nomor terbesar yang sudah ada (mis. PPDB-0027 -> berikutnya PPDB-0028)
select setval(
  'pendaftar_nomor_seq',
  greatest(
    (select coalesce(max((regexp_replace(nomor, '\D', '', 'g'))::int), 0) from pendaftar where nomor ~ '^PPDB-\d+$'),
    (select last_value from pendaftar_nomor_seq)
  ),
  true
);

alter table pendaftar
  alter column nomor set default 'PPDB-' || lpad(nextval('pendaftar_nomor_seq')::text, 4, '0');

-- ---------------------------------------------------------
-- 2) Koreksi nilai rapor oleh panitia (nilai asli dari pendaftar tetap disimpan)
-- ---------------------------------------------------------
alter table pendaftar add column if not exists nilai_rapor_awal numeric;
alter table pendaftar add column if not exists nilai_rapor_dikoreksi_oleh text;
alter table pendaftar add column if not exists nilai_rapor_dikoreksi_at timestamp;

-- Cek hasil: nomor berikutnya yang akan dipakai, dan 3 kolom baru
select 'PPDB-' || lpad((last_value + 1)::text, 4, '0') as nomor_berikutnya from pendaftar_nomor_seq;
select column_name from information_schema.columns
where table_name = 'pendaftar'
  and column_name in ('nilai_rapor_awal', 'nilai_rapor_dikoreksi_oleh', 'nilai_rapor_dikoreksi_at');
