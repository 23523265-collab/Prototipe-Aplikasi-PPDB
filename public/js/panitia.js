let sekolahList = [];
let jalurList = [];
let sesi = { panitia: null };
let antreanData = [];
let petaLokasi = null;

// Hanya izinkan link http(s), supaya URL "javascript:..." tidak bisa disisipkan
const safeUrl = (u) => (/^https?:\/\//i.test(String(u ?? "")) ? esc(u) : "#");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const formatWaktuWIB = (d) =>
  new Date(d).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) + " WIB";

const sekolahNama = (id) => sekolahList.find((s) => s.id === id)?.nama ?? "-";

function pillHTML(status) {
  const map = {
    "Lengkap": ["pill-green", "centang"],
    "Menunggu Verifikasi": ["pill-amber", "jam"],
    "Menunggu Verifikasi Berkas": ["pill-amber", "jam"],
    "Menunggu Seleksi": ["pill-amber", "jam"],
    "Menunggu Giliran": ["pill-gray", "strip"],
    "Kurang Lengkap": ["pill-orange", "peringatan"],
    "Ditolak": ["pill-red", "silang"],
    "Diterima": ["pill-green", "centang"],
    "Dibatalkan": ["pill-gray", "strip"],
    "Aktif": ["pill-amber", "jam"],
    "Diterima Final": ["pill-green", "centang"],
    "Tidak Diterima Final": ["pill-red", "silang"],
  };
  const [cls, icon] = map[status] || ["pill-gray", "strip"];
  return `<span class="pill ${cls}">${ikon(icon)} ${esc(status)}</span>`;
}

async function muatSesi() {
  const data = await fetch("/api/auth/me").then((r) => r.json());
  sesi = { panitia: data.panitia };
}

async function init() {
  sekolahList = await fetch("/api/sekolah").then((r) => r.json());
  jalurList = await fetch("/api/jalur").then((r) => r.json());
  await renderPanitiaView();
}

/* =========================================================
   LOGIN & PANEL PANITIA
   ========================================================= */
document.getElementById("form-login-panitia").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const errBox = document.getElementById("panitia-login-error");
  const res = await fetch("/api/auth/panitia/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: form.username.value, password: form.password.value }),
  });
  const data = await res.json();
  if (!res.ok) {
    errBox.style.display = "block";
    errBox.innerText = data.error;
    return;
  }
  errBox.style.display = "none";
  await renderPanitiaView();
});

document.getElementById("btn-logout-panitia").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  await renderPanitiaView();
});

async function renderPanitiaView() {
  await muatSesi();
  const loggedIn = !!sesi.panitia;
  document.getElementById("memuat-halaman").style.display = "none";
  document.getElementById("panitia-login-wrap").style.display = loggedIn ? "none" : "flex";
  document.getElementById("panitia-view-wrap").style.display = loggedIn ? "block" : "none";
  document.getElementById("btn-logout-panitia").style.display = loggedIn ? "inline-block" : "none";
  document.getElementById("panitia-nama-label").innerText = loggedIn
    ? `${sesi.panitia.nama} · ${sekolahNama(sesi.panitia.sekolahId)}`
    : "";
  if (!loggedIn) return;

  const sekolahId = sesi.panitia.sekolahId;
  const antrean = await fetch(`/api/sekolah/${sekolahId}/antrean`).then((r) => r.json());
  antreanData = Array.isArray(antrean) ? antrean : [];
  renderTabelAntrean();

  const [tahapan, statistik] = await Promise.all([
    fetch("/api/tahapan").then((r) => r.json()),
    fetch(`/api/sekolah/${sekolahId}/statistik`).then((r) => (r.ok ? r.json() : [])),
  ]);
  renderTahapan(tahapan);
  renderStatistik(statistik);
  document.getElementById("btn-export").href = `/api/sekolah/${sekolahId}/export.csv`;
  const seleksiTerkunci = tahapan.aktif && tahapan.dibuka;

  const jalurSekolah = jalurList.filter((j) => j.sekolah_id === Number(sekolahId));
  const container = document.getElementById("jalur-seleksi-container");
  container.innerHTML = jalurSekolah.map((j) => `
    <div class="jalur-mini-card">
      <strong>${esc(j.nama)}</strong> · kuota ${j.kuota}${j.syarat_nilai_minimum ? `, min. nilai ${j.syarat_nilai_minimum}` : ""}${j.syarat_radius_km ? `, radius ${j.syarat_radius_km} km` : ""}
      <br/>
      <button class="btn btn-accent" style="margin-top:8px;padding:6px 12px;font-size:13px" onclick="jalankanSeleksi(${j.id}, this)"
        ${seleksiTerkunci ? 'disabled title="Tutup pendaftaran terlebih dahulu"' : ""}>Jalankan Seleksi</button>
    </div>
  `).join("") + (seleksiTerkunci
    ? `<p class="muted" style="font-size:12.5px;margin-top:4px">${ikon("gembok")} Seleksi baru bisa dijalankan setelah pendaftaran ditutup (lihat kotak Tahapan PPDB di atas).</p>`
    : "");
}

