let sekolahList = [];
let jalurList = [];
let pendaftarList = [];
let sesi = { pendaftar: null, panitia: null };
let pendaftarBaruId = null; // dipakai sesaat setelah daftar, untuk upload berkas

const sekolahNama = (id) => sekolahList.find((s) => s.id === id)?.nama ?? "-";
const jalurById = (id) => jalurList.find((j) => j.id === id);

// ---------- Navigation ----------
document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});
document.querySelectorAll("[data-goto]").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.goto));
});

function showView(view) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(`view-${view}`).classList.add("active");
  document.querySelectorAll(".nav-item[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  if (view === "beranda") renderBeranda();
  if (view === "panitia") renderPanitiaView();
  if (view === "status") renderStatusView();
  if (view === "pengumuman") renderPengumuman();
}

function pillHTML(status) {
  const map = {
    "Lengkap": ["pill-green", "\u2713"],
    "Menunggu Verifikasi": ["pill-amber", "\u23f1"],
    "Menunggu Verifikasi Berkas": ["pill-amber", "\u23f1"],
    "Menunggu Seleksi": ["pill-amber", "\u23f1"],
    "Menunggu Giliran": ["pill-gray", "\u2014"],
    "Kurang Lengkap": ["pill-orange", "\u26a0"],
    "Ditolak": ["pill-red", "\u2715"],
    "Diterima": ["pill-green", "\u2713"],
    "Dibatalkan": ["pill-gray", "\u2014"],
    "Aktif": ["pill-amber", "\u23f1"],
    "Diterima Final": ["pill-green", "\u2713"],
    "Tidak Diterima Final": ["pill-red", "\u2715"],
  };
  const [cls, icon] = map[status] || ["pill-gray", "\u2014"];
  return `<span class="pill ${cls}">${icon} ${status}</span>`;
}

// ---------- Sesi login ----------
async function muatSesi() {
  sesi = await fetch("/api/auth/me").then((r) => r.json());
}

// ---------- Load base data ----------
async function loadData() {
  await muatSesi();
  sekolahList = await fetch("/api/sekolah").then((r) => r.json());
  jalurList = await fetch("/api/jalur").then((r) => r.json());
  pendaftarList = await fetch("/api/pendaftar").then((r) => r.json());

  populateSekolahSelects();
  renderBeranda();
}

function jalurOptionsForSekolah(sekolahId) {
  return jalurList.filter((j) => j.sekolah_id === Number(sekolahId));
}

function populateSekolahSelects() {
  document.querySelectorAll(".select-sekolah").forEach((sel) => {
    sel.innerHTML = `<option value="">-- Pilih Sekolah --</option>` +
      sekolahList.map((s) => `<option value="${s.id}">${s.nama}</option>`).join("");
    sel.addEventListener("change", () => {
      const idx = sel.dataset.index;
      const jalurSel = document.querySelector(`.select-jalur[data-index="${idx}"]`);
      const opts = jalurOptionsForSekolah(sel.value);
      jalurSel.innerHTML = opts.map((j) => `<option value="${j.id}">${j.nama} (kuota ${j.kuota}${j.syarat_nilai_minimum ? ", min. nilai " + j.syarat_nilai_minimum : ""})</option>`).join("");
    });
  });
}

// ---------- Beranda ----------
function renderBeranda() {
  const totalAktif = pendaftarList.filter((p) => p.status_global === "Aktif").length;
  const totalDiterima = pendaftarList.filter((p) => p.status_global === "Diterima Final").length;
  const totalTidakDiterima = pendaftarList.filter((p) => p.status_global === "Tidak Diterima Final").length;
  document.getElementById("stat-grid").innerHTML = `
    <div class="stat-card"><div class="stat-num">${pendaftarList.length}</div><div class="stat-label">Total pendaftar</div></div>
    <div class="stat-card"><div class="stat-num" style="color:var(--amber)">${totalAktif}</div><div class="stat-label">Masih diproses (aktif)</div></div>
    <div class="stat-card"><div class="stat-num" style="color:#047857">${totalDiterima}</div><div class="stat-label">Diterima</div></div>
    <div class="stat-card"><div class="stat-num" style="color:#b91c1c">${totalTidakDiterima}</div><div class="stat-label">Tidak diterima (habis pilihan)</div></div>
  `;
}

