-- =========================================================
-- MIGRATION v7.4 — Log aktivitas juga mencatat perbaikan data diri oleh pendaftar
-- Aman dijalankan ulang.
--
-- Saat berkas belum dinyatakan Lengkap, pendaftar dapat memperbaiki isian data diri
-- (nama, NIK, tanggal lahir, alamat). Setiap perbaikan dicatat di log_aktivitas dengan
-- aktor_tipe 'pendaftar' supaya panitia tahu apa yang diubah (mis. "NIK: lama → baru").
-- =========================================================

alter table log_aktivitas drop constraint if exists log_aktivitas_aktor_tipe_check;
alter table log_aktivitas add constraint log_aktivitas_aktor_tipe_check
  check (aktor_tipe in ('panitia', 'admin', 'pendaftar'));

-- Cek: harus menampilkan aturan yang memuat 'pendaftar'
select pg_get_constraintdef(oid) from pg_constraint where conname = 'log_aktivitas_aktor_tipe_check';
