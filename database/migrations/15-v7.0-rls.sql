-- =========================================================
-- MIGRATION v7.0 — Aktifkan Row Level Security (RLS) di semua tabel
-- Aman dijalankan ulang.
--
-- Kenapa: tanpa RLS, siapa pun yang memegang "anon key" Supabase (kunci yang oleh
-- Supabase dianggap publik) bisa membaca & mengubah semua tabel lewat REST API
-- https://<proyek>.supabase.co/rest/v1/ -- termasuk NIK, hash password, dan token sesi.
--
-- Dampak ke aplikasi: TIDAK ADA. Server SiPPDB memakai service_role key, yang selalu
-- melewati RLS. Karena tidak ada policy yang dibuat, akses lewat anon key / authenticated
-- ke tabel-tabel ini otomatis ditolak.
-- =========================================================

do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- Cek: semua tabel harus rls_aktif = true
select tablename, rowsecurity as rls_aktif
from pg_tables
where schemaname = 'public'
order by rowsecurity, tablename;