/* =========================================================
   PENDAFTARAN + UPLOAD BERKAS
   ========================================================= */
document.getElementById("form-daftar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const pilihan = [];
  for (let i = 0; i < 3; i++) {
    const sekolahId = form.querySelector(`.select-sekolah[data-index="${i}"]`).value;
    const jalurId = form.querySelector(`.select-jalur[data-index="${i}"]`).value;
    if (sekolahId && jalurId) pilihan.push({ sekolahId: Number(sekolahId), jalurId: Number(jalurId) });
  }
  if (pilihan.length === 0) {
    alert("Isi minimal Pilihan 1.");
    return;
  }
  const body = {
    nama: form.nama.value,
    nik: form.nik.value,
    email: form.email.value,
    tanggalLahir: form.tanggalLahir.value,
    password: form.password.value,
    pilihan,
  };
  const res = await fetch("/api/pendaftar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  const box = document.getElementById("daftar-success");
  if (res.ok) {
    pendaftarBaruId = data.id;
    document.getElementById("daftar-form-wrap").style.display = "none";
    document.getElementById("daftar-upload-wrap").style.display = "block";
    document.getElementById("upload-nomor").innerText = data.nomor;
    renderUploadList();
    await loadData();
  } else {
    box.className = "alert alert-error";
    box.style.display = "block";
    box.innerText = data.error || "Terjadi kesalahan, coba lagi.";
  }
});

function renderUploadList() {
  const jenisList = ["Kartu Keluarga", "Akta Kelahiran", "Rapor Terakhir"];
  const container = document.getElementById("upload-list");
  container.innerHTML = jenisList.map((jenis, i) => `
    <div class="upload-item">
      <div class="upload-info">
        <strong>${jenis}</strong>
        <div class="upload-status" id="upload-status-${i}">Belum diunggah</div>
      </div>
      <div>
        <input type="file" id="upload-file-${i}" accept=".pdf,.jpg,.jpeg,.png" style="display:none" onchange="unggahBerkas(${i}, '${jenis}')" />
        <button class="btn btn-outline" onclick="document.getElementById('upload-file-${i}').click()">Pilih File</button>
      </div>
    </div>
  `).join("");
}

async function unggahBerkas(idx, jenis) {
  const input = document.getElementById(`upload-file-${idx}`);
  const file = input.files[0];
  if (!file) return;
  const statusEl = document.getElementById(`upload-status-${idx}`);
  statusEl.innerText = "Mengunggah...";

  const formData = new FormData();
  formData.append("file", file);
  formData.append("jenis", jenis);

  const res = await fetch(`/api/pendaftar/${pendaftarBaruId}/dokumen`, { method: "POST", body: formData });
  const data = await res.json();
  if (res.ok) {
    statusEl.innerHTML = `<span style="color:#047857">\u2713 ${file.name}</span>`;
  } else {
    statusEl.innerHTML = `<span style="color:#b91c1c">${data.error || "Gagal mengunggah"}</span>`;
  }
}

/* =========================================================
   LOGIN & CEK STATUS PENDAFTAR
   ========================================================= */
document.getElementById("form-login-pendaftar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const errBox = document.getElementById("status-login-error");
  const res = await fetch("/api/auth/pendaftar/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nomor: form.nomor.value, password: form.password.value }),
  });
  const data = await res.json();
  if (!res.ok) {
    errBox.style.display = "block";
    errBox.innerText = data.error;
    return;
  }
  errBox.style.display = "none";
  await muatSesi();
  await renderStatusView();
});

document.getElementById("btn-logout-pendaftar").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  await muatSesi();
  renderStatusView();
});

