let sekolahList = [];
let jalurList = [];
let pendaftarList = [];
let sesi = { pendaftar: null };
let pendaftarBaruId = null; // dipakai sesaat setelah daftar, untuk upload berkas

// Escape teks sebelum dimasukkan ke HTML (mencegah XSS dari data yang diisi pendaftar)
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Hanya izinkan link http(s), supaya URL "javascript:..." tidak bisa disisipkan
const safeUrl = (u) => (/^https?:\/\//i.test(String(u ?? "")) ? esc(u) : "#");

const formatWaktuWIB = (d) =>
  new Date(d).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) + " WIB";

const sekolahNama = (id) => sekolahList.find((s) => s.id === id)?.nama ?? "-";

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
  if (view === "daftar") cekTahapanPendaftaran();
  if (view === "status") renderStatusView();
  if (view === "pengumuman") renderPengumuman();
}

function pillHTML(status) {
  const map = {
    "Lengkap": ["pill-green", "✓"],
    "Menunggu Verifikasi": ["pill-amber", "⏱"],
    "Menunggu Verifikasi Berkas": ["pill-amber", "⏱"],
    "Menunggu Seleksi": ["pill-amber", "⏱"],
    "Menunggu Giliran": ["pill-gray", "—"],
    "Kurang Lengkap": ["pill-orange", "⚠"],
    "Ditolak": ["pill-red", "✕"],
    "Diterima": ["pill-green", "✓"],
    "Dibatalkan": ["pill-gray", "—"],
    "Aktif": ["pill-amber", "⏱"],
    "Diterima Final": ["pill-green", "✓"],
    "Tidak Diterima Final": ["pill-red", "✕"],
  };
  const [cls, icon] = map[status] || ["pill-gray", "—"];
  return `<span class="pill ${cls}">${icon} ${esc(status)}</span>`;
}

