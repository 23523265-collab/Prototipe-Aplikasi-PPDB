-- =========================================================
-- GANTI PASSWORD AKUN STAF (Admin Dinas + semua Panitia)
--
-- Kenapa: password bawaan (admin123 / panitia123) tercantum di repo publik.
-- Jalankan di Supabase SQL Editor. JANGAN simpan password asli ke file ini / ke git:
-- ketik password admin langsung di SQL Editor, lalu jalankan.
--
-- 1. Admin Dinas  : password yang Anda tentukan sendiri (ganti teks di bawah).
-- 2. Semua panitia: password ACAK berbeda per akun, ditampilkan SEKALI di hasil query
--                   paling bawah -- salin/simpan ke tempat aman sebelum menutup SQL Editor.
--                   Password panitia bisa diganti lagi kapan saja lewat panel Admin Dinas.
-- 3. Semua sesi login staf dihapus, jadi semua staf wajib login ulang.
--
-- Hash dibuat dengan bcrypt (pgcrypto), formatnya cocok dengan bcryptjs di server.
-- =========================================================

create extension if not exists pgcrypto with schema extensions;

-- 1) Admin Dinas ----------------------------------------------------------
do $$
declare
  password_baru text := 'GANTI_DENGAN_PASSWORD_ADMIN_BARU';   -- <-- ubah di SQL Editor, minimal 10 karakter
begin
  if password_baru = 'GANTI_DENGAN_PASSWORD_ADMIN_BARU' or length(password_baru) < 10 then
    raise exception 'Isi dulu password admin baru (minimal 10 karakter) di baris password_baru.';
  end if;
  update akun_admin
  set password_hash = extensions.crypt(password_baru, extensions.gen_salt('bf', 10))
  where username = 'admin_dinas';
end $$;

-- 3) Paksa semua staf login ulang ------------------------------------------
delete from sesi where tipe in ('admin', 'panitia');

-- 2) Semua panitia: password acak per akun (hasil tampil di bawah) ----------
with baru as (
  select id, translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/=', 'kQz') as password_baru
  from akun_panitia
)
update akun_panitia a
set password_hash = extensions.crypt(b.password_baru, extensions.gen_salt('bf', 10))
from baru b
where a.id = b.id
returning a.username, b.password_baru, a.nama;
