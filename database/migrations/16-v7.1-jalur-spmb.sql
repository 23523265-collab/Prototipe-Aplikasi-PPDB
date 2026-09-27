-- =========================================================
-- MIGRATION v7.1 — Jalur SPMB 2026: Domisili, Afirmasi, Mutasi, Prestasi (akademik & nonakademik)
-- Aman dijalankan ulang.
--
-- 1. Kolom jalur.jenis: domisili | afirmasi | mutasi | prestasi_akademik | prestasi_nonakademik
-- 2. Jalur lama diganti nama: Zonasi -> Domisili, Prestasi -> Prestasi Akademik
--    (pilihan pendaftar yang sudah ada tetap tersambung karena id jalur tidak berubah)
-- 3. Setiap sekolah mendapat jalur Afirmasi, Mutasi, dan Prestasi Nonakademik.
--    Kuota awal per sekolah (hanya saat jalur baru pertama kali dibuat) = 20 kursi:
--    domisili 6 (30%), afirmasi 6 (30%), mutasi 1 (5%), prestasi akademik 5, nonakademik 2.
--    ATUR ULANG di panel Admin Dinas sesuai daya tampung & regulasi SPMB.
-- 4. Kolom skor prestasi nonakademik (diisi panitia saat verifikasi sertifikat)
-- =========================================================

-- 1) Jenis jalur ------------------------------------------------------------
alter table jalur add column if not exists jenis text;

update jalur set jenis = 'domisili', nama = 'Domisili'
where jenis is null and syarat_radius_km is not null;

update jalur set jenis = 'prestasi_akademik', nama = 'Prestasi Akademik'
where jenis is null and syarat_nilai_minimum is not null;

-- 2) Tambah jalur baru untuk setiap sekolah yang belum punya -------------------
-- Kuota domisili & prestasi akademik dinaikkan (bukan diturunkan) agar porsi 20 kursi terpenuhi,
-- hanya untuk sekolah yang belum pernah dimigrasi (belum punya jalur afirmasi)
update jalur set kuota = greatest(kuota, 6)
where jenis = 'domisili' and not exists (select 1 from jalur x where x.sekolah_id = jalur.sekolah_id and x.jenis = 'afirmasi');
update jalur set kuota = greatest(kuota, 5)
where jenis = 'prestasi_akademik' and not exists (select 1 from jalur x where x.sekolah_id = jalur.sekolah_id and x.jenis = 'afirmasi');

insert into jalur (sekolah_id, nama, kuota, syarat_nilai_minimum, syarat_radius_km, jenis)
select s.id, j.nama, j.kuota, null, null, j.jenis
from sekolah s
cross join (values
  ('Afirmasi', 6, 'afirmasi'),
  ('Mutasi', 1, 'mutasi'),
  ('Prestasi Nonakademik', 2, 'prestasi_nonakademik')
) as j(nama, kuota, jenis)
where not exists (select 1 from jalur x where x.sekolah_id = s.id and x.jenis = j.jenis);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'jalur_jenis_cek') then
    alter table jalur add constraint jalur_jenis_cek
      check (jenis in ('domisili', 'afirmasi', 'mutasi', 'prestasi_akademik', 'prestasi_nonakademik'));
  end if;
end $$;

-- 3) Skor prestasi nonakademik (0–100, diberi panitia dari sertifikat) ----------
alter table pendaftar add column if not exists skor_nonakademik numeric;
alter table pendaftar add column if not exists skor_nonakademik_oleh text;
alter table pendaftar add column if not exists skor_nonakademik_at timestamptz;

-- Tabel baru ikut terlindungi RLS (migration v7.0)
alter table jalur enable row level security;

-- Cek: setiap sekolah harus punya 5 jalur
select s.nama, count(j.id) as jumlah_jalur, string_agg(j.nama || ' (' || j.kuota || ')', ', ' order by j.id) as jalur
from sekolah s left join jalur j on j.sekolah_id = s.id
group by s.id, s.nama order by s.id;
