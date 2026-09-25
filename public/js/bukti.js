// Halaman bukti pendaftaran: memakai sesi login pendaftar yang sama dengan halaman Cek Status
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const tanggal = (d, opsi = { dateStyle: "long" }) =>
  d ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? d : d + "Z").toLocaleString("id-ID", { timeZone: "Asia/Jakarta", ...opsi }) : "-";

async function muat() {
  const kertas = document.getElementById("kertas");
  try {
    const sesi = await fetch("/api/auth/me").then((r) => r.json());
    if (!sesi.pendaftar) {
      kertas.innerHTML = `<p style="text-align:center">Silakan login terlebih dahulu di menu <strong>Cek Status</strong>, lalu buka kembali bukti pendaftaran.</p>
        <p style="text-align:center"><a class="btn btn-primary" href="/">Ke halaman login</a></p>`;
      return;
    }
    const res = await fetch(`/api/pendaftar/nomor/${encodeURIComponent(sesi.pendaftar.nomor)}`);
    if (!res.ok) throw new Error("Gagal memuat data pendaftaran.");
    const { pendaftar: p, pilihan } = await res.json();

    const barisPilihan = pilihan.map((pl) => `
      <tr>
        <td>${pl.urutan_prioritas}</td>
        <td>${esc(pl.sekolah_nama)}</td>
        <td>${esc(pl.jalur_nama)}</td>
        <td>${pl.jarak_km != null ? `${Number(pl.jarak_km).toFixed(2)} km` : pl.catatan_skor ? esc(pl.catatan_skor) : "-"}</td>
        <td>${esc(pl.status)}</td>
      </tr>`).join("");

    kertas.innerHTML = `
      <div class="kop">
        <div class="brand-badge">${ikon("toga")}</div>
        <div>
          <h1>SiPPDB — Penerimaan Peserta Didik Baru</h1>
          <p>Tahun Ajaran ${new Date().getFullYear()}/${new Date().getFullYear() + 1} · Kota Yogyakarta & Kabupaten Sleman</p>
        </div>
      </div>
      <p class="judul-bukti">BUKTI PENDAFTARAN</p>
      <p class="nomor-besar">${esc(p.nomor)}</p>

      <table class="data-diri">
        <tr><td>Nama Lengkap</td><td><strong>${esc(p.nama)}</strong></td></tr>
        <tr><td>NIK</td><td>${esc(p.nik)}</td></tr>
        <tr><td>Tanggal Lahir</td><td>${tanggal(p.tanggal_lahir)}</td></tr>
        <tr><td>Email</td><td>${esc(p.email)}</td></tr>
        <tr><td>Alamat</td><td>${esc(p.alamat || "-")}</td></tr>
        <tr><td>Nilai Rapor</td><td>${p.nilai_rapor != null ? esc(p.nilai_rapor) : "-"}</td></tr>
        <tr><td>Waktu Pendaftaran</td><td>${tanggal(p.created_at, { dateStyle: "long", timeStyle: "short" })} WIB</td></tr>
        <tr><td>Status Saat Ini</td><td><strong>${esc(p.status_global)}</strong> · Berkas: ${esc(p.status_berkas)}</td></tr>
      </table>

      <div class="table-wrap">
        <table>
          <thead><tr><th>Pilihan</th><th>Sekolah</th><th>Jalur</th><th>Jarak</th><th>Status</th></tr></thead>
          <tbody>${barisPilihan}</tbody>
        </table>
      </div>

      <div class="catatan-bukti">
        Simpan bukti ini dan bawa saat daftar ulang. Status dapat berubah selama proses seleksi —
        pantau perkembangan terbaru di menu <strong>Cek Status</strong> dengan nomor pendaftaran dan password Anda.
        Dicetak: ${tanggal(new Date().toISOString(), { dateStyle: "long", timeStyle: "short" })} WIB.
      </div>
      <div class="ttd"><div>Pendaftar,<br><br><br><br>( ${esc(p.nama)} )</div></div>
    `;
    document.title = `Bukti Pendaftaran ${p.nomor} — SiPPDB`;
  } catch (err) {
    kertas.innerHTML = `<p style="text-align:center;color:#b91c1c">${esc(err.message)}</p>`;
  }
}

muat();
