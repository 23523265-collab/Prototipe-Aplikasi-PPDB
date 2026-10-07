-- =========================================================
-- MIGRATION v8.1 — Data sekolah mengikuti data resmi SPMB DIY 2026
-- Aman dijalankan ulang.
--
-- Sumber: Keputusan Gubernur DIY No. 95 Tahun 2026 (juknis SPMB SMA/SMK), huruf R angka 6
-- "Titik koordinat Satuan Pendidikan" (titik tengah lahan sekolah).
--   1) Koordinat 15 sekolah disamakan dengan tabel resmi (selisih dari data lama hanya 5–40 meter,
--      sehingga jarak pendaftar yang sudah tersimpan tidak dihitung ulang).
--   2) SMA Negeri 11 Yogyakarta ditambahkan (Kota Yogyakarta memiliki 11 SMA negeri),
--      lengkap dengan 5 jalur SPMB dan akun panitia.
-- Akun panitia baru memakai password yang sama dengan akun panitia_sma1 (hash disalin di database,
-- tidak ditulis di file ini). Ganti lewat panel Admin Dinas bila perlu.
-- =========================================================

-- 1) Koordinat resmi
update sekolah s set latitude = t.lat, longitude = t.lng
from (values
  ('SMA Negeri 1 Yogyakarta',   -7.800053, 110.352564),
  ('SMA Negeri 2 Yogyakarta',   -7.778235, 110.353895),
  ('SMA Negeri 3 Yogyakarta',   -7.786350, 110.373358),
  ('SMA Negeri 4 Yogyakarta',   -7.772156, 110.362571),
  ('SMA Negeri 5 Yogyakarta',   -7.822167, 110.399278),
  ('SMA Negeri 6 Yogyakarta',   -7.781381, 110.373188),
  ('SMA Negeri 7 Yogyakarta',   -7.814260, 110.358512),
  ('SMA Negeri 8 Yogyakarta',   -7.799645, 110.395765),
  ('SMA Negeri 9 Yogyakarta',   -7.781339, 110.376425),
  ('SMA Negeri 10 Yogyakarta',  -7.798169, 110.362821),
  ('SMA Negeri 1 Depok Sleman', -7.773422, 110.412729),
  ('SMA Negeri 1 Ngaglik',      -7.687228, 110.388009),
  ('SMA Negeri 2 Ngaglik',      -7.706216, 110.434973),
  ('SMA Negeri 1 Mlati',        -7.733362, 110.329026),
  ('SMA Negeri 1 Kalasan',      -7.758037, 110.483484)
) as t(nama, lat, lng)
where s.nama = t.nama;

-- 2) SMA Negeri 11 Yogyakarta + 5 jalur + akun panitia
do $$
declare
  s_id integer;
  hash_panitia text;
begin
  -- jaga-jaga bila nomor urut tertinggal dari data yang ada
  perform setval(pg_get_serial_sequence('sekolah', 'id'), (select max(id) from sekolah));
  perform setval(pg_get_serial_sequence('jalur', 'id'), (select max(id) from jalur));
  perform setval(pg_get_serial_sequence('akun_panitia', 'id'), (select max(id) from akun_panitia));

  select id into s_id from sekolah where nama = 'SMA Negeri 11 Yogyakarta';
  if s_id is null then
    insert into sekolah (nama, latitude, longitude, alamat)
      values ('SMA Negeri 11 Yogyakarta', -7.777584, 110.368567, 'Jl. AM Sangaji, Cokrodiningratan, Jetis, Kota Yogyakarta')
      returning id into s_id;
  else
    update sekolah set latitude = -7.777584, longitude = 110.368567 where id = s_id;
  end if;

  insert into jalur (sekolah_id, nama, jenis, kuota, syarat_radius_km, syarat_nilai_minimum)
  select s_id, t.nama, t.jenis, t.kuota, t.radius, t.nilai
  from (values
    ('Domisili',             'domisili',             6, 3,    null),
    ('Afirmasi',             'afirmasi',             6, null, null),
    ('Mutasi',               'mutasi',               1, null, null),
    ('Prestasi Akademik',    'prestasi_akademik',    5, null, 75),
    ('Prestasi Nonakademik', 'prestasi_nonakademik', 2, null, null)
  ) as t(nama, jenis, kuota, radius, nilai)
  where not exists (select 1 from jalur j where j.sekolah_id = s_id and j.jenis = t.jenis);

  select password_hash into hash_panitia from akun_panitia where username = 'panitia_sma1';
  if hash_panitia is null then
    select password_hash into hash_panitia from akun_panitia order by id limit 1;
  end if;
  insert into akun_panitia (username, password_hash, nama, sekolah_id)
    values ('panitia_sma11', hash_panitia, 'Panitia SMA Negeri 11 Yogyakarta', s_id)
    on conflict (username) do nothing;
end $$;

-- Cek: harus 16 sekolah; SMA Negeri 11 Yogyakarta punya 5 jalur dan akun panitia_sma11
select s.id, s.nama, s.latitude, s.longitude,
       (select count(*) from jalur j where j.sekolah_id = s.id) as jumlah_jalur,
       (select string_agg(a.username, ', ') from akun_panitia a where a.sekolah_id = s.id) as akun_panitia
from sekolah s order by s.id;
