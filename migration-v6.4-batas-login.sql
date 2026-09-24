-- =========================================================
-- MIGRASI v6.4 — Batas Percobaan Login (anti brute force)
-- Jalankan ini SETELAH migration-v6.3-nomor-nilai.sql
-- Aman dijalankan berulang kali.
-- =========================================================

-- Catatan login gagal disimpan di database (bukan di memori server),
-- supaya tetap berlaku di Vercel serverless -- sama alasannya dengan tabel `sesi`.
create table if not exists login_gagal (
  id bigserial primary key,
  kunci text not null,          -- mis. 'pendaftar:PPDB-0001', 'panitia:panitia_sma2', 'ip:1.2.3.4'
  waktu timestamptz not null default now()
);

create index if not exists login_gagal_kunci_waktu_idx on login_gagal (kunci, waktu);

-- Cek hasil (harus muncul 1 baris)
select table_name from information_schema.tables where table_name = 'login_gagal';
