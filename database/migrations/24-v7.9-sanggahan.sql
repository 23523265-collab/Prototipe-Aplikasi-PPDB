-- =========================================================
-- MIGRATION v7.9 — Masa sanggah (K3)
-- Aman dijalankan ulang.
--
-- Pendaftar yang ditolak di suatu pilihan dapat mengajukan sanggahan dalam 3×24 jam sejak keputusan.
-- Panitia sekolah yang menolak menjawab (wajib beralasan):
--   * Dikabulkan -> pendaftar dikembalikan ke pilihan tersebut (verifikasi ulang), pilihan sesudahnya
--     direset ke "Menunggu Giliran"; dijalankan sebagai SATU transaksi (fungsi sippdb_kabulkan_sanggah).
--     Tidak berlaku bila pendaftar sudah diterima di sekolah lain / mengundurkan diri / tidak daftar ulang.
--   * Ditolak    -> keputusan tetap; jawaban panitia ditampilkan ke pendaftar.
-- =========================================================

-- 1) Waktu keputusan penolakan per pilihan (dasar hitungan masa sanggah)
alter table pilihan add column if not exists ditolak_at timestamptz;

-- 2) Tabel sanggahan
create table if not exists sanggahan (
  id bigserial primary key,
  pendaftar_id integer not null references pendaftar(id) on delete cascade,
  pilihan_id integer not null references pilihan(id) on delete cascade,
  sekolah_id integer references sekolah(id) on delete set null,
  isi text not null,
  status text not null default 'Menunggu' check (status in ('Menunggu', 'Dikabulkan', 'Ditolak')),
  jawaban text,
  dijawab_oleh text,
  dijawab_at timestamptz,
  dibuat_at timestamptz not null default now()
);
create unique index if not exists sanggahan_satu_per_pilihan on sanggahan (pilihan_id);
create index if not exists sanggahan_sekolah_idx on sanggahan (sekolah_id, status);
alter table sanggahan enable row level security;

-- 3) Tolak & alihkan (v7.7) kini juga mencatat waktu penolakan
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
  update pilihan set status = 'Ditolak', alasan_penolakan = p_alasan, ditolak_at = now() where id = aktif.id;

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

-- 4) Kabulkan sanggahan: kembalikan pendaftar ke pilihan yang disanggah (atomik)
create or replace function sippdb_kabulkan_sanggah(p_sanggah_id bigint, p_jawaban text, p_oleh text)
returns jsonb language plpgsql set search_path = public as $$
declare
  s sanggahan%rowtype;
  p pendaftar%rowtype;
  t pilihan%rowtype;
begin
  select * into s from sanggahan where id = p_sanggah_id for update;
  if not found or s.status <> 'Menunggu' then
    return jsonb_build_object('hasil', 'dilewati');
  end if;
  select * into p from pendaftar where id = s.pendaftar_id for update;
  if p.status_global not in ('Aktif', 'Tidak Diterima Final') then
    return jsonb_build_object('hasil', 'tidak_bisa', 'status', p.status_global);
  end if;
  select * into t from pilihan where id = s.pilihan_id for update;
  if not found or t.status <> 'Ditolak' then
    return jsonb_build_object('hasil', 'dilewati');
  end if;

  -- pilihan sesudahnya kembali menunggu giliran
  update pilihan set status = 'Menunggu Giliran', alasan_penolakan = null, ditolak_at = null
    where pendaftar_id = p.id and urutan_prioritas > t.urutan_prioritas
      and status in ('Ditolak', 'Menunggu Verifikasi Berkas', 'Menunggu Seleksi', 'Menunggu Giliran');
  update pilihan set status = 'Menunggu Verifikasi Berkas', alasan_penolakan = null, ditolak_at = null where id = t.id;
  if p.status_global <> 'Aktif' or p.sekolah_aktif_id is distinct from t.sekolah_id then
    insert into riwayat_transfer (pendaftar_id, dari_sekolah_id, ke_sekolah_id, alasan)
      values (p.id, p.sekolah_aktif_id, t.sekolah_id, 'Sanggahan dikabulkan');
  end if;
  update pendaftar
    set status_global = 'Aktif', prioritas_aktif = t.urutan_prioritas, sekolah_aktif_id = t.sekolah_id,
        status_berkas = 'Menunggu Verifikasi', batas_revisi_at = null, catatan_revisi = null
    where id = p.id;
  update sanggahan set status = 'Dikabulkan', jawaban = p_jawaban, dijawab_oleh = p_oleh, dijawab_at = now() where id = s.id;
  return jsonb_build_object('hasil', 'dikabulkan', 'sekolah_id', t.sekolah_id, 'urutan', t.urutan_prioritas);
end $$;

revoke all on function sippdb_kabulkan_sanggah(bigint, text, text) from public, anon, authenticated;
grant execute on function sippdb_kabulkan_sanggah(bigint, text, text) to service_role;
revoke all on function sippdb_tolak_dan_alihkan(integer, text, boolean) from public, anon, authenticated;
grant execute on function sippdb_tolak_dan_alihkan(integer, text, boolean) to service_role;

-- Cek: kolom ditolak_at, tabel sanggahan (RLS aktif), fungsi kabulkan
select 'kolom ditolak_at' as cek, count(*)::text as hasil from information_schema.columns where table_name = 'pilihan' and column_name = 'ditolak_at'
union all select 'tabel sanggahan + RLS', relrowsecurity::text from pg_class where relname = 'sanggahan'
union all select 'fungsi kabulkan', count(*)::text from pg_proc where proname = 'sippdb_kabulkan_sanggah';