// ---------- Sesi login ----------
async function muatSesi() {
  const data = await fetch("/api/auth/me").then((r) => r.json());
  sesi = { pendaftar: data.pendaftar };
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

// Form pendaftaran disembunyikan saat panitia menutup pendaftaran (tahapan seleksi)
async function cekTahapanPendaftaran() {
  const t = await fetch("/api/tahapan").then((r) => r.json()).catch(() => ({ dibuka: true }));
  document.getElementById("daftar-tutup").style.display = t.dibuka ? "none" : "block";
  document.getElementById("form-daftar").style.display = t.dibuka ? "" : "none";
}

// Keterangan asal skor: di Zonasi skor hanya konversi jarak (100 − 10 × km), yang menentukan tetap jaraknya
function asalSkor(p) {
  const jalur = jalurList.find((j) => j.id === p.jalur_id);
  if (jalur?.syarat_radius_km != null || p.jarak_km != null) {
    return p.jarak_km != null ? `dari jarak ${Number(p.jarak_km).toFixed(1)} km` : "jarak tidak tersedia";
  }
  if (jalur?.syarat_nilai_minimum != null) return "nilai rapor";
  return "";
}

function jalurOptionsForSekolah(sekolahId) {
  return jalurList.filter((j) => j.sekolah_id === Number(sekolahId));
}

function populateSekolahSelects() {
  document.querySelectorAll(".select-sekolah").forEach((sel) => {
    sel.innerHTML = `<option value="">-- Pilih Sekolah --</option>` +
      sekolahList.map((s) => `<option value="${s.id}">${esc(s.nama)}${labelJarakSekolah(s)}</option>`).join("");
    sel.onchange = () => isiJalur(sel);
  });
}

function isiJalur(sel) {
  const idx = sel.dataset.index;
  const jalurSel = document.querySelector(`.select-jalur[data-index="${idx}"]`);
  const sekolah = sekolahList.find((x) => x.id === Number(sel.value));
  const jarak = sekolah ? jarakKeSekolah(sekolah) : null;
  const opts = jalurOptionsForSekolah(sel.value);
  jalurSel.innerHTML = opts.map((j) => {
    let info = "";
    if (j.syarat_radius_km && jarak != null) info = jarak <= Number(j.syarat_radius_km) ? " — ✓ masuk radius" : " — ✕ di luar radius";
    return `<option value="${j.id}">${esc(j.nama)} (kuota ${j.kuota}${j.syarat_nilai_minimum ? ", min. nilai " + j.syarat_nilai_minimum : ""}${j.syarat_radius_km ? ", radius " + j.syarat_radius_km + " km" : ""})${info}</option>`;
  }).join("");
}

/* ---------- Cek jarak ke sekolah (sebelum mendaftar) ---------- */
let lokasiTerakhir = null; // { latitude, longitude, akurasi, waktu }

// Rumus Haversine -- sama dengan zonasi.js di server
function hitungJarakKm(lat1, lng1, lat2, lng2) {
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

function jarakKeSekolah(sekolah) {
  if (!lokasiTerakhir || sekolah.latitude == null || sekolah.longitude == null) return null;
  return hitungJarakKm(lokasiTerakhir.latitude, lokasiTerakhir.longitude, Number(sekolah.latitude), Number(sekolah.longitude));
}

function radiusZonasi(sekolahId) {
  return jalurList.find((j) => j.sekolah_id === sekolahId && j.syarat_radius_km)?.syarat_radius_km ?? null;
}

function labelJarakSekolah(sekolah) {
  const jarak = jarakKeSekolah(sekolah);
  if (jarak == null) return "";
  const radius = radiusZonasi(sekolah.id);
  const tanda = radius == null ? "" : jarak <= Number(radius) ? " ✓" : " ✕";
  return ` — ${jarak.toFixed(1)} km${tanda}`;
}

document.getElementById("btn-cek-jarak").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const info = document.getElementById("jarak-info");
  btn.disabled = true;
  btn.innerText = "Mengambil lokasi...";
  const lokasi = await ambilLokasi(true);
  btn.disabled = false;
  btn.innerText = "📍 Perbarui lokasi";
  if (!lokasi) {
    info.innerHTML = `<span style="color:#b91c1c">${pesanGagalLokasi()}</span>`;
    return;
  }

  // Simpan pilihan yang sudah dipilih, isi ulang dropdown dengan label jarak
  const terpilih = [...document.querySelectorAll(".select-sekolah")].map((sel) => [sel.value, document.querySelector(`.select-jalur[data-index="${sel.dataset.index}"]`).value]);
  populateSekolahSelects();
  document.querySelectorAll(".select-sekolah").forEach((sel, i) => {
    sel.value = terpilih[i][0];
    if (sel.value) { isiJalur(sel); document.querySelector(`.select-jalur[data-index="${i}"]`).value = terpilih[i][1]; }
  });

  const urut = sekolahList
    .map((s) => ({ s, jarak: jarakKeSekolah(s), radius: radiusZonasi(s.id) }))
    .filter((x) => x.jarak != null)
    .sort((a, b) => a.jarak - b.jarak);
  const masuk = urut.filter((x) => x.radius != null && x.jarak <= Number(x.radius));
  info.innerHTML = `Akurasi GPS ± ${Math.round(lokasi.akurasi)} m. ` +
    (masuk.length
      ? `<strong style="color:#047857">${masuk.length} sekolah masuk radius zonasi:</strong> ${masuk.map((x) => `${esc(x.s.nama)} (${x.jarak.toFixed(1)} km)`).join(", ")}.`
      : '<strong style="color:#b91c1c">Tidak ada sekolah dalam radius zonasi dari lokasimu.</strong>') +
    ` Terdekat berikutnya: ${urut.filter((x) => !masuk.includes(x)).slice(0, 2).map((x) => `${esc(x.s.nama)} (${x.jarak.toFixed(1)} km)`).join(", ") || "-"}. Tanda ✓/✕ di pilihan sekolah menunjukkan masuk/tidak radius zonasi.`;
});

