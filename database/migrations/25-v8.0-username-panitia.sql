-- =========================================================
-- MIGRATION v8.0 — Seragamkan username panitia tiga sekolah pertama
-- Aman dijalankan ulang.
--
-- Tiga akun awal masih memakai nama lama (panitia_sekolah1/2/3) padahal sekolahnya SMA Negeri 2, 5,
-- dan 8 Yogyakarta, sehingga membingungkan. Diseragamkan dengan pola akun lain: panitia_sma<nomor>.
-- Password, sesi login, dan data lain TIDAK berubah.
-- (Sejak v8.0 panitia juga dapat login dengan memilih sekolah, tanpa mengetik username.)
-- =========================================================

update akun_panitia set username = 'panitia_sma2'
  where username = 'panitia_sekolah1' and not exists (select 1 from akun_panitia where username = 'panitia_sma2');
update akun_panitia set username = 'panitia_sma5'
  where username = 'panitia_sekolah2' and not exists (select 1 from akun_panitia where username = 'panitia_sma5');
update akun_panitia set username = 'panitia_sma8'
  where username = 'panitia_sekolah3' and not exists (select 1 from akun_panitia where username = 'panitia_sma8');

-- Cek: tidak boleh ada lagi username berawalan panitia_sekolah
select a.username, s.nama as sekolah
from akun_panitia a join sekolah s on s.id = a.sekolah_id
order by a.sekolah_id;
