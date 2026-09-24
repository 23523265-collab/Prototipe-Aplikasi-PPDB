-- =========================================================
-- MIGRASI v6.8 — Admin Dinas + Lupa Password Pendaftar
-- Jalankan ini SETELAH migration-v6.7-tahapan.sql
-- Aman dijalankan berulang kali.
-- =========================================================

-- ---------------------------------------------------------
-- 1) Akun Admin Dinas: mengatur tahapan, sekolah, jalur, dan akun panitia
--    Akun contoh: admin_dinas / admin123  (GANTI password sebelum dipakai sungguhan)
-- ---------------------------------------------------------
create table if not exists akun_admin (
  id serial primary key,
  username text unique not null,
  password_hash text not null,
  nama text not null
);

insert into akun_admin (username, password_hash, nama)
values ('admin_dinas', '$2b$10$pnHQsYGxJasUjTTo1DE1s.x/d./BTfrfdINt.2skuAk93QAkjM5f6', 'Admin Dinas Pendidikan')
on conflict (username) do nothing;

-- Sesi login admin disimpan di tabel sesi yang sama (tipe = 'admin')
alter table sesi add column if not exists admin_id integer references akun_admin(id);

-- ---------------------------------------------------------
-- 2) Lupa password pendaftar: token sekali pakai, berlaku 30 menit.
--    Yang disimpan hanya HASH token (token asli hanya ada di link email).
-- ---------------------------------------------------------
create table if not exists reset_password (
  token_hash text primary key,
  pendaftar_id integer not null references pendaftar(id) on delete cascade,
  kadaluarsa_at timestamptz not null,
  dipakai_at timestamptz,
  dibuat_at timestamptz default now()
);

-- Cek hasil
select username, nama from akun_admin;
select column_name from information_schema.columns where table_name = 'sesi' and column_name = 'admin_id';
select table_name from information_schema.tables where table_name = 'reset_password';
