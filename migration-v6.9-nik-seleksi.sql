-- =========================================================
-- MIGRATION v6.9 — NIK unik & pengaman seleksi di database
-- Aman dijalankan ulang.
--
-- 1. Satu NIK hanya boleh mendaftar sekali (unique index).
--    Kalau di data lama sudah ada NIK ganda, index TIDAK dibuat dan daftar NIK gandanya
--    ditampilkan -- hapus dulu data ganda (atau jalankan reset-data-demo.sql), lalu jalankan ulang file ini.
--    Server tetap menolak NIK ganda untuk pendaftaran baru walaupun index belum terbentuk.
--
-- 2. Tabel kunci_seleksi: mencegah satu jalur diseleksi dua kali bersamaan.
--    Sebelumnya penjaga ini disimpan di memori server, sehingga di Vercel
--    (banyak instance) tidak berlaku lintas instance.
-- =========================================================

-- 1. NIK unik ------------------------------------------------
do $$
begin
  if exists (select nik from pendaftar group by nik having count(*) > 1) then
    raise notice 'Index NIK unik BELUM dibuat: masih ada NIK ganda (lihat hasil query di bawah).';
  else
    create unique index if not exists pendaftar_nik_unik on pendaftar (nik);
  end if;
end $$;

-- 2. Kunci seleksi per jalur ---------------------------------
create table if not exists kunci_seleksi (
  jalur_id   integer primary key references jalur(id) on delete cascade,
  mulai_at   timestamptz not null default now(),
  oleh       text
);

alter table kunci_seleksi enable row level security;

-- Cek: NIK ganda (harus kosong) dan status index
select nik, count(*) as jumlah from pendaftar group by nik having count(*) > 1;
select exists (select 1 from pg_indexes where indexname = 'pendaftar_nik_unik') as index_nik_unik_aktif;
