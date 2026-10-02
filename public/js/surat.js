// Surat Keterangan Diterima: hanya untuk pendaftar yang diterima DAN sudah mengonfirmasi daftar ulang
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const tanggal = (d, opsi = { dateStyle: "long" }) =>
  d ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? d : d + "Z").toLocaleString("id-ID", { timeZone: "Asia/Jakarta", ...opsi }) : "-";

async function muat() {
  const kertas = document.getElementById("kertas");
  try {
    const sesi = await fetch("/api/auth/me").then((r) => r.json());
    if (!sesi.pendaftar) {
      kertas.innerHTML = `<p style="text-align:center">Silakan login terlebih dahulu di menu <strong>Cek Status</strong>.</p>
        <p style="text-align:center"><a class="btn btn-primary" href="/">Ke halaman login</a></p>`;
      return;
    }
    const res = await fetch(`/api/pendaftar/nomor/${encodeURIComponent(sesi.pendaftar.nomor)}`);
    if (!res.ok) throw new Error("Gagal memuat data pendaftaran.");
    const { pendaftar: p, pilihan } = await res.json();
    if (p.status_global !== "Diterima Final" || !p.daftar_ulang_at) {
      kertas.innerHTML = `<p style="text-align:center">Surat Keterangan Diterima tersedia setelah Anda <strong>dinyatakan diterima</strong> dan <strong>mengonfirmasi daftar ulang</strong> di menu Cek Status.</p>
        <p style="text-align:center"><a class="btn btn-primary" href="/">Ke Cek Status</a></p>`;
      return;
    }
    const diterima = pilihan.find((x) => x.status === "Diterima") || {};
    const tahun = new Date(p.daftar_ulang_at).getFullYear();
    kertas.innerHTML = `
      <div class="kop">
        <div class="brand-badge">${ikon("toga")}</div>
        <div>
          <h1>SiPPDB — Penerimaan Peserta Didik Baru</h1>
          <p>Tahun Ajaran ${tahun}/${tahun + 1} · Kota Yogyakarta & Kabupaten Sleman</p>
        </div>
      </div>
      <p class="judul-surat"><strong>SURAT KETERANGAN DITERIMA</strong><span>Nomor: ${esc(p.nomor)}/SKD/SPMB/${tahun}</span></p>

      <p>Berdasarkan hasil seleksi Penerimaan Peserta Didik Baru Tahun Ajaran ${tahun}/${tahun + 1}, dengan ini diterangkan bahwa:</p>
      <table class="isi-surat">
        <tr><td>Nama Lengkap</td><td>:</td><td><strong>${esc(p.nama)}</strong></td></tr>
        <tr><td>NIK</td><td>:</td><td>${esc(p.nik)}</td></tr>
        <tr><td>Tanggal Lahir</td><td>:</td><td>${tanggal(p.tanggal_lahir)}</td></tr>
        <tr><td>Nomor Pendaftaran</td><td>:</td><td>${esc(p.nomor)}</td></tr>
        <tr><td>Alamat</td><td>:</td><td>${esc(p.alamat || "-")}</td></tr>
      </table>

      <div class="sekolah-tujuan"><small>Dinyatakan diterima di</small><strong>${esc(diterima.sekolah_nama || "-")}</strong><div>melalui jalur <b>${esc(diterima.jalur_nama || "-")}</b> (Pilihan ${esc(diterima.urutan_prioritas || "-")})</div></div>

      <p>Peserta didik tersebut telah <strong>mengonfirmasi daftar ulang</strong> pada ${tanggal(p.daftar_ulang_at, { dateStyle: "long", timeStyle: "short" })} WIB.
      Surat ini dibawa ke sekolah tujuan bersama berkas asli (Kartu Keluarga, akta kelahiran, dan rapor) sesuai jadwal yang ditetapkan sekolah.</p>

      <div class="ttd"><div>Yogyakarta, ${tanggal(p.daftar_ulang_at)}<br>Panitia SPMB<br><br><br><br>( ................................ )</div></div>

      <div class="catatan-surat">Dokumen diterbitkan otomatis oleh SiPPDB. Keabsahan dapat dicek panitia sekolah melalui nomor pendaftaran ${esc(p.nomor)} pada panel panitia.
      Dicetak: ${tanggal(new Date().toISOString(), { dateStyle: "long", timeStyle: "short" })} WIB.</div>`;
    document.title = `Surat Keterangan Diterima ${p.nomor} — SiPPDB`;
  } catch (err) {
    kertas.innerHTML = `<p style="text-align:center;color:#b91c1c">${esc(err.message)}</p>`;
  }
}

muat();
