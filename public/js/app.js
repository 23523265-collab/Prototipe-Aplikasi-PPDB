let sekolahList = [];
let jalurList = [];
let pendaftarList = [];

const sekolahNama = (id) => sekolahList.find((s) => s.id === id)?.nama ?? "-";
const jalurById = (id) => jalurList.find((j) => j.id === id);
const jalurNamaFor = (id) => jalurById(id)?.nama ?? "-";

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
  if (view === "panitia") renderPanitia();
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

// ---------- Load base data ----------
async function loadData() {
  sekolahList = await fetch("/api/sekolah").then((r) => r.json());
  jalurList = await fetch("/api/jalur").then((r) => r.json());
  pendaftarList = await fetch("/api/pendaftar").then((r) => r.json());

  populateSekolahSelects();
  populatePanitiaSelect();
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

function populatePanitiaSelect() {
  const sel = document.getElementById("select-panitia-sekolah");
  sel.innerHTML = sekolahList.map((s) => `<option value="${s.id}">Masuk sebagai panitia: ${s.nama}</option>`).join("");
  sel.addEventListener("change", renderPanitia);
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

// ---------- Pendaftaran ----------
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
    tanggalLahir: form.tanggalLahir.value,
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
    box.className = "alert alert-success";
    box.style.display = "block";
    box.innerText = `Pendaftaran berhasil! Nomor pendaftaran kamu: ${data.nomor}. Sistem akan memproses Pilihan 1 terlebih dahulu.`;
    form.reset();
    document.querySelectorAll(".select-jalur").forEach((s) => (s.innerHTML = ""));
    await loadData();
  } else {
    box.className = "alert alert-error";
    box.style.display = "block";
    box.innerText = data.error || "Terjadi kesalahan, coba lagi.";
  }
});

// ---------- Cek Status ----------
document.getElementById("btn-cek-status").addEventListener("click", async () => {
  const nomor = document.getElementById("input-cek-nomor").value.trim().toUpperCase();
  const container = document.getElementById("status-result");
  const res = await fetch(`/api/pendaftar/nomor/${nomor}`);
  if (!res.ok) {
    container.innerHTML = `<p style="color:#b91c1c;font-size:14px">Nomor pendaftaran tidak ditemukan.</p>`;
    return;
  }
  const { pendaftar, pilihan, riwayat, notifikasi } = await res.json();

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
    <h3 class="sub-heading" style="margin-top:0">Riwayat Notifikasi</h3>
    <ul class="timeline">${notifItems || '<li class="timeline-item">Belum ada notifikasi.</li>'}</ul>
  `;
});

// ---------- Panitia ----------
async function renderPanitia() {
  const sekolahId = document.getElementById("select-panitia-sekolah").value;
  if (!sekolahId) return;

  const antrean = await fetch(`/api/sekolah/${sekolahId}/antrean`).then((r) => r.json());
  const tbody = document.querySelector("#table-panitia tbody");
  tbody.innerHTML = antrean.length
    ? antrean.map((a) => `
        <tr>
          <td>${a.nomor}</td>
          <td><strong>${a.nama}</strong></td>
          <td>${a.prioritas_aktif}</td>
          <td>${a.jalur_nama}</td>
          <td>${a.skor}</td>
          <td>${pillHTML(a.status_berkas)}</td>
          <td>
            <button class="action-btn action-lengkap" onclick="verifikasi(${a.pendaftar_id}, 'Lengkap')">Lengkap</button>
            <button class="action-btn action-kurang" onclick="verifikasi(${a.pendaftar_id}, 'Kurang Lengkap')">Kurang</button>
            <button class="action-btn action-tolak" onclick="verifikasi(${a.pendaftar_id}, 'Ditolak')">Tolak</button>
          </td>
        </tr>
      `).join("")
    : `<tr><td colspan="7" style="text-align:center;color:var(--muted)">Belum ada pendaftar aktif di sekolah ini.</td></tr>`;

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
  await fetch(`/api/pendaftar/${pendaftarId}/berkas`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  await loadData();
  await renderPanitia();
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
    await renderPanitia();
    alert(`Seleksi dijalankan. ${data.jumlahDiproses} pendaftar diproses pada jalur ini.`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = btn.dataset.originalText;
    }
  }
}

// ---------- Pengumuman ----------
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
