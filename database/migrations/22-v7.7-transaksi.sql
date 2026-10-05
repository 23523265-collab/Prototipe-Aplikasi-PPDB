-- =========================================================
-- MIGRATION v7.7 — Proses inti dalam TRANSAKSI database (menutup temuan audit BUG-01/02/03)
-- Aman dijalankan ulang (create or replace).
--
-- Sebelumnya setiap aksi (tolak & alihkan, terima, verifikasi, lepas kursi) dikirim server sebagai
-- beberapa perintah terpisah. Bila terputus di tengah, data bisa setengah jadi (mis. pilihan 1 sudah
-- "Ditolak" tetapi pilihan 2 belum aktif, sehingga siswa "terdampar").
--
-- Sekarang setiap aksi adalah SATU fungsi PostgreSQL = satu transaksi:
--   * semua langkah berhasil bersama, atau dibatalkan semua (atomik);
--   * baris pendaftar dikunci (SELECT ... FOR UPDATE) sehingga dua proses yang menyentuh siswa
--     yang sama tidak saling menimpa;
--   * kondisi diperiksa ulang di dalam kunci (mis. masih Aktif, masa revisi benar-benar lewat);
--   * penerimaan memeriksa kuota jalur di dalam kunci baris jalur, sehingga kuota tidak mungkin terlampaui.
-- Notifikasi & email tetap dikirim server SETELAH transaksi berhasil (email tidak bisa dibatalkan).
-- Fungsi hanya dapat dipanggil server (service_role), tidak oleh pengguna anonim.
-- =========================================================

-- 1) Tolak di pilihan aktif lalu alihkan ke pilihan berikutnya (FR-05 Auto-Transfer)
--    p_cek_revisi = true: hanya bila masih "Kurang Lengkap" dan masa revisi sudah lewat (cegah balapan
--    dengan pendaftar yang baru saja mengunggah revisi).
create or replace function sippdb_tolak_dan_alihkan(p_pendaftar_id integer, p_alasan text, p_cek_revisi boolean default false)
returns jsonb language plpgsql set search_path = public as $$
declare
  p pendaftar%rowtype;
  aktif pilihan%rowtype;
  berikut pilihan%rowtype;
begin
  select * into p from pendaftar where id = p_pendaftar_id for update;
  if not found or p.status_global <> 'Aktif' then
    return jsonb_build_object('hasil', 'dilewati');
  end if;
  if p_cek_revisi and not (p.status_berkas = 'Kurang Lengkap' and p.batas_revisi_at < now()) then
    return jsonb_build_object('hasil', 'dilewati');
  end if;

  select * into aktif from pilihan where pendaftar_id = p.id and urutan_prioritas = p.prioritas_aktif for update;
  if not found then
    return jsonb_build_object('hasil', 'dilewati');
  end if;
  update pilihan set status = 'Ditolak', alasan_penolakan = p_alasan where id = aktif.id;

  select * into berikut from pilihan where pendaftar_id = p.id and urutan_prioritas = p.prioritas_aktif + 1 for update;
  if found then
    update pendaftar
      set sekolah_aktif_id = berikut.sekolah_id, prioritas_aktif = p.prioritas_aktif + 1,
          status_berkas = 'Menunggu Verifikasi', batas_revisi_at = null, catatan_revisi = null
      where id = p.id;
    update pilihan set status = 'Menunggu Verifikasi Berkas' where id = berikut.id;
    insert into riwayat_transfer (pendaftar_id, dari_sekolah_id, ke_sekolah_id, alasan)
      values (p.id, aktif.sekolah_id, berikut.sekolah_id, p_alasan);
    return jsonb_build_object('hasil', 'dialihkan', 'dari_sekolah_id', aktif.sekolah_id,
      'ke_sekolah_id', berikut.sekolah_id, 'prioritas_baru', p.prioritas_aktif + 1);
  end if;

  update pendaftar set status_global = 'Tidak Diterima Final' where id = p.id;
  return jsonb_build_object('hasil', 'final', 'dari_sekolah_id', aktif.sekolah_id);
end $$;

-- 2) Terima di pilihan aktif (FR-04). Kuota diperiksa di dalam kunci baris jalur.
create or replace function sippdb_terima(p_pendaftar_id integer, p_jalur_id integer, p_jam_daftar_ulang integer)
returns jsonb language plpgsql set search_path = public as $$
declare
  p pendaftar%rowtype;
  aktif pilihan%rowtype;
  j jalur%rowtype;
  terisi integer;
  batas timestamptz := now() + make_interval(hours => p_jam_daftar_ulang);