/* =========================================================
   ANTREAN: tab penyaring + pencarian (di browser, tanpa memuat ulang data)
   ========================================================= */
function daftarPeringatan(a) {
  const peringatan = [];
  if (a.catatan_validasi_nik) peringatan.push(`NIK: ${a.catatan_validasi_nik}`);
  if (a.catatan_validasi_alamat) peringatan.push(`Alamat: ${a.catatan_validasi_alamat}`);
  (a.dokumen || []).forEach((d) => {
    if (d.catatan_validasi) peringatan.push(`${d.jenis}: ${d.catatan_validasi}`);
  });
  if ((a.berkas_belum_ada || []).length) peringatan.push(`Belum diunggah: ${a.berkas_belum_ada.join(", ")}`);
  return peringatan;
}

const FILTER_ANTREAN = [
  { kunci: "semua", label: "Semua", cocok: () => true },
  { kunci: "verifikasi", label: "Perlu verifikasi", cocok: (a) => a.status_berkas === "Menunggu Verifikasi" },
  { kunci: "kurang", label: "Kurang Lengkap", cocok: (a) => a.status_berkas === "Kurang Lengkap" },
  { kunci: "lengkap", label: "Lengkap", cocok: (a) => a.status_berkas === "Lengkap" },
  { kunci: "peringatan", label: "Ada peringatan", cocok: (a) => daftarPeringatan(a).length > 0 },
];
let filterAntrean = "semua";

function pilihFilterAntrean(kunci) {
  filterAntrean = kunci;
  renderTabelAntrean();
}
document.getElementById("cari-antrean").addEventListener("input", () => renderTabelAntrean());

