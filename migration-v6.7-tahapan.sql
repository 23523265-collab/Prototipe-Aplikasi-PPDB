-- =========================================================
-- MIGRASI v6.7 — Tahapan PPDB (buka/tutup pendaftaran)
-- Jalankan ini SETELAH migration-v6.6-sekolah-asli.sql
-- Aman dijalankan berulang kali.
--
-- Aturan: seleksi hanya boleh dijalankan saat pendaftaran DITUTUP,
-- supaya pendaftar yang datang belakangan tidak kalah oleh yang lebih dulu
-- diseleksi. Panitia bisa membuka/menutup kembali kapan saja (untuk demo/uji coba).
-- =========================================================

create table if not exists pengaturan (
  kunci text primary key,
  nilai text not null,
  diubah_oleh text,
  diubah_at timestamptz default now()
);

insert into pengaturan (kunci, nilai, diubah_oleh)
values ('pendaftaran_dibuka', 'true', 'migrasi v6.7')
on conflict (kunci) do nothing;

-- Cek hasil (harus muncul 1 baris: pendaftaran_dibuka = true)
select * from pengaturan;
