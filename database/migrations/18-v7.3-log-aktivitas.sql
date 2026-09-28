-- =========================================================
-- MIGRATION v7.3 — Log aktivitas panitia & Admin Dinas (jejak audit)
-- Aman dijalankan ulang.
--
-- Setiap keputusan penting dicatat: siapa, kapan, terhadap pendaftar/sekolah mana, dan apa isinya.
--   Panitia : verifikasi berkas (Lengkap/Kurang Lengkap/Ditolak), koreksi nilai rapor,
--             skor prestasi nonakademik, menjalankan seleksi, mengunduh data CSV.
--   Admin   : membuka/menutup pendaftaran, mengubah kuota/radius jalur, menambah sekolah,
--             mereset password panitia.
-- Log hanya ditambah, tidak pernah diubah atau dihapus oleh aplikasi.
-- =========================================================

create table if not exists log_aktivitas (
  id bigserial primary key,
  waktu timestamptz not null default now(),
  aktor_tipe text not null check (aktor_tipe in ('panitia', 'admin')),
  aktor text not null,                                                   -- "Nama (username)"
  sekolah_id integer references sekolah(id) on delete set null,
  pendaftar_id integer references pendaftar(id) on delete cascade,       -- ikut terhapus saat reset data demo
  aksi text not null,
  detail text
);

create index if not exists log_aktivitas_sekolah_idx on log_aktivitas (sekolah_id, waktu desc);
create index if not exists log_aktivitas_pendaftar_idx on log_aktivitas (pendaftar_id, waktu desc);
create index if not exists log_aktivitas_waktu_idx on log_aktivitas (waktu desc);

-- Sama seperti tabel lain (v7.0): tertutup untuk akses langsung, hanya server (service key) yang bisa membaca/menulis
alter table log_aktivitas enable row level security;

-- Cek: harus menghasilkan satu baris "log_aktivitas | true"
select relname, relrowsecurity from pg_class where relname = 'log_aktivitas';