function renderTabelAntrean() {
  const antrean = antreanData;
  document.getElementById("filter-antrean").innerHTML = FILTER_ANTREAN.map((f) => `
    <button type="button" class="tab-item ${f.kunci === filterAntrean ? "aktif" : ""}" onclick="pilihFilterAntrean('${f.kunci}')">
      ${f.label} <span class="tab-jumlah">${antrean.filter(f.cocok).length}</span>
    </button>`).join("");

  const kata = document.getElementById("cari-antrean").value.trim().toLowerCase();
  const filter = FILTER_ANTREAN.find((f) => f.kunci === filterAntrean);
  const tampil = antrean.filter((a) => filter.cocok(a) &&
    (!kata || String(a.nama).toLowerCase().includes(kata) || String(a.nomor).toLowerCase().includes(kata)));

  // Tabel ringkas: detail (dokumen, lokasi, peringatan, aksi) ada di panel samping saat baris diklik
  const tbody = document.querySelector("#table-panitia tbody");
  tbody.innerHTML = tampil.length
    ? tampil.map((a) => {
        const jumlahPeringatan = daftarPeringatan(a).length;
        const jumlahDokumen = (a.dokumen || []).length;
        return `
        <tr class="baris-klik ${a.pendaftar_id === detailId ? "terpilih" : ""}" tabindex="0" onclick="bukaDetail(${a.pendaftar_id})"
            onkeydown="if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); bukaDetail(${a.pendaftar_id}); }">
          <td data-label="Pendaftar"><strong>${esc(a.nama)}</strong><div class="sel-sub">${esc(a.nomor)} · Pilihan ${a.prioritas_aktif}</div></td>
          <td data-label="Jalur">${esc(a.jalur_nama)}${infoJarak(a)}</td>
          <td data-label="Skor"><strong>${a.skor}</strong><div class="sel-sub">${a.syarat_radius_km != null ? "dari jarak" : a.nilai_rapor != null ? `rapor ${esc(a.nilai_rapor)}` : ""}</div></td>
          <td data-label="Berkas">${pillHTML(a.status_berkas)}<div class="sel-sub">${jumlahDokumen}/3 dokumen</div>${infoRevisi(a)}</td>
          <td data-label="Peringatan">${jumlahPeringatan
            ? `<span class="lencana lencana-peringatan">${ikon("peringatan")} ${jumlahPeringatan} peringatan</span>`
            : `<span class="lencana lencana-aman">${ikon("centang")} Aman</span>`}</td>
          <td class="sel-aksi"><span class="tombol-periksa">Periksa ${ikon("panahKanan")}</span></td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:22px">${antrean.length ? "Tidak ada pendaftar yang cocok dengan penyaring/pencarian." : "Belum ada pendaftar aktif di sekolah ini."}</td></tr>`;

  // Panel detail yang sedang terbuka ikut diperbarui (atau ditutup kalau pendaftar sudah keluar dari antrean)
  if (detailId != null) {
    if (antreanData.some((a) => a.pendaftar_id === detailId)) renderDetail();
    else tutupDetail();
  }
}

/* =========================================================
   PANEL DETAIL PENDAFTAR
   ========================================================= */
let detailId = null;
const JENIS_DOKUMEN = ["Kartu Keluarga", "Akta Kelahiran", "Rapor Terakhir"];

function bukaDetail(pendaftarId) {
  detailId = pendaftarId;
  renderDetail();
  document.body.classList.add("laci-terbuka");
  document.getElementById("laci-detail").setAttribute("aria-hidden", "false");
  document.querySelectorAll("#table-panitia tr.baris-klik").forEach((tr) => tr.classList.remove("terpilih"));
  document.querySelector(`#table-panitia tr[onclick="bukaDetail(${pendaftarId})"]`)?.classList.add("terpilih");
  setTimeout(() => document.querySelector(".laci-tutup").focus(), 50);
}

function tutupDetail() {
  if (detailId == null) return;
  const baris = document.querySelector(`#table-panitia tr[onclick="bukaDetail(${detailId})"]`);
  detailId = null;
  document.body.classList.remove("laci-terbuka");
  document.getElementById("laci-detail").setAttribute("aria-hidden", "true");
  document.querySelectorAll("#table-panitia tr.terpilih").forEach((tr) => tr.classList.remove("terpilih"));
  baris?.focus();
}

function renderDetail() {
  const a = antreanData.find((x) => x.pendaftar_id === detailId);
  if (!a) return;
  const peringatan = daftarPeringatan(a);
  const belumAda = a.berkas_belum_ada || [];
  const zonasi = a.syarat_radius_km != null;

  document.getElementById("laci-sub").innerText = `${a.nomor} · Pilihan ${a.prioritas_aktif} · ${a.jalur_nama}`;
  document.getElementById("laci-judul").innerText = a.nama;

  const dokumenHTML = JENIS_DOKUMEN.map((jenis) => {
    const d = (a.dokumen || []).find((x) => x.jenis === jenis);
    return d
      ? `<a class="berkas-chip" href="${safeUrl(d.url)}" target="_blank" rel="noopener">${ikon("berkas")}<span><strong>${esc(jenis)}</strong><small>${esc(d.nama_file || "Buka berkas")}</small></span>${ikon("panahKanan")}</a>`
      : `<div class="berkas-chip kosong">${ikon("berkas")}<span><strong>${esc(jenis)}</strong><small>Belum diunggah</small></span></div>`;
  }).join("");

  document.getElementById("laci-isi").innerHTML = `
    <div class="laci-status">${pillHTML(a.status_berkas)}${infoRevisi(a)}</div>

    <dl class="laci-data">
      <div><dt>NIK</dt><dd>${esc(a.nik)}</dd></div>
      <div><dt>Skor</dt><dd>${a.skor} <small>${zonasi ? "(dari jarak)" : "(nilai rapor)"}</small></dd></div>
      ${zonasi ? `<div><dt>Jarak ke sekolah</dt><dd>${a.jarak_km != null ? `${Number(a.jarak_km).toFixed(2)} km` : "-"} <small>/ radius ${esc(a.syarat_radius_km)} km</small></dd></div>` : ""}
      <div><dt>Nilai rapor</dt><dd>${a.nilai_rapor ?? "-"}${a.nilai_rapor_dikoreksi_oleh ? ` <small>(dikoreksi dari ${esc(a.nilai_rapor_awal ?? "-")})</small>` : ""}
        <button type="button" class="link-btn" style="margin:0 0 0 6px" onclick="koreksiNilai(${a.pendaftar_id})">${ikon("pensil")} Koreksi</button></dd></div>
    </dl>

    <h4 class="laci-bagian">Berkas</h4>
    <div class="berkas-daftar">${dokumenHTML}</div>

    <h4 class="laci-bagian">Peringatan otomatis</h4>
    ${peringatan.length
      ? `<ul class="laci-peringatan">${peringatan.map((x) => `<li>${ikon("peringatan")}<span>${esc(x)}</span></li>`).join("")}</ul>`
      : `<p class="laci-aman">${ikon("perisai")} Tidak ada peringatan. NIK, berkas, dan alamat lolos pemeriksaan otomatis.</p>`}

    <h4 class="laci-bagian">Alamat &amp; lokasi rumah</h4>
    <p class="laci-alamat">${esc(a.alamat) || '<span class="muted" style="margin:0">Alamat tidak diisi</span>'}</p>
    <button type="button" class="btn btn-outline" style="width:100%" onclick="bukaLokasi(${a.pendaftar_id})">${ikon("lokasi")} Lihat di peta & cocokkan dengan KK</button>`;

  document.getElementById("laci-kaki").innerHTML = `
    ${belumAda.length ? `<p class="laci-catatan">${ikon("info")} Tombol Lengkap aktif setelah ${esc(belumAda.join(", "))} diunggah.</p>` : ""}
    <div class="laci-tombol">
      <button type="button" class="btn btn-sukses" ${belumAda.length ? "disabled" : ""} onclick="verifikasi(${a.pendaftar_id}, 'Lengkap')">${ikon("centang")} Lengkap</button>
      <button type="button" class="btn btn-peringatan" onclick="tandaiKurang(${a.pendaftar_id})">${ikon("peringatan")} Kurang</button>
      <button type="button" class="btn btn-bahaya-garis" onclick="tolakBerkas(${a.pendaftar_id})">${ikon("silang")} Tolak</button>
    </div>`;
}

/* =========================================================
   STATISTIK PER JALUR
   ========================================================= */
function renderStatistik(daftar) {
  const box = document.getElementById("statistik-container");
  box.innerHTML = daftar.map((j) => {
    const persen = j.kuota ? Math.min(100, Math.round((j.diterima / j.kuota) * 100)) : 0;
    return `
    <div class="statistik-kartu">
      <div class="statistik-judul">${esc(j.nama)} <span class="muted" style="margin:0;font-size:12px">${j.syarat_radius_km ? `radius ${esc(j.syarat_radius_km)} km` : j.syarat_nilai_minimum ? `min. nilai ${esc(j.syarat_nilai_minimum)}` : ""}</span></div>
      <div class="statistik-kuota"><strong>${j.diterima}</strong> / ${j.kuota} kursi terisi · sisa <strong>${j.sisa_kuota}</strong></div>
      <div class="bar-kuota"><div style="width:${persen}%"></div></div>
      <div class="statistik-rinci">
        <span>${ikon("orang")} Peminat <strong>${j.peminat}</strong></span>
        <span>${ikon("jam")} Verifikasi <strong>${j.menunggu_verifikasi}</strong></span>
        <span>${ikon("daftarCek")} Siap seleksi <strong>${j.menunggu_seleksi}</strong></span>
        <span>${ikon("strip")} Cadangan <strong>${j.cadangan}</strong></span>
        <span>${ikon("silang")} Ditolak <strong>${j.ditolak}</strong></span>
      </div>
    </div>`;
  }).join("") || '<p class="muted">Statistik belum tersedia.</p>';
}

/* =========================================================
   TAHAPAN PPDB (buka/tutup pendaftaran)
   ========================================================= */
function renderTahapan(t) {
  const box = document.getElementById("tahapan-box");
  if (!t.aktif) {
    box.innerHTML = '<span class="muted" style="margin:0">Fitur tahapan belum aktif — jalankan migration v6.7.</span>';
    return;
  }
  const info = t.diubahOleh ? `<div class="muted" style="margin:4px 0 0;font-size:12px">Terakhir diubah oleh ${esc(t.diubahOleh)} · ${esc(formatWaktuWIB(t.diubahAt))}</div>` : "";
  box.innerHTML = `
    <div>
      <div class="tahapan-label">Tahapan PPDB <span class="muted" style="font-size:11.5px;margin:0">(berlaku untuk semua sekolah)</span></div>
      <div class="tahapan-status ${t.dibuka ? "buka" : "tutup"}">${t.dibuka ? ikon("gembokBuka") + " Pendaftaran DIBUKA — seleksi belum bisa dijalankan" : ikon("gembok") + " Pendaftaran DITUTUP — seleksi dapat dijalankan"}</div>
      ${info}
    </div>
    <span class="muted" style="margin:0;font-size:12.5px">${ikon("dinas")} Buka/tutup pendaftaran diatur oleh <strong>Admin Dinas</strong>.</span>`;
}


// Masa revisi berkas "Kurang Lengkap": batas waktu + catatan panitia
function infoRevisi(a) {
  if (a.status_berkas !== "Kurang Lengkap" || !a.batas_revisi_at) return "";
  return `<br/><span style="font-size:11px;color:#c2410c">${ikon("jam")} revisi s/d ${esc(formatWaktuWIB(a.batas_revisi_at))}</span>` +
    (a.catatan_revisi ? `<br/><span style="font-size:11px;color:var(--muted)">"${esc(a.catatan_revisi)}"</span>` : "");
}

async function tandaiKurang(pendaftarId) {
  const a = antreanData.find((x) => x.pendaftar_id === pendaftarId);
  const belum = a?.berkas_belum_ada?.length ? `Belum diunggah: ${a.berkas_belum_ada.join(", ")}. ` : "";
  const catatan = await Dialog.isian(
    `Pendaftar diberi waktu 2×24 jam untuk mengunggah ulang. Tulis apa yang perlu diperbaiki — catatan ini dikirim ke pendaftar.`,
    { multiline: true, nilai: belum, placeholder: "Contoh: Foto KK buram, mohon unggah ulang yang jelas.", wajib: true },
    { judul: `Kurang Lengkap — ${a ? a.nama : ""}`, jenis: "peringatan", tombolOk: "Kirim ke pendaftar" }
  );
  if (catatan === null) return;
  await verifikasi(pendaftarId, "Kurang Lengkap", catatan);
}

async function tolakBerkas(pendaftarId) {
  const a = antreanData.find((x) => x.pendaftar_id === pendaftarId);
  const ya = await Dialog.konfirmasi(
    `Berkas ${a ? `${a.nama} (${a.nomor})` : ""} ditolak di sekolah ini, dan pendaftaran otomatis dialihkan ke pilihan berikutnya. Tindakan ini tidak bisa dibatalkan.\n\nJika berkas hanya perlu diperbaiki, gunakan "Kurang" agar pendaftar diberi waktu revisi.`,
    { judul: "Tolak berkas?", jenis: "bahaya", bahaya: true, tombolOk: "Ya, tolak" }
  );
  if (ya) await verifikasi(pendaftarId, "Ditolak");
}

// Nilai rapor isian pendaftar, dan tanda bila sudah dikoreksi panitia
function infoNilai(a) {
  if (a.nilai_rapor == null) return "";
  const dikoreksi = a.nilai_rapor_dikoreksi_oleh
    ? `<br/><span style="font-size:11px;color:#3730a3">✎ dikoreksi dari ${esc(a.nilai_rapor_awal ?? "-")}</span>`
    : "";
  return `<br/><span style="font-size:11.5px;color:var(--muted)">Rapor: ${esc(a.nilai_rapor)}</span>${dikoreksi}`;
}

async function koreksiNilai(pendaftarId) {
  const a = antreanData.find((x) => x.pendaftar_id === pendaftarId);
  if (!a) return;
  const input = await Dialog.isian(
    `Nilai saat ini: ${a.nilai_rapor ?? "belum diisi"}${a.nilai_rapor_awal != null && a.nilai_rapor_dikoreksi_oleh ? ` (isian awal pendaftar: ${a.nilai_rapor_awal})` : ""}\nCocokkan dengan berkas rapor, lalu masukkan nilai yang benar (0–100). Pendaftar akan diberi notifikasi.`,
    { tipe: "number", nilai: a.nilai_rapor ?? "", min: 0, max: 100, step: 0.01, wajib: true },
    { judul: `Koreksi Nilai — ${a.nama} (${a.nomor})` }
  );
  if (input === null) return;

  const res = await fetch(`/api/pendaftar/${pendaftarId}/nilai-rapor`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nilaiRapor: Number(input.replace(",", ".")) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    await renderPanitiaView();
    await Dialog.galat(data.error || "Gagal mengoreksi nilai.");
    return;
  }
  await renderPanitiaView();
  Dialog.toast(`Nilai rapor ${a.nama} diperbarui (${data.pilihanDiperbarui} pilihan Prestasi ikut diperbarui). Pendaftar sudah diberi notifikasi.`);
}

// Jarak rumah–sekolah untuk jalur zonasi, merah bila di luar radius
function infoJarak(a) {
  if (a.syarat_radius_km == null) return "";
  if (a.jarak_km == null) {
    return `<br/><span style="font-size:11.5px;color:#b91c1c">${ikon("peringatan")} ${esc(a.catatan_skor || "Lokasi tidak tersedia")}</span>`;
  }
  const diLuar = Number(a.jarak_km) > Number(a.syarat_radius_km);
  return `<br/><span style="font-size:11.5px;color:${diLuar ? "#b91c1c" : "#047857"}">${ikon("lokasi")} ${Number(a.jarak_km).toFixed(2)} km / radius ${a.syarat_radius_km} km${diLuar ? " — di luar radius" : ""}</span>`;
}

/* =========================================================
   VERIFIKASI LOKASI RUMAH (peta)
   ========================================================= */
function bukaLokasi(pendaftarId) {
  const a = antreanData.find((x) => x.pendaftar_id === pendaftarId);
  if (!a) return;
  const sekolah = sekolahList.find((s) => s.id === sesi.panitia.sekolahId);
  const adaRumah = a.latitude != null && a.longitude != null;
  const adaSekolah = sekolah?.latitude != null && sekolah?.longitude != null;

  const akurasi = a.akurasi_lokasi_m;
  const akurasiHTML = akurasi == null ? "-"
    : `± ${akurasi} m${akurasi > 100 ? ' <span style="color:#b45309">' + ikon("peringatan") + ' kurang akurat</span>' : ""}`;
  const jarakHTML = a.jarak_km != null
    ? `${Number(a.jarak_km).toFixed(2)} km${a.syarat_radius_km != null ? ` (radius ${a.syarat_radius_km} km)` : ""}`
    : "-";
  const gmaps = adaRumah ? `https://www.google.com/maps?q=${a.latitude},${a.longitude}` : null;
  const rute = adaRumah && adaSekolah
    ? `https://www.google.com/maps/dir/?api=1&origin=${a.latitude},${a.longitude}&destination=${sekolah.latitude},${sekolah.longitude}`
    : null;

  document.getElementById("lokasi-judul").innerText = `Lokasi Rumah — ${a.nama} (${a.nomor})`;
  document.getElementById("lokasi-info").innerHTML = `
    <div class="li-full"><div class="li-label">Alamat (diisi pendaftar, cocokkan dengan KK)</div>${esc(a.alamat) || '<span style="color:var(--muted)">Tidak diisi</span>'}</div>
    <div><div class="li-label">Koordinat GPS</div>${adaRumah ? `${Number(a.latitude).toFixed(6)}, ${Number(a.longitude).toFixed(6)}` : '<span style="color:#b91c1c">Lokasi tidak tersedia</span>'}</div>
    <div><div class="li-label">Akurasi GPS</div>${akurasiHTML}</div>
    <div class="li-full"><div class="li-label">Cek otomatis alamat vs GPS</div>${
      a.catatan_validasi_alamat
        ? `<span style="color:#b45309">${ikon("peringatan")} ${esc(a.catatan_validasi_alamat)}</span>`
        : a.alamat_latitude != null
          ? `<span style="color:#047857">✓ Alamat cocok dengan titik GPS (ketepatan pencarian: level ${esc(a.alamat_presisi)})</span>`
          : '<span style="color:var(--muted)">Belum dicek</span>'
    }</div>
    <div><div class="li-label">Jarak garis lurus ke ${esc(sekolah?.nama)}</div>${jarakHTML}</div>
    <div><div class="li-label">Buka di peta lain</div>
      ${gmaps ? `<a href="${gmaps}" target="_blank" rel="noopener">Google Maps</a>` : "-"}
      ${rute ? ` · <a href="${rute}" target="_blank" rel="noopener">Rute ke sekolah</a>` : ""}
    </div>
  `;

  document.getElementById("modal-lokasi").style.display = "flex";

  const petaEl = document.getElementById("lokasi-peta");
  if (petaLokasi) { petaLokasi.remove(); petaLokasi = null; }
  if (!window.L || (!adaRumah && !adaSekolah)) {
    petaEl.innerHTML = `<p style="padding:20px;color:var(--muted)">${window.L ? "Tidak ada koordinat untuk ditampilkan." : "Peta gagal dimuat (periksa koneksi internet)."}</p>`;
    return;
  }
  petaEl.innerHTML = "";
  petaLokasi = L.map(petaEl);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "&copy; OpenStreetMap",
  }).addTo(petaLokasi);

  const titik = [];
  if (adaSekolah) {
    const pos = [Number(sekolah.latitude), Number(sekolah.longitude)];
    L.circleMarker(pos, { radius: 9, color: "#b67a22", fillColor: "#C98A2C", fillOpacity: 1 })
      .addTo(petaLokasi).bindTooltip(sekolah.nama, { permanent: true, direction: "top" });
    if (a.syarat_radius_km != null) {
      L.circle(pos, { radius: Number(a.syarat_radius_km) * 1000, color: "#C98A2C", weight: 2, dashArray: "6 6", fillOpacity: 0.05 }).addTo(petaLokasi);
    }
    titik.push(pos);
  }
  if (adaRumah) {
    const pos = [Number(a.latitude), Number(a.longitude)];
    L.circleMarker(pos, { radius: 9, color: "#1e40af", fillColor: "#3b82f6", fillOpacity: 1 })
      .addTo(petaLokasi).bindTooltip("Rumah pendaftar", { permanent: true, direction: "top" });
    if (akurasi) L.circle(pos, { radius: Number(akurasi), color: "#3b82f6", weight: 1, fillOpacity: 0.12 }).addTo(petaLokasi);
    titik.push(pos);
  }
  if (titik.length === 2) L.polyline(titik, { color: "#1B3358", weight: 2, dashArray: "4 6" }).addTo(petaLokasi);

  // Titik hasil pencarian alamat (tidak ikut garis jarak zonasi)
  const semuaTitik = [...titik];
  if (a.alamat_latitude != null && a.alamat_longitude != null) {
    const pos = [Number(a.alamat_latitude), Number(a.alamat_longitude)];
    L.circleMarker(pos, { radius: 8, color: "#047857", fillColor: "#10b981", fillOpacity: 1 })
      .addTo(petaLokasi).bindTooltip(`Alamat (level ${esc(a.alamat_presisi)})`, { permanent: true, direction: "bottom" });
    semuaTitik.push(pos);
  }

  if (semuaTitik.length > 1) petaLokasi.fitBounds(semuaTitik, { padding: [50, 50] });
  else petaLokasi.setView(semuaTitik[0], 15);
  setTimeout(() => petaLokasi && petaLokasi.invalidateSize(), 50);
}