begin
  select * into j from jalur where id = p_jalur_id for update;     -- antre per jalur
  select * into p from pendaftar where id = p_pendaftar_id for update;
  if not found or p.status_global <> 'Aktif' then
    return jsonb_build_object('hasil', 'dilewati');
  end if;
  select * into aktif from pilihan where pendaftar_id = p.id and urutan_prioritas = p.prioritas_aktif for update;
  if not found or aktif.jalur_id <> p_jalur_id or aktif.status <> 'Menunggu Seleksi' then
    return jsonb_build_object('hasil', 'dilewati');
  end if;
  select count(*) into terisi from pilihan where jalur_id = p_jalur_id and status = 'Diterima';
  if terisi >= j.kuota then
    return jsonb_build_object('hasil', 'kuota_penuh');
  end if;

  update pilihan set status = 'Diterima' where id = aktif.id;
  update pendaftar set status_global = 'Diterima Final', daftar_ulang_batas_at = batas where id = p.id;
  update pilihan set status = 'Dibatalkan' where pendaftar_id = p.id and urutan_prioritas > p.prioritas_aktif;
  return jsonb_build_object('hasil', 'diterima', 'sekolah_id', aktif.sekolah_id, 'batas_daftar_ulang', batas);
end $$;

-- 3) Verifikasi berkas oleh panitia (FR-02): Lengkap / Kurang Lengkap / Ditolak (+ alihkan)
create or replace function sippdb_verifikasi(p_pendaftar_id integer, p_status text, p_catatan text, p_jam_revisi integer)
returns jsonb language plpgsql set search_path = public as $$
declare
  p pendaftar%rowtype;
  batas timestamptz := now() + make_interval(hours => p_jam_revisi);
  hasil jsonb;
begin
  select * into p from pendaftar where id = p_pendaftar_id for update;
  if not found or p.status_global <> 'Aktif' then
    return jsonb_build_object('hasil', 'dilewati');
  end if;

  if p_status = 'Kurang Lengkap' then
    update pendaftar set status_berkas = 'Kurang Lengkap', batas_revisi_at = batas, catatan_revisi = p_catatan where id = p.id;
    return jsonb_build_object('hasil', 'kurang', 'sekolah_id', p.sekolah_aktif_id, 'batas_revisi', batas);
  elsif p_status = 'Lengkap' then
    update pendaftar set status_berkas = 'Lengkap', batas_revisi_at = null, catatan_revisi = null where id = p.id;
    update pilihan set status = 'Menunggu Seleksi' where pendaftar_id = p.id and urutan_prioritas = p.prioritas_aktif;
    return jsonb_build_object('hasil', 'lengkap', 'sekolah_id', p.sekolah_aktif_id);
  elsif p_status = 'Ditolak' then
    update pendaftar set status_berkas = 'Ditolak', batas_revisi_at = null, catatan_revisi = null where id = p.id;
    hasil := sippdb_tolak_dan_alihkan(p.id, 'Berkas tidak lengkap/tidak sesuai', false);  -- transaksi yang sama
    return hasil;
  end if;
  raise exception 'Status verifikasi tidak dikenal: %', p_status;
end $$;

-- 4) Lepas kursi siswa yang tidak daftar ulang sampai batas (K2)
create or replace function sippdb_lepas_kursi(p_pendaftar_id integer)
returns jsonb language plpgsql set search_path = public as $$
declare
  p pendaftar%rowtype;
begin
  select * into p from pendaftar where id = p_pendaftar_id for update;
  if not found or p.status_global <> 'Diterima Final' or p.daftar_ulang_at is not null
     or p.daftar_ulang_batas_at is null or p.daftar_ulang_batas_at >= now() then
    return jsonb_build_object('hasil', 'dilewati');
  end if;
  update pendaftar set status_global = 'Tidak Daftar Ulang' where id = p.id;
  update pilihan set status = 'Tidak Daftar Ulang'
    where pendaftar_id = p.id and urutan_prioritas = p.prioritas_aktif and status = 'Diterima';
  insert into log_aktivitas (aktor_tipe, aktor, sekolah_id, pendaftar_id, aksi, detail)
    values ('sistem', 'Sistem (otomatis)', p.sekolah_aktif_id, p.id, 'Kursi dilepas: tidak daftar ulang',
            'batas ' || to_char(p.daftar_ulang_batas_at at time zone 'Asia/Jakarta', 'DD-MM-YYYY HH24:MI') || ' WIB');
  return jsonb_build_object('hasil', 'dilepas', 'sekolah_id', p.sekolah_aktif_id, 'batas', p.daftar_ulang_batas_at);
end $$;

-- Hanya server (service_role) yang boleh memanggil
revoke all on function sippdb_tolak_dan_alihkan(integer, text, boolean) from public, anon, authenticated;
revoke all on function sippdb_terima(integer, integer, integer) from public, anon, authenticated;
revoke all on function sippdb_verifikasi(integer, text, text, integer) from public, anon, authenticated;
revoke all on function sippdb_lepas_kursi(integer) from public, anon, authenticated;
grant execute on function sippdb_tolak_dan_alihkan(integer, text, boolean) to service_role;
grant execute on function sippdb_terima(integer, integer, integer) to service_role;
grant execute on function sippdb_verifikasi(integer, text, text, integer) to service_role;
grant execute on function sippdb_lepas_kursi(integer) to service_role;

-- Cek: harus menampilkan 4 fungsi
select proname from pg_proc where proname like 'sippdb\_%' order by proname;