async function renderStatusView() {
  await muatSesi();
  const loggedIn = !!sesi.pendaftar;
  document.getElementById("status-login-wrap").style.display = loggedIn ? "none" : "block";
  document.getElementById("status-view-wrap").style.display = loggedIn ? "block" : "none";
  if (!loggedIn) return;

  const container = document.getElementById("status-result");
  const res = await fetch(`/api/pendaftar/nomor/${sesi.pendaftar.nomor}`);
  if (!res.ok) {
    container.innerHTML = `<p style="color:#b91c1c;font-size:14px">Gagal memuat data.</p>`;
    return;
  }
  const { pendaftar, pilihan, riwayat, notifikasi, dokumen } = await res.json();

  let statusBanner = "";
  if (pendaftar.status_global === "Diterima Final") {
    statusBanner = `<div class="badge-final-accept">Diterima di ${sekolahNama(pendaftar.sekolah_aktif_id)}</div>`;
  } else if (pendaftar.status_global === "Tidak Diterima Final") {
    statusBanner = `<div class="badge-final-reject">Tidak diterima di seluruh pilihan sekolah</div>`;
  } else {
    statusBanner = `<div class="alert alert-success" style="background:#fffbeb;color:#b45309;border-color:#fde68a">Sedang diproses di Pilihan ${pendaftar.prioritas_aktif}: <strong>${sekolahNama(pendaftar.sekolah_aktif_id)}</strong> · Status berkas: ${pendaftar.status_berkas}</div>`;
  }

  const pilihanRows = pilihan.map((p) => `
    <tr>
      <td>Pilihan ${p.urutan_prioritas}</td>
      <td>${p.sekolah_nama}</td>
      <td>${p.jalur_nama}</td>
      <td>${p.skor}</td>
      <td>${pillHTML(p.status)}${p.alasan_penolakan ? `<br/><span style="font-size:11px;color:var(--muted)">${p.alasan_penolakan}</span>` : ""}</td>
    </tr>
  `).join("");

  const dokumenRows = (dokumen || []).length
    ? dokumen.map((d) => `<li class="timeline-item"><a href="${d.url}" target="_blank" rel="noopener">${d.jenis} — ${d.nama_file}</a></li>`).join("")
    : `<li class="timeline-item" style="color:var(--muted)">Belum ada berkas diunggah.</li>`;

  const notifItems = notifikasi.map((n) => `<li class="timeline-item"><div class="t-title">${n.isi_pesan}</div><div class="t-meta">${n.waktu}</div></li>`).join("");

  container.innerHTML = `
    <div class="table-wrap" style="padding:18px;margin-bottom:16px">
      <div style="margin-bottom:14px">
        <strong>${pendaftar.nama}</strong><br/>
        <span style="color:var(--muted);font-size:13px">${pendaftar.nomor}</span>
      </div>
      ${statusBanner}
    </div>
    <div class="table-wrap" style="margin-bottom:16px">
      <table>
        <thead><tr><th>Prioritas</th><th>Sekolah</th><th>Jalur</th><th>Skor</th><th>Status</th></tr></thead>
        <tbody>${pilihanRows}</tbody>
      </table>
    </div>
    <h3 class="sub-heading" style="margin-top:0">Berkas Terunggah</h3>
    <ul class="timeline">${dokumenRows}</ul>
    <h3 class="sub-heading">Riwayat Notifikasi</h3>
    <ul class="timeline">${notifItems || '<li class="timeline-item">Belum ada notifikasi.</li>'}</ul>
  `;
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
  await muatSesi();
  await renderPanitiaView();
});

document.getElementById("btn-logout-panitia").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  await muatSesi();
  renderPanitiaView();
});

