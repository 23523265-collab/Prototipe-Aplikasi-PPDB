-- =========================================================
-- MIGRASI v6.6 — Data Sekolah Asli (Kota Yogyakarta + Sleman)
-- Jalankan ini SETELAH migration-v6.5-revisi-berkas.sql
-- Aman dijalankan berulang kali.
--
-- Koordinat diambil dari OpenStreetMap (titik gedung/lahan sekolah).
-- Radius zonasi: Kota Yogyakarta 3 km, Sleman 5 km (sekolah lebih jarang).
-- Semua akun panitia baru memakai password: panitia123
-- =========================================================

alter table sekolah add column if not exists alamat text;

-- ---------------------------------------------------------
-- 1) Tiga sekolah lama: nama lengkap + koordinat asli
--    (id tetap sama, jadi data pendaftar/pilihan lama tidak rusak)
-- ---------------------------------------------------------
update sekolah set nama = 'SMA Negeri 2 Yogyakarta' where nama = 'SMA Negeri 2';
update sekolah set nama = 'SMA Negeri 5 Yogyakarta' where nama = 'SMA Negeri 5';
update sekolah set nama = 'SMA Negeri 8 Yogyakarta' where nama = 'SMA Negeri 8';

update sekolah set latitude = -7.778332, longitude = 110.353960, alamat = 'Jl. Bener, Tegalrejo, Kota Yogyakarta'       where nama = 'SMA Negeri 2 Yogyakarta';
update sekolah set latitude = -7.822064, longitude = 110.399305, alamat = 'Jl. Nyi Pembayun, Kotagede, Kota Yogyakarta'  where nama = 'SMA Negeri 5 Yogyakarta';
update sekolah set latitude = -7.799746, longitude = 110.395699, alamat = 'Jl. Sidobali, Muja Muju, Kota Yogyakarta'     where nama = 'SMA Negeri 8 Yogyakarta';

-- ---------------------------------------------------------
-- 2) Sekolah baru + jalur Zonasi & Prestasi + akun panitia
-- ---------------------------------------------------------
do $$
declare
  r record;
  s_id integer;
  hash_panitia text := '$2b$10$RPk5QB5BgXvAzqewauevveXveEzp8UVvH79azWGF5mYmYQDpzbUoK'; -- panitia123
begin
  for r in
    select * from (values
      -- nama,                        lat,        lng,         alamat,                                          radius, username
      ('SMA Negeri 1 Yogyakarta',   -7.800041, 110.352580, 'Jl. HOS Cokroaminoto, Wirobrajan, Kota Yogyakarta',  3, 'panitia_sma1'),
      ('SMA Negeri 3 Yogyakarta',   -7.786347, 110.373267, 'Jl. Yos Sudarso, Kotabaru, Kota Yogyakarta',         3, 'panitia_sma3'),
      ('SMA Negeri 4 Yogyakarta',   -7.772158, 110.362679, 'Karangwaru, Tegalrejo, Kota Yogyakarta',             3, 'panitia_sma4'),
      ('SMA Negeri 6 Yogyakarta',   -7.781295, 110.373192, 'Terban, Gondokusuman, Kota Yogyakarta',              3, 'panitia_sma6'),
      ('SMA Negeri 7 Yogyakarta',   -7.814305, 110.358478, 'Jl. MT Haryono, Mergangsan, Kota Yogyakarta',        3, 'panitia_sma7'),
      ('SMA Negeri 9 Yogyakarta',   -7.781326, 110.376471, 'Jl. Sagan, Terban, Kota Yogyakarta',                 3, 'panitia_sma9'),
      ('SMA Negeri 10 Yogyakarta',  -7.797986, 110.362834, 'Prawirodirjan, Gondomanan, Kota Yogyakarta',         3, 'panitia_sma10'),
      ('SMA Negeri 1 Depok Sleman', -7.773416, 110.412813, 'Caturtunggal, Depok, Sleman',                        5, 'panitia_sma1depok'),
      ('SMA Negeri 1 Ngaglik',      -7.687150, 110.387950, 'Sardonoharjo, Ngaglik, Sleman',                      5, 'panitia_sma1ngaglik'),
      ('SMA Negeri 2 Ngaglik',      -7.706087, 110.434963, 'Jl. Besi Jangkang, Sukoharjo, Ngaglik, Sleman',      5, 'panitia_sma2ngaglik'),
      ('SMA Negeri 1 Mlati',        -7.733638, 110.329229, 'Mlati, Sleman',                                      5, 'panitia_sma1mlati'),
      ('SMA Negeri 1 Kalasan',      -7.758201, 110.483447, 'Jl. Nusa Indah, Tamanmartani, Kalasan, Sleman',      5, 'panitia_sma1kalasan')
    ) as t(nama, lat, lng, alamat, radius, username)
  loop
    select id into s_id from sekolah where nama = r.nama;
    if s_id is null then
      insert into sekolah (nama, latitude, longitude, alamat) values (r.nama, r.lat, r.lng, r.alamat) returning id into s_id;
      insert into jalur (sekolah_id, nama, kuota, syarat_nilai_minimum, syarat_radius_km) values
        (s_id, 'Zonasi',   3, null, r.radius),
        (s_id, 'Prestasi', 2, 75,   null);
    else
      update sekolah set latitude = r.lat, longitude = r.lng, alamat = r.alamat where id = s_id;
    end if;

    insert into akun_panitia (username, password_hash, nama, sekolah_id)
    values (r.username, hash_panitia, 'Panitia ' || r.nama, s_id)
    on conflict (username) do nothing;
  end loop;
end $$;

-- ---------------------------------------------------------
-- 3) Hitung ulang jarak & skor zonasi untuk pilihan yang BELUM diputuskan,
--    karena koordinat 3 sekolah lama berubah (rumus Haversine, sama dengan zonasi.js)
-- ---------------------------------------------------------
update pilihan pl
set jarak_km = round(hitung.jarak::numeric, 2),
    skor = round(greatest(0, least(100, 100 - 10 * hitung.jarak))),
    catatan_skor = null
from (
  select pl2.id,
         2 * 6371 * asin(sqrt(
           power(sin(radians(s.latitude - p.latitude) / 2), 2) +
           cos(radians(p.latitude)) * cos(radians(s.latitude)) *
           power(sin(radians(s.longitude - p.longitude) / 2), 2)
         )) as jarak
  from pilihan pl2
  join pendaftar p on p.id = pl2.pendaftar_id
  join sekolah s   on s.id = pl2.sekolah_id
  join jalur j     on j.id = pl2.jalur_id
  where j.syarat_radius_km is not null
    and p.latitude is not null and s.latitude is not null
    and pl2.status in ('Menunggu Giliran', 'Menunggu Verifikasi Berkas', 'Menunggu Seleksi')
) as hitung
where pl.id = hitung.id;

-- Cek hasil: semua sekolah beserta radius zonasi dan akun panitianya
select s.id, s.nama, s.latitude, s.longitude, j.syarat_radius_km as radius_zonasi_km, a.username as akun_panitia
from sekolah s
left join jalur j on j.sekolah_id = s.id and j.nama = 'Zonasi'
left join akun_panitia a on a.sekolah_id = s.id
order by s.id;
