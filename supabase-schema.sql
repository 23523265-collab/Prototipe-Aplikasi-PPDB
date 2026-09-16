-- =========================================================
-- SiPPDB — Schema & Seed Data untuk Supabase (PostgreSQL)
-- Cara pakai: buka SQL Editor di dashboard Supabase, paste
-- seluruh isi file ini, lalu klik "Run".
-- =========================================================

create table if not exists sekolah (
  id serial primary key,
  nama text not null
);

create table if not exists jalur (
  id serial primary key,
  sekolah_id integer not null references sekolah(id),
  nama text not null,
  kuota integer not null,
  syarat_nilai_minimum integer
);

create table if not exists pendaftar (
  id serial primary key,
  nomor text unique not null,
  nama text not null,
  nik text not null,
  tanggal_lahir date not null,
  status_berkas text not null default 'Menunggu Verifikasi',
  status_global text not null default 'Aktif', -- Aktif | Diterima Final | Tidak Diterima Final
  sekolah_aktif_id integer references sekolah(id),
  prioritas_aktif integer not null default 1,
  created_at timestamp default now()
);

create table if not exists pilihan (
  id serial primary key,
  pendaftar_id integer not null references pendaftar(id),
  sekolah_id integer not null references sekolah(id),
  urutan_prioritas integer not null, -- 1, 2, 3
  jalur_id integer not null references jalur(id),
  skor integer not null,
  status text not null default 'Menunggu Giliran',
  -- status: Menunggu Giliran | Menunggu Verifikasi Berkas | Menunggu Seleksi | Diterima | Ditolak | Dibatalkan
  alasan_penolakan text
);

create table if not exists riwayat_transfer (
  id serial primary key,
  pendaftar_id integer not null references pendaftar(id),
  dari_sekolah_id integer references sekolah(id),
  ke_sekolah_id integer references sekolah(id),
  alasan text,
  waktu timestamp default now()
);

create table if not exists notifikasi (
  id serial primary key,
  pendaftar_id integer not null references pendaftar(id),
  isi_pesan text not null,
  waktu timestamp default now()
);

-- =========================================================
-- SEED DATA (contoh 3 sekolah, 9 pendaftar)
-- Aman dijalankan berulang: akan dilewati kalau data sudah ada.
-- =========================================================

do $$
declare
  s1 integer; s2 integer; s3 integer;
  j1z integer; j1p integer; j2z integer; j2p integer; j3z integer; j3p integer;
  p_id integer;
