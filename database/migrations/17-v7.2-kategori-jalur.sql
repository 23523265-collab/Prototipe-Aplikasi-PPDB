-- =========================================================
-- MIGRATION v7.2 — Kategori jalur khusus (diisi calon siswa di formulir)
-- Aman dijalankan ulang.
--
-- kategori_afirmasi  : kip | pkh | dtks | disabilitas          (wajib jika memilih jalur Afirmasi)
-- kategori_mutasi    : pindah_tugas | anak_gtk                  (wajib jika memilih jalur Mutasi)
-- keterangan_prestasi: nama lomba/kegiatan + tingkat, teks bebas (wajib jika memilih Prestasi Nonakademik)
--
-- Panitia melihat kategori ini di panel detail sebagai panduan apa yang dicocokkan dengan berkas.
-- =========================================================

alter table pendaftar add column if not exists kategori_afirmasi text;
alter table pendaftar add column if not exists kategori_mutasi text;
alter table pendaftar add column if not exists keterangan_prestasi text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pendaftar_kategori_afirmasi_cek') then
    alter table pendaftar add constraint pendaftar_kategori_afirmasi_cek
      check (kategori_afirmasi is null or kategori_afirmasi in ('kip', 'pkh', 'dtks', 'disabilitas'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pendaftar_kategori_mutasi_cek') then
    alter table pendaftar add constraint pendaftar_kategori_mutasi_cek
      check (kategori_mutasi is null or kategori_mutasi in ('pindah_tugas', 'anak_gtk'));
  end if;
end $$;

-- Cek: tiga kolom harus muncul
select column_name from information_schema.columns
where table_name = 'pendaftar' and column_name in ('kategori_afirmasi', 'kategori_mutasi', 'keterangan_prestasi');
