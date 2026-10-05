-- =========================================================
-- MIGRATION v7.8 — Pengunduran diri pendaftar (K4)
-- Aman dijalankan ulang.
--
-- Pendaftar yang masih diproses atau sudah diterima dapat mengundurkan diri sendiri:
--   * status_global -> 'Mengundurkan Diri' (final, tidak dapat dibatalkan lewat aplikasi);
--   * pilihan yang masih berjalan -> 'Dibatalkan';
--   * bila sudah diterima: pilihan 'Diterima' -> 'Mengundurkan Diri' sehingga kursinya kembali
--     tersedia dan dapat diisi lewat seleksi tahap 2 (sama seperti tidak daftar ulang).
-- Dijalankan sebagai satu transaksi dengan penguncian baris (pola yang sama dengan migration v7.7).
-- =========================================================

alter table pendaftar add column if not exists mundur_at timestamptz;
alter table pendaftar add column if not exists alasan_mundur text;

create or replace function sippdb_mundur(p_pendaftar_id integer, p_alasan text)
returns jsonb language plpgsql set search_path = public as $$
declare
  p pendaftar%rowtype;
begin
  select * into p from pendaftar where id = p_pendaftar_id for update;
  if not found or p.status_global not in ('Aktif', 'Diterima Final') then
    return jsonb_build_object('hasil', 'dilewati');
  end if;

  update pilihan
    set status = case when status = 'Diterima' then 'Mengundurkan Diri' else 'Dibatalkan' end
    where pendaftar_id = p.id
      and status in ('Menunggu Verifikasi Berkas', 'Menunggu Seleksi', 'Menunggu Giliran', 'Diterima');
  update pendaftar
    set status_global = 'Mengundurkan Diri', mundur_at = now(), alasan_mundur = p_alasan, batas_revisi_at = null
    where id = p.id;

  return jsonb_build_object('hasil', 'mundur', 'sebelumnya', p.status_global, 'sekolah_id', p.sekolah_aktif_id,
    'melepas_kursi', p.status_global = 'Diterima Final');
end $$;

revoke all on function sippdb_mundur(integer, text) from public, anon, authenticated;
grant execute on function sippdb_mundur(integer, text) to service_role;

-- Cek: dua kolom + satu fungsi
select column_name from information_schema.columns where table_name = 'pendaftar' and column_name in ('mundur_at', 'alasan_mundur')
union all
select proname from pg_proc where proname = 'sippdb_mundur';