async function renderPanitiaView() {
  await muatSesi();
  const loggedIn = !!sesi.panitia;
  document.getElementById("panitia-login-wrap").style.display = loggedIn ? "none" : "block";
  document.getElementById("panitia-view-wrap").style.display = loggedIn ? "block" : "none";
  if (!loggedIn) return;

  document.getElementById("panitia-nama-label").innerText = `${sesi.panitia.nama} · ${sekolahNama(sesi.panitia.sekolahId)}`;

  const sekolahId = sesi.panitia.sekolahId;
  const antrean = await fetch(`/api/sekolah/${sekolahId}/antrean`).then((r) => r.json());
  const tbody = document.querySelector("#table-panitia tbody");
  tbody.innerHTML = antrean.length
    ? antrean.map((a) => {
        const peringatan = [];
        if (a.catatan_validasi_nik) peringatan.push(`NIK: ${a.catatan_validasi_nik}`);
        (a.dokumen || []).forEach((d) => {
          if (d.catatan_validasi) peringatan.push(`${d.jenis}: ${d.catatan_validasi}`);
        });
        const peringatanHTML = peringatan.length
          ? `<ul style="margin:0;padding-left:16px;font-size:11.5px;color:#b45309">${peringatan.map((x) => `<li>${x}</li>`).join("")}</ul>`
          : '<span style="font-size:12px;color:#047857">✓ Tidak ada</span>';
        return `
        <tr>
          <td>${a.nomor}</td>
          <td><strong>${a.nama}</strong></td>
          <td>${a.prioritas_aktif}</td>
          <td>${a.jalur_nama}</td>
          <td>${a.skor}</td>
          <td>${pillHTML(a.status_berkas)}</td>
          <td>${(a.dokumen || []).length ? a.dokumen.map((d) => `<a href="${d.url}" target="_blank" rel="noopener" style="font-size:12px">${d.jenis}</a>`).join("<br/>") : '<span style="font-size:12px;color:var(--muted)">Belum ada</span>'}</td>
          <td>${peringatanHTML}</td>
          <td>
            <button class="action-btn action-lengkap" onclick="verifikasi(${a.pendaftar_id}, 'Lengkap')">Lengkap</button>
            <button class="action-btn action-kurang" onclick="verifikasi(${a.pendaftar_id}, 'Kurang Lengkap')">Kurang</button>
            <button class="action-btn action-tolak" onclick="verifikasi(${a.pendaftar_id}, 'Ditolak')">Tolak</button>
          </td>
        </tr>
      `;
      }).join("")
    : `<tr><td colspan="8" style="text-align:center;color:var(--muted)">Belum ada pendaftar aktif di sekolah ini.</td></tr>`;

  const jalurSekolah = jalurList.filter((j) => j.sekolah_id === Number(sekolahId));
  const container = document.getElementById("jalur-seleksi-container");
  container.innerHTML = jalurSekolah.map((j) => `
    <div class="jalur-mini-card">
      <strong>${j.nama}</strong> · kuota ${j.kuota}${j.syarat_nilai_minimum ? `, min. nilai ${j.syarat_nilai_minimum}` : ""}
      <br/>
      <button class="btn btn-accent" style="margin-top:8px;padding:6px 12px;font-size:13px" onclick="jalankanSeleksi(${j.id}, this)">Jalankan Seleksi</button>
    </div>
  `).join("");
}

async function verifikasi(pendaftarId, status) {
  const res = await fetch(`/api/pendaftar/${pendaftarId}/berkas`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const data = await res.json();
    alert(data.error || "Gagal memverifikasi.");
    return;
  }
  await loadData();
  await renderPanitiaView();
}

async function jalankanSeleksi(jalurId, btn) {
  if (btn) {
    btn.disabled = true;
    btn.dataset.originalText = btn.innerText;
    btn.innerText = "Memproses...";
  }
  try {
    const res = await fetch(`/api/jalur/${jalurId}/jalankan-seleksi`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Seleksi gagal dijalankan.");
      return;
    }
    await loadData();
    await renderPanitiaView();
    alert(`Seleksi dijalankan. ${data.jumlahDiproses} pendaftar diproses pada jalur ini.`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = btn.dataset.originalText;
    }
  }
}

/* =========================================================
   PENGUMUMAN
   ========================================================= */
function renderPengumuman() {
  const container = document.getElementById("pengumuman-container");
  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Nomor</th><th>Nama</th><th>Posisi Saat Ini</th><th>Status Akhir</th></tr></thead>
        <tbody>
          ${pendaftarList.map((p) => `
            <tr>
              <td>${p.nomor}</td>
              <td><strong>${p.nama}</strong></td>
              <td>${p.sekolah_aktif_nama || "-"} ${p.status_global === "Aktif" ? `(Pilihan ${p.prioritas_aktif})` : ""}</td>
              <td>${pillHTML(p.status_global)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

loadData();
