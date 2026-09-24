-- =========================================================
-- RESET DATA DEMO — hapus SEMUA pendaftar dan data turunannya
--
-- ⚠ TIDAK BISA DIBATALKAN. Jalankan hanya sebelum demo/uji coba baru.
--
-- Yang DIHAPUS : pendaftar, pilihan, dokumen (catatan berkas), riwayat transfer,
--               notifikasi, sesi login pendaftar, catatan login gagal.
-- Yang DIPERTAHANKAN: sekolah, jalur (kuota/radius), akun panitia.
-- Nomor pendaftaran dimulai lagi dari PPDB-0001, pendaftaran dibuka kembali.
--
-- File berkas (KK/akta/rapor) di Supabase Storage TIDAK ikut terhapus lewat SQL.
-- Hapus dengan: node reset-berkas-demo.js --ya
-- =========================================================

begin;

delete from notifikasi;
delete from riwayat_transfer;
delete from dokumen;
delete from pilihan;
delete from sesi where tipe = 'pendaftar';
delete from login_gagal;
delete from pendaftar;

-- Nomor pendaftaran berikutnya: PPDB-0001
select setval('pendaftar_nomor_seq', 1, false);

-- Tahapan kembali ke awal: pendaftaran dibuka
update pengaturan
set nilai = 'true', diubah_oleh = 'reset data demo', diubah_at = now()
where kunci = 'pendaftaran_dibuka';

commit;

-- Cek hasil: semua jumlah pendaftar/pilihan/dokumen harus 0, sekolah & panitia tetap ada
select
  (select count(*) from pendaftar)     as pendaftar,
  (select count(*) from pilihan)       as pilihan,
  (select count(*) from dokumen)       as dokumen,
  (select count(*) from sekolah)       as sekolah,
  (select count(*) from jalur)         as jalur,
  (select count(*) from akun_panitia)  as akun_panitia;