// ---------- Beranda ----------
function renderBeranda() {
  const totalAktif = pendaftarList.filter((p) => p.status_global === "Aktif").length;
  const totalDiterima = pendaftarList.filter((p) => p.status_global === "Diterima Final").length;
  const totalTidakDiterima = pendaftarList.filter((p) => p.status_global === "Tidak Diterima Final").length;
  document.getElementById("stat-grid").innerHTML = `
    <div class="stat-card"><span class="stat-ico">👥</span><div class="stat-num">${pendaftarList.length}</div><div class="stat-label">Total pendaftar</div></div>
    <div class="stat-card"><span class="stat-ico">⏱</span><div class="stat-num" style="color:var(--amber)">${totalAktif}</div><div class="stat-label">Masih diproses (aktif)</div></div>
    <div class="stat-card"><span class="stat-ico">✅</span><div class="stat-num" style="color:#047857">${totalDiterima}</div><div class="stat-label">Diterima</div></div>
    <div class="stat-card"><span class="stat-ico">✕</span><div class="stat-num" style="color:#b91c1c">${totalTidakDiterima}</div><div class="stat-label">Tidak diterima (habis pilihan)</div></div>
  `;
}

/* =========================================================
   PENDAFTARAN + UPLOAD BERKAS
   ========================================================= */
let sedangMengirim = false; // cegah pendaftaran ganda akibat tombol terklik dua kali

document.getElementById("form-daftar").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (sedangMengirim) return;
  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const box = document.getElementById("daftar-success");

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

  // Kunci tombol SEKETIKA saat diklik, dan tunjukkan progres -- tombol baru aktif lagi kalau gagal
  sedangMengirim = true;
  submitBtn.disabled = true;
  box.style.display = "none";
  const setProgres = (teks) => { submitBtn.innerHTML = `<span class="spinner"></span>${teks}`; };

  try {
    setProgres("Mengambil lokasi…");
    const lokasi = await ambilLokasi();

    const pilihZonasi = pilihan.some((p) => jalurList.find((j) => j.id === p.jalurId)?.syarat_radius_km);
    if (!lokasi && pilihZonasi) {
      alert("Lokasi tidak tersedia (izin ditolak atau browser tidak mendukung). Pendaftaran tetap dikirim, tetapi skor zonasi tidak bisa dihitung — pilihan jalur Zonasi akan diberi skor 0 dengan catatan \"lokasi tidak tersedia\".");
    }

    setProgres("Menyimpan pendaftaran…");
    const body = {
      nama: form.nama.value,
      nik: form.nik.value,
      email: form.email.value,
      tanggalLahir: form.tanggalLahir.value,
      password: form.password.value,
      nilaiRapor: form.nilaiRapor.value === "" ? null : Number(form.nilaiRapor.value),
      alamat: form.alamat.value,
      akurasiLokasi: lokasi ? lokasi.akurasi : null,
      latitude: lokasi ? lokasi.latitude : null,
      longitude: lokasi ? lokasi.longitude : null,
      pilihan,
    };
    const res = await fetch("/api/pendaftar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Terjadi kesalahan, coba lagi.");

    pendaftarBaruId = data.id;
    document.getElementById("daftar-form-wrap").style.display = "none";
    document.getElementById("daftar-upload-wrap").style.display = "block";
    document.getElementById("upload-nomor").innerText = data.nomor;
    renderUploadList("upload-list", "baru", pendaftarBaruId);
    window.scrollTo({ top: 0, behavior: "smooth" });
    loadData(); // perbarui statistik beranda di belakang layar, tidak perlu ditunggu
  } catch (err) {
    box.className = "alert alert-error";
    box.style.display = "block";
    box.innerText = err.message;
    box.scrollIntoView({ behavior: "smooth", block: "center" });
    sedangMengirim = false;
    submitBtn.disabled = false;
    submitBtn.innerText = "Kirim Pendaftaran";
  }
});

// Minta koordinat GPS dari browser; null kalau ditolak, gagal, atau tidak didukung
function ambilLokasi(paksaBaru = false) {
  if (!paksaBaru && lokasiTerakhir && Date.now() - lokasiTerakhir.waktu < 10 * 60 * 1000) {
    return Promise.resolve(lokasiTerakhir);
  }
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      galatLokasi = "tidak-didukung";
      return resolve(null);
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        galatLokasi = null;
        lokasiTerakhir = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, akurasi: pos.coords.accuracy, waktu: Date.now() };
        resolve(lokasiTerakhir);
      },
      (err) => {
        galatLokasi = err.code === 1 ? "ditolak" : err.code === 3 ? "timeout" : "tidak-tersedia";
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  });
}