function tutupLokasi() {
  document.getElementById("modal-lokasi").style.display = "none";
}
document.getElementById("modal-lokasi").addEventListener("click", (e) => {
  if (e.target.id === "modal-lokasi") tutupLokasi();
});
// Esc: tutup peta dulu (kalau terbuka), baru panel detail
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (document.getElementById("modal-lokasi").style.display === "flex") tutupLokasi();
  else tutupDetail();
});

const PESAN_VERIFIKASI = {
  "Lengkap": "ditandai Lengkap — siap diseleksi",
  "Kurang Lengkap": "ditandai Kurang Lengkap — pendaftar diberi waktu revisi 2×24 jam",
  "Ditolak": "ditolak dan dialihkan ke pilihan berikutnya",
};

async function verifikasi(pendaftarId, status, catatan = null) {
  const a = antreanData.find((x) => x.pendaftar_id === pendaftarId);
  const res = await fetch(`/api/pendaftar/${pendaftarId}/berkas`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, catatan }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    await renderPanitiaView(); // data di layar mungkin sudah berubah (mis. pendaftar sudah dialihkan)
    await Dialog.galat(data.error || "Gagal memverifikasi.");
    return;
  }
  tutupDetail(); // pendaftar ini selesai diperiksa -- kembali ke daftar antrean
  await renderPanitiaView();
  Dialog.toast(`${a ? a.nama : "Berkas"} ${PESAN_VERIFIKASI[status]}.`, status === "Lengkap" ? "sukses" : "peringatan");
}

