-- =========================================================
-- MIGRASI v4 — Autentikasi & Upload Berkas
-- Jalankan ini di SQL Editor Supabase kamu yang SUDAH ADA datanya.
-- Aman dijalankan berulang kali (tidak akan menduplikasi data).
-- =========================================================

-- 1. Tambah kolom password ke tabel pendaftar yang sudah ada
alter table pendaftar add column if not exists password_hash text;

-- 2. Tabel akun panitia (baru)
create table if not exists akun_panitia (
  id serial primary key,
  username text unique not null,
  password_hash text not null,
  nama text not null,
  sekolah_id integer not null references sekolah(id)
);

-- 3. Tabel dokumen/berkas (baru)
create table if not exists dokumen (
  id serial primary key,
  pendaftar_id integer not null references pendaftar(id),
  jenis text not null,
  nama_file text not null,
  url text not null,
  uploaded_at timestamp default now()
);

-- 4. Isi akun panitia contoh, satu per sekolah yang sudah ada
--    Password untuk ketiganya: panitia123
do $$
declare
  s_id integer;
begin
  for s_id in select id from sekolah order by id loop
    insert into akun_panitia (username, password_hash, nama, sekolah_id)
    values (
      'panitia_sekolah' || s_id,
      '$2b$10$RPk5QB5BgXvAzqewauevveXveEzp8UVvH79azWGF5mYmYQDpzbUoK',
      'Panitia ' || (select nama from sekolah where id = s_id),
      s_id
    )
    on conflict (username) do nothing;
  end loop;
end $$;

-- 5. Kasih password demo ke pendaftar lama yang belum punya password
--    Password untuk semua pendaftar lama: pendaftar123
update pendaftar
set password_hash = '$2b$10$XWuhahEyuuyBM8C1Zj/m3Ok9WtnZhVW6PMQmdZs1VTLCWm/ZWDcL2'
where password_hash is null;

-- Cek hasil migrasi:
select username, nama, sekolah_id from akun_panitia order by sekolah_id;