// Penyebab lokasi gagal terakhir, supaya pesan ke pengguna bisa menjelaskan cara memperbaikinya
let galatLokasi = null;

function pesanGagalLokasi() {
  const iPhone = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const android = /Android/i.test(navigator.userAgent);
  if (galatLokasi === "ditolak") {
    if (iPhone) {
      return "Akses lokasi ditolak. Di iPhone: buka <strong>Pengaturan → Privasi & Keamanan → Layanan Lokasi</strong> → pastikan <strong>aktif</strong>, lalu pilih <strong>Situs Web Safari</strong> (atau Chrome) → <strong>Saat Menggunakan App</strong>. " +
        "Setelah itu ketuk ikon <strong>ᴀA</strong> di kolom alamat Safari → <strong>Pengaturan Situs Web → Lokasi → Izinkan</strong>, muat ulang halaman, dan coba lagi.";
    }
    if (android) {
      return "Akses lokasi ditolak. Aktifkan <strong>Lokasi</strong> di panel notifikasi HP, lalu ketuk ikon <strong>🔒/⚙</strong> di kiri alamat situs → <strong>Izin → Lokasi → Izinkan</strong>, muat ulang halaman, dan coba lagi.";
    }
    return "Akses lokasi ditolak. Klik ikon <strong>🔒</strong> di kiri alamat situs → <strong>Location → Allow</strong>, muat ulang halaman, dan coba lagi.";
  }
  if (galatLokasi === "timeout") return "Lokasi terlalu lama didapat. Pastikan GPS/Lokasi aktif (lebih cepat di luar ruangan), lalu coba lagi.";
  if (galatLokasi === "tidak-didukung") return "Browser ini tidak mendukung lokasi. Coba buka di Safari atau Chrome.";
  return "Lokasi tidak dapat ditentukan. Pastikan GPS/Lokasi di HP aktif, lalu coba lagi.";
}

const JENIS_DOKUMEN = ["Kartu Keluarga", "Akta Kelahiran", "Rapor Terakhir"];

/**
 * Daftar unggah berkas. Dipakai sesaat setelah mendaftar dan di halaman Cek Status.
 * prefix membedakan id elemen di dua tempat itu; onSelesai dipanggil setelah upload berhasil.
 */
const uploadCtx = {};
function renderUploadList(containerId, prefix, pendaftarId, dokumen = [], { terkunci = null, onSelesai = null } = {}) {
  uploadCtx[prefix] = { pendaftarId, onSelesai };
  const container = document.getElementById(containerId);
  container.innerHTML = JENIS_DOKUMEN.map((jenis, i) => {
    const ada = dokumen.find((d) => d.jenis === jenis);
    const statusHTML = ada
      ? `<span style="color:#047857">✓ ${ada.url ? `<a href="${safeUrl(ada.url)}" target="_blank" rel="noopener">${esc(ada.nama_file)}</a>` : esc(ada.nama_file)}</span>`
      : "Belum diunggah";
    return `
    <div class="upload-item">
      <div class="upload-info">
        <strong>${esc(jenis)}</strong>
        <div class="upload-status" id="${prefix}-status-${i}">${statusHTML}</div>
      </div>
      <div>${terkunci
        ? `<span style="font-size:12px;color:var(--muted)">🔒 ${esc(terkunci)}</span>`
        : `<input type="file" id="${prefix}-file-${i}" accept=".pdf,.jpg,.jpeg,.png" style="display:none" onchange="unggahBerkas('${prefix}', ${i})" />
           <button class="btn btn-outline" onclick="document.getElementById('${prefix}-file-${i}').click()">${ada ? "Ganti" : "Pilih File"}</button>`}
      </div>
    </div>`;
  }).join("");
}