async function jalankanSeleksi(jalurId, btn) {
  const ya = await Dialog.konfirmasi(
    "Semua pendaftar di jalur ini yang berkasnya sudah Lengkap akan diperingkat dan diputuskan (diterima / dialihkan ke pilihan berikutnya). Hasil seleksi tidak bisa dibatalkan.",
    { judul: "Jalankan seleksi?", tombolOk: "Jalankan seleksi" }
  );
  if (!ya) return;
  if (btn) {
    btn.disabled = true;
    btn.dataset.originalText = btn.innerText;
    btn.innerText = "Memproses...";
  }
  try {
    const res = await fetch(`/api/jalur/${jalurId}/jalankan-seleksi`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      await Dialog.galat(data.error || "Seleksi gagal dijalankan.", { judul: "Seleksi belum bisa dijalankan" });
      return;
    }
    await renderPanitiaView();
    if (data.jumlahDiproses === 0) {
      await Dialog.info("Seleksi hanya memproses pendaftar yang berkasnya sudah diverifikasi \"Lengkap\". Verifikasi berkas di tabel antrean terlebih dahulu.", { judul: "Belum ada kandidat siap diseleksi", jenis: "peringatan" });
    } else {
      const n = (x) => Number(x) || 0;
      await Dialog.buka({
        judul: "Seleksi selesai",
        jenis: "sukses",
        html: `
          <p>${n(data.jumlahDiproses)} kandidat diproses. Sisa kuota sebelum seleksi: <strong>${n(data.sisaKuotaSebelum)}</strong> dari ${n(data.kuota)} kursi.</p>
          <div class="dlg-angka">
            <div><strong style="color:#047857">${n(data.diterima)}</strong><span>Diterima</span></div>
            <div><strong style="color:#b91c1c">${n(data.ditolakSyarat)}</strong><span>Tidak memenuhi syarat</span></div>
            <div><strong style="color:#b45309">${n(data.ditolakKuota)}</strong><span>Tidak masuk kuota</span></div>
          </div>
          <p class="muted" style="font-size:12.5px;margin:0">Pendaftar yang ditolak otomatis dialihkan ke pilihan sekolah berikutnya.</p>`,
      });
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = btn.dataset.originalText;
    }
  }
}

init();