begin
  if (select count(*) from sekolah) > 0 then
    raise notice 'Data sudah ada, seed dilewati.';
    return;
  end if;

  insert into sekolah (nama) values ('SMA Negeri 2') returning id into s1;
  insert into sekolah (nama) values ('SMA Negeri 5') returning id into s2;
  insert into sekolah (nama) values ('SMA Negeri 8') returning id into s3;

  insert into jalur (sekolah_id, nama, kuota, syarat_nilai_minimum) values (s1, 'Zonasi', 2, null) returning id into j1z;
  insert into jalur (sekolah_id, nama, kuota, syarat_nilai_minimum) values (s1, 'Prestasi', 1, 75) returning id into j1p;
  insert into jalur (sekolah_id, nama, kuota, syarat_nilai_minimum) values (s2, 'Zonasi', 2, null) returning id into j2z;
  insert into jalur (sekolah_id, nama, kuota, syarat_nilai_minimum) values (s2, 'Prestasi', 1, 75) returning id into j2p;
  insert into jalur (sekolah_id, nama, kuota, syarat_nilai_minimum) values (s3, 'Zonasi', 3, null) returning id into j3z;
  insert into jalur (sekolah_id, nama, kuota, syarat_nilai_minimum) values (s3, 'Prestasi', 2, 75) returning id into j3p;

  -- Pendaftar 1: Ahmad Fadhil
  insert into pendaftar (nomor, nama, nik, tanggal_lahir, status_berkas, sekolah_aktif_id, prioritas_aktif)
    values ('PPDB-0001', 'Ahmad Fadhil', '3471012345670001', '2011-03-12', 'Menunggu Verifikasi', s1, 1) returning id into p_id;
  insert into pilihan (pendaftar_id, sekolah_id, urutan_prioritas, jalur_id, skor, status) values
    (p_id, s1, 1, j1z, 91, 'Menunggu Verifikasi Berkas'),
    (p_id, s2, 2, j2z, 88, 'Menunggu Giliran'),
    (p_id, s3, 3, j3z, 85, 'Menunggu Giliran');

  -- Pendaftar 2: Siti Nur Aini
  insert into pendaftar (nomor, nama, nik, tanggal_lahir, status_berkas, sekolah_aktif_id, prioritas_aktif)
    values ('PPDB-0002', 'Siti Nur Aini', '3471012345670002', '2011-07-22', 'Menunggu Verifikasi', s1, 1) returning id into p_id;
  insert into pilihan (pendaftar_id, sekolah_id, urutan_prioritas, jalur_id, skor, status) values
    (p_id, s1, 1, j1z, 78, 'Menunggu Verifikasi Berkas'),
    (p_id, s2, 2, j2p, 80, 'Menunggu Giliran'),
    (p_id, s3, 3, j3z, 82, 'Menunggu Giliran');

  -- Pendaftar 3: Bagas Wicaksono
  insert into pendaftar (nomor, nama, nik, tanggal_lahir, status_berkas, sekolah_aktif_id, prioritas_aktif)
    values ('PPDB-0003', 'Bagas Wicaksono', '3471012345670003', '2011-01-05', 'Menunggu Verifikasi', s1, 1) returning id into p_id;
  insert into pilihan (pendaftar_id, sekolah_id, urutan_prioritas, jalur_id, skor, status) values
    (p_id, s1, 1, j1z, 85, 'Menunggu Verifikasi Berkas'),
    (p_id, s2, 2, j2z, 79, 'Menunggu Giliran'),
    (p_id, s3, 3, j3z, 88, 'Menunggu Giliran');

  -- Pendaftar 4: Dewi Anggraini
  insert into pendaftar (nomor, nama, nik, tanggal_lahir, status_berkas, sekolah_aktif_id, prioritas_aktif)
    values ('PPDB-0004', 'Dewi Anggraini', '347101234567000', '2011-09-30', 'Menunggu Verifikasi', s1, 1) returning id into p_id;
  insert into pilihan (pendaftar_id, sekolah_id, urutan_prioritas, jalur_id, skor, status) values
    (p_id, s1, 1, j1p, 70, 'Menunggu Verifikasi Berkas'),
    (p_id, s2, 2, j2z, 84, 'Menunggu Giliran'),
    (p_id, s3, 3, j3p, 77, 'Menunggu Giliran');

  -- Pendaftar 5: Reza Pratama
  insert into pendaftar (nomor, nama, nik, tanggal_lahir, status_berkas, sekolah_aktif_id, prioritas_aktif)
    values ('PPDB-0005', 'Reza Pratama', '3471012345670005', '2011-05-18', 'Menunggu Verifikasi', s1, 1) returning id into p_id;
  insert into pilihan (pendaftar_id, sekolah_id, urutan_prioritas, jalur_id, skor, status) values
    (p_id, s1, 1, j1p, 95, 'Menunggu Verifikasi Berkas'),
    (p_id, s2, 2, j2p, 90, 'Menunggu Giliran'),
    (p_id, s3, 3, j3p, 92, 'Menunggu Giliran');

  -- Pendaftar 6: Farah Salsabila
  insert into pendaftar (nomor, nama, nik, tanggal_lahir, status_berkas, sekolah_aktif_id, prioritas_aktif)
    values ('PPDB-0006', 'Farah Salsabila', '3471012345670006', '2011-11-02', 'Menunggu Verifikasi', s2, 1) returning id into p_id;
  insert into pilihan (pendaftar_id, sekolah_id, urutan_prioritas, jalur_id, skor, status) values
    (p_id, s2, 1, j2p, 82, 'Menunggu Verifikasi Berkas'),
    (p_id, s1, 2, j1z, 74, 'Menunggu Giliran'),
    (p_id, s3, 3, j3z, 80, 'Menunggu Giliran');

  -- Pendaftar 7: Yusuf Maulana
  insert into pendaftar (nomor, nama, nik, tanggal_lahir, status_berkas, sekolah_aktif_id, prioritas_aktif)
    values ('PPDB-0007', 'Yusuf Maulana', '3471012345670007', '2011-02-14', 'Menunggu Verifikasi', s1, 1) returning id into p_id;
  insert into pilihan (pendaftar_id, sekolah_id, urutan_prioritas, jalur_id, skor, status) values
    (p_id, s1, 1, j1p, 68, 'Menunggu Verifikasi Berkas'),
    (p_id, s2, 2, j2z, 72, 'Menunggu Giliran'),
    (p_id, s3, 3, j3p, 74, 'Menunggu Giliran');

  -- Pendaftar 8: Nadia Ramadhani
  insert into pendaftar (nomor, nama, nik, tanggal_lahir, status_berkas, sekolah_aktif_id, prioritas_aktif)
    values ('PPDB-0008', 'Nadia Ramadhani', '3471012345670008', '2011-04-09', 'Menunggu Verifikasi', s3, 1) returning id into p_id;
  insert into pilihan (pendaftar_id, sekolah_id, urutan_prioritas, jalur_id, skor, status) values
    (p_id, s3, 1, j3z, 74, 'Menunggu Verifikasi Berkas'),
    (p_id, s1, 2, j1z, 69, 'Menunggu Giliran'),
    (p_id, s2, 3, j2z, 71, 'Menunggu Giliran');

  -- Pendaftar 9: Fajar Ilham
  insert into pendaftar (nomor, nama, nik, tanggal_lahir, status_berkas, sekolah_aktif_id, prioritas_aktif)
    values ('PPDB-0009', 'Fajar Ilham', '3471012345670009', '2011-08-27', 'Menunggu Verifikasi', s3, 1) returning id into p_id;
  insert into pilihan (pendaftar_id, sekolah_id, urutan_prioritas, jalur_id, skor, status) values
    (p_id, s3, 1, j3p, 66, 'Menunggu Verifikasi Berkas'),
    (p_id, s2, 2, j2z, 73, 'Menunggu Giliran'),
    (p_id, s1, 3, j1z, 65, 'Menunggu Giliran');

end $$;