async function unggahBerkas(prefix, idx) {
  const { pendaftarId, onSelesai } = uploadCtx[prefix];
  const jenis = JENIS_DOKUMEN[idx];
  const input = document.getElementById(`${prefix}-file-${idx}`);
  const file = input.files[0];
  if (!file) return;
  const statusEl = document.getElementById(`${prefix}-status-${idx}`);
  if (file.size > 5 * 1024 * 1024) {
    statusEl.innerHTML = `<span style="color:#b91c1c">Ukuran file maksimal 5MB.</span>`;
    input.value = "";
    return;
  }
  statusEl.innerText = "Mengunggah...";

  const formData = new FormData();
  formData.append("file", file);
  formData.append("jenis", jenis);

  const res = await fetch(`/api/pendaftar/${pendaftarId}/dokumen`, { method: "POST", body: formData });
  const data = await res.json().catch(() => ({}));
  input.value = "";
  if (res.ok) {
    statusEl.innerHTML = `<span style="color:#047857">✓ ${esc(file.name)}</span>`;
    if (onSelesai) onSelesai();
  } else {
    statusEl.innerHTML = `<span style="color:#b91c1c">${esc(data.error || "Gagal mengunggah")}</span>`;
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

/* ---------- Lupa password ---------- */
document.getElementById("btn-lupa-password").addEventListener("click", () => {
  const wrap = document.getElementById("lupa-wrap");
  wrap.style.display = wrap.style.display === "none" ? "block" : "none";
});

document.getElementById("form-lupa-password").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector("button[type=submit]");
  const info = document.getElementById("lupa-info");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Mengirim…';
  try {
    const res = await fetch("/api/auth/lupa-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nomor: form.nomor.value, email: form.email.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Gagal mengirim link.");
    info.className = "alert alert-success";
    info.innerText = data.pesan;
    form.reset();
  } catch (err) {
    info.className = "alert alert-error";
    info.innerText = err instanceof TypeError ? "Tidak dapat terhubung ke server. Periksa koneksi internet." : err.message;
  } finally {
    info.style.display = "block";
    btn.disabled = false;
    btn.innerText = "Kirim Link";
  }
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

  let terkunci = null;
  if (pendaftar.status_global !== "Aktif") terkunci = "Pendaftaran selesai";
  else if (pendaftar.status_berkas === "Lengkap") terkunci = "Sudah diverifikasi";

  let statusBanner = "";
  if (pendaftar.status_global === "Diterima Final") {
    statusBanner = `<div class="badge-final-accept">Diterima di ${esc(sekolahNama(pendaftar.sekolah_aktif_id))}</div>`;
  } else if (pendaftar.status_global === "Tidak Diterima Final") {
    statusBanner = `<div class="badge-final-reject">Tidak diterima di seluruh pilihan sekolah</div>`;
  } else if (pendaftar.status_berkas === "Kurang Lengkap") {
    statusBanner = `<div class="alert alert-error" style="background:#fff7ed;color:#c2410c;border-color:#fed7aa">
      <strong>⚠ Berkas Anda Kurang Lengkap</strong> di ${esc(sekolahNama(pendaftar.sekolah_aktif_id))}.
      ${pendaftar.catatan_revisi ? `<br/>Catatan panitia: <em>${esc(pendaftar.catatan_revisi)}</em>` : ""}
      ${pendaftar.batas_revisi_at ? `<br/>Unggah ulang berkas di bagian <strong>Berkas Pendaftaran</strong> di bawah paling lambat <strong>${esc(formatWaktuWIB(pendaftar.batas_revisi_at))}</strong>. Jika lewat batas waktu, pendaftaran otomatis dialihkan ke pilihan berikutnya.` : ""}
    </div>`;
  } else {
    statusBanner = `<div class="alert alert-success" style="background:#fffbeb;color:#b45309;border-color:#fde68a">Sedang diproses di Pilihan ${pendaftar.prioritas_aktif}: <strong>${esc(sekolahNama(pendaftar.sekolah_aktif_id))}</strong> · Status berkas: ${esc(pendaftar.status_berkas)}</div>`;
  }

  const pilihanRows = pilihan.map((p) => `
    <tr>
      <td>Pilihan ${p.urutan_prioritas}</td>
      <td>${esc(p.sekolah_nama)}</td>
      <td>${esc(p.jalur_nama)}${p.jarak_km != null
        ? `<br/><span style="font-size:11.5px;color:var(--muted)">📍 ${Number(p.jarak_km).toFixed(1)} km dari sekolah</span>`
        : p.catatan_skor ? `<br/><span style="font-size:11.5px;color:#b45309">⚠ ${esc(p.catatan_skor)}</span>` : ""}</td>
      <td>${p.skor}<br/><span style="font-size:11px;color:var(--muted)">${asalSkor(p)}</span></td>
      <td>${pillHTML(p.status)}${p.alasan_penolakan ? `<br/><span style="font-size:11px;color:var(--muted)">${esc(p.alasan_penolakan)}</span>` : ""}</td>
    </tr>
  `).join("");

  const notifItems = notifikasi.map((n) => `<li class="timeline-item"><div class="t-title">${esc(n.isi_pesan)}</div><div class="t-meta">${esc(n.waktu)}</div></li>`).join("");

  container.innerHTML = `
    <div class="table-wrap" style="padding:18px;margin-bottom:16px">
      <div style="margin-bottom:14px">
        <strong>${esc(pendaftar.nama)}</strong><br/>
        <span style="color:var(--muted);font-size:13px">${esc(pendaftar.nomor)}</span>
      </div>
      ${statusBanner}
    </div>
    <div class="table-wrap" style="margin-bottom:16px">
      <table>
        <thead><tr><th>Prioritas</th><th>Sekolah</th><th>Jalur</th><th>Skor</th><th>Status</th></tr></thead>
        <tbody>${pilihanRows}</tbody>
      </table>
    </div>
    <h3 class="sub-heading" style="margin-top:0">Berkas Pendaftaran</h3>
    <p class="muted" style="margin:-4px 0 10px;font-size:12.5px">PDF/JPG/PNG, maks 5MB. Berkas dapat diganti selama belum diverifikasi Lengkap oleh panitia.</p>
    <div id="status-upload-list"></div>
    <h3 class="sub-heading">Riwayat Notifikasi</h3>
    <ul class="timeline">${notifItems || '<li class="timeline-item">Belum ada notifikasi.</li>'}</ul>
  `;

  renderUploadList("status-upload-list", "status", pendaftar.id, dokumen || [], {
    terkunci,
    onSelesai: () => renderStatusView(),
  });
}

/* =========================================================
   PENGUMUMAN
   ========================================================= */
function renderPengumuman() {
  const container = document.getElementById("pengumuman-container");
  container.innerHTML = `
    <p class="muted" style="font-size:12.5px">🔒 Nama disamarkan untuk melindungi data pribadi pendaftar. Cari hasilmu berdasarkan <strong>nomor pendaftaran</strong>, atau login di menu Cek Status untuk detail lengkap.</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Nomor</th><th>Nama</th><th>Posisi Saat Ini</th><th>Status Akhir</th></tr></thead>
        <tbody>
          ${pendaftarList.map((p) => `
            <tr>
              <td>${esc(p.nomor)}</td>
              <td><strong>${esc(p.nama_samaran)}</strong></td>
              <td>${esc(p.sekolah_aktif_nama || "-")} ${p.status_global === "Aktif" ? `(Pilihan ${p.prioritas_aktif})` : ""}</td>
              <td>${pillHTML(p.status_global)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

loadData();


// Kalender tanggal lahir hanya menawarkan rentang usia yang valid (12–21 tahun per 1 Juli tahun ini)
(function aturBatasTanggalLahir() {
  const input = document.querySelector("input[name=tanggalLahir]");
  if (!input) return;
  const tahun = new Date().getFullYear();
  input.min = `${tahun - 22}-07-02`; // usia maksimal 21 tahun per 1 Juli
  input.max = `${tahun - 12}-07-01`; // usia minimal 12 tahun per 1 Juli
  input.title = "Usia calon siswa SMA: 12–21 tahun per 1 Juli " + tahun;
})();
