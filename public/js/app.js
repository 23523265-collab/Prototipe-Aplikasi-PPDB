let sekolahList = [];
let jalurList = [];
let pendaftarList = [];
let sesi = { pendaftar: null };
let pendaftarBaruId = null; // dipakai sesaat setelah daftar, untuk upload berkas

// Escape teks sebelum dimasukkan ke HTML (mencegah XSS dari data yang diisi pendaftar)
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Hanya izinkan link http(s), supaya URL "javascript:..." tidak bisa disisipkan
const safeUrl = (u) => (/^https?:\/\//i.test(String(u ?? "")) ? esc(u) : "#");

// Kolom timestamp tanpa zona waktu dari database berisi UTC tapi tanpa akhiran "Z" -- tambahkan supaya tidak dibaca sebagai jam lokal
const formatWaktuWIB = (d) =>
  new Date(typeof d === "string" && !/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? d + "Z" : d).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) + " WIB";

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
  btn.innerHTML = `${ikon("lokasi")} Perbarui lokasi`;
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
    <div class="stat-card"><span class="stat-ico">${ikon("orang")}</span><div class="stat-num">${pendaftarList.length}</div><div class="stat-label">Total pendaftar</div></div>
    <div class="stat-card"><span class="stat-ico">${ikon("jam")}</span><div class="stat-num" style="color:var(--amber)">${totalAktif}</div><div class="stat-label">Masih diproses (aktif)</div></div>
    <div class="stat-card"><span class="stat-ico">${ikon("diterima")}</span><div class="stat-num" style="color:#047857">${totalDiterima}</div><div class="stat-label">Diterima</div></div>
    <div class="stat-card"><span class="stat-ico">${ikon("ditolak")}</span><div class="stat-num" style="color:#b91c1c">${totalTidakDiterima}</div><div class="stat-label">Tidak diterima (habis pilihan)</div></div>
  `;
  renderJalurBeranda();
  renderTahapanBeranda(totalDiterima + totalTidakDiterima > 0);
}

/** Tahapan PPDB mengikuti status buka/tutup yang diatur Admin Dinas (tanpa tanggal karangan). */
async function renderTahapanBeranda(adaHasil) {
  const t = await fetch("/api/tahapan").then((r) => r.json()).catch(() => ({ dibuka: true }));
  const tahap = [
    { judul: "Pendaftaran & unggah berkas", ket: "Isi formulir, pilih hingga 3 sekolah, lalu unggah KK, akta kelahiran, dan rapor.",
      status: t.dibuka ? "berjalan" : "selesai", label: t.dibuka ? "Dibuka sekarang" : "Ditutup" },
    { judul: "Verifikasi berkas", ket: "Panitia sekolah memeriksa berkas. Jika kurang lengkap, pendaftar diberi waktu revisi 2×24 jam.",
      status: t.dibuka ? "berjalan" : "selesai", label: t.dibuka ? "Berlangsung" : "Selesai" },
    { judul: "Seleksi per jalur", ket: "Dijalankan setelah pendaftaran ditutup, supaya semua pendaftar dibandingkan secara adil.",
      status: t.dibuka ? "" : adaHasil ? "selesai" : "berjalan", label: t.dibuka ? "Setelah pendaftaran ditutup" : adaHasil ? "Sudah berjalan" : "Berlangsung" },
    { judul: "Pengumuman & auto-transfer", ket: "Hasil tampil di menu Pengumuman dan dikirim ke email. Yang tidak lolos otomatis dialihkan ke pilihan berikutnya.",
      status: !t.dibuka && adaHasil ? "berjalan" : "", label: !t.dibuka && adaHasil ? "Hasil mulai diumumkan" : "Setelah seleksi" },
  ];
  document.getElementById("beranda-tahapan").innerHTML = tahap.map((x, i) => `
    <li class="jadwal-item ${x.status}">
      <span class="jadwal-no">${x.status === "selesai" ? ikon("centang") : i + 1}</span>
      <div>
        <div class="jadwal-atas"><strong>${x.judul}</strong><span class="jadwal-label">${x.label}</span></div>
        <p>${x.ket}</p>
      </div>
    </li>`).join("");
}

function renderJalurBeranda() {
  const unik = (arr) => [...new Set(arr.filter((x) => x != null).map(Number))].sort((a, b) => a - b);
  const radius = unik(jalurList.map((j) => j.syarat_radius_km));
  const nilaiMin = unik(jalurList.map((j) => j.syarat_nilai_minimum));
  const teksRadius = radius.length ? radius.join(" atau ") + " km" : "-";
  document.getElementById("beranda-jalur").innerHTML = `
    <div class="jalur-info">
      <div class="jalur-info-kepala"><span class="stat-ico">${ikon("lokasi")}</span><div><strong>Zonasi</strong><span>Berdasarkan jarak rumah</span></div></div>
      <ul>
        <li>Syarat: jarak rumah ke sekolah <strong>≤ radius zonasi</strong> (${teksRadius}; Kota Yogyakarta lebih kecil dari Sleman).</li>
        <li>Jarak dihitung otomatis dari lokasi GPS saat mendaftar, dicocokkan panitia dengan alamat di KK.</li>
        <li>Peringkat: <strong>jarak terdekat</strong> diterima lebih dulu.</li>
      </ul>
    </div>
    <div class="jalur-info">
      <div class="jalur-info-kepala"><span class="stat-ico">${ikon("piala")}</span><div><strong>Prestasi</strong><span>Berdasarkan nilai rapor</span></div></div>
      <ul>
        <li>Syarat: rata-rata nilai rapor <strong>≥ ${nilaiMin.length ? nilaiMin.join(" / ") : "-"}</strong>.</li>
        <li>Nilai diisi saat mendaftar dan dicocokkan panitia dengan berkas rapor.</li>
        <li>Peringkat: <strong>nilai tertinggi</strong> diterima lebih dulu.</li>
      </ul>
    </div>
    <p class="muted" style="grid-column:1/-1;font-size:12.5px;margin:0">Jika jarak atau nilai sama, <strong>usia lebih tua</strong> didahulukan, lalu yang <strong>mendaftar lebih awal</strong>. Gunakan tombol <em>Cek jarak saya ke sekolah</em> di formulir untuk melihat sekolah mana yang masuk radius.</p>`;
}

/* =========================================================
   PENDAFTARAN + UPLOAD BERKAS
   ========================================================= */
let sedangMengirim = false; // cegah pendaftaran ganda akibat tombol terklik dua kali

/* ---------- Formulir bertahap: Data Diri → Alamat & Lokasi → Pilihan Sekolah → Akun & Kirim ---------- */
const formDaftar = document.getElementById("form-daftar");
const JUMLAH_LANGKAH = 4;
let langkahAktif = 0;

function pilihanTerisi() {
  const pilihan = [];
  for (let i = 0; i < 3; i++) {
    const sekolahId = formDaftar.querySelector(`.select-sekolah[data-index="${i}"]`).value;
    const jalurId = formDaftar.querySelector(`.select-jalur[data-index="${i}"]`).value;
    if (sekolahId && jalurId) pilihan.push({ sekolahId: Number(sekolahId), jalurId: Number(jalurId) });
  }
  return pilihan;
}

function tampilkanLangkah(n) {
  langkahAktif = n;
  formDaftar.querySelectorAll(".langkah").forEach((f) => f.classList.toggle("aktif", Number(f.dataset.langkah) === n));
  document.querySelectorAll("#stepper li").forEach((li) => {
    const i = Number(li.dataset.langkah);
    li.classList.toggle("aktif", i === n);
    li.classList.toggle("selesai", i < n);
  });
  document.getElementById("btn-langkah-kembali").style.display = n === 0 ? "none" : "";
  const lanjut = document.getElementById("btn-langkah-lanjut");
  if (!sedangMengirim) lanjut.innerText = n === JUMLAH_LANGKAH - 1 ? "Kirim Pendaftaran" : "Lanjut →";
  if (n === JUMLAH_LANGKAH - 1) renderRingkasan();
}

/** Periksa isian di satu langkah; tampilkan pesan di isian pertama yang salah. */
function periksaLangkah(n) {
  const fieldset = formDaftar.querySelector(`.langkah[data-langkah="${n}"]`);
  const salah = [...fieldset.querySelectorAll("input, textarea, select")].find((el) => !el.checkValidity());
  if (salah) {
    tampilkanLangkah(n);
    salah.reportValidity();
    return false;
  }
  if (n === 2) {
    const pilihan = pilihanTerisi();
    if (!pilihan.length) {
      Dialog.info("Pilih minimal satu sekolah dan jalurnya di Pilihan 1.", { judul: "Pilihan sekolah kosong", jenis: "peringatan" });
      return false;
    }
    const pakaiPrestasi = pilihan.some((p) => jalurList.find((j) => j.id === p.jalurId)?.syarat_nilai_minimum != null);
    if (pakaiPrestasi && formDaftar.nilaiRapor.value === "") {
      formDaftar.nilaiRapor.setCustomValidity("Nilai rapor wajib diisi karena memilih jalur Prestasi.");
      formDaftar.nilaiRapor.reportValidity();
      formDaftar.nilaiRapor.addEventListener("input", () => formDaftar.nilaiRapor.setCustomValidity(""), { once: true });
      return false;
    }
  }
  if (n === 3 && formDaftar.password.value !== formDaftar.password2.value) {
    formDaftar.password2.setCustomValidity("Password tidak sama dengan isian sebelumnya.");
    formDaftar.password2.reportValidity();
    formDaftar.password2.addEventListener("input", () => formDaftar.password2.setCustomValidity(""), { once: true });
    return false;
  }
  return true;
}

function renderRingkasan() {
  const f = formDaftar;
  const tgl = f.tanggalLahir.value ? new Date(f.tanggalLahir.value + "T00:00:00").toLocaleDateString("id-ID", { dateStyle: "long" }) : "-";
  const pilihanHTML = pilihanTerisi().map((p, i) => {
    const jalur = jalurList.find((j) => j.id === p.jalurId);
    return `${i + 1}. ${esc(sekolahNama(p.sekolahId))} — ${esc(jalur?.nama || "")}`;
  }).join("<br/>");
  document.getElementById("ringkasan-daftar").innerHTML = `
    <dl>
      <dt>Nama</dt><dd>${esc(f.nama.value)}</dd>
      <dt>NIK</dt><dd>${esc(f.nik.value)}</dd>
      <dt>Tanggal lahir</dt><dd>${esc(tgl)}</dd>
      <dt>Alamat</dt><dd>${esc(f.alamat.value)}</dd>
      <dt>Lokasi GPS</dt><dd>${lokasiTerakhir ? `✓ sudah diambil (± ${Math.round(lokasiTerakhir.akurasi)} m)` : "akan diminta saat mengirim"}</dd>
      ${f.nilaiRapor.value !== "" ? `<dt>Nilai rapor</dt><dd>${esc(f.nilaiRapor.value)}</dd>` : ""}
      <dt>Pilihan</dt><dd>${pilihanHTML}</dd>
    </dl>
    <p class="muted" style="margin:10px 0 0;font-size:12px">Periksa kembali sebelum mengirim. Klik langkah di atas untuk mengubah.</p>`;
}

document.getElementById("btn-langkah-kembali").addEventListener("click", () => {
  if (langkahAktif > 0 && !sedangMengirim) tampilkanLangkah(langkahAktif - 1);
});
document.querySelectorAll("#stepper li").forEach((li) => {
  li.addEventListener("click", () => {
    const tujuan = Number(li.dataset.langkah);
    if (tujuan < langkahAktif && !sedangMengirim) tampilkanLangkah(tujuan);
  });
});
tampilkanLangkah(0);

formDaftar.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (sedangMengirim) return;
  // Belum di langkah terakhir: tombol (atau Enter) berarti "Lanjut"
  if (langkahAktif < JUMLAH_LANGKAH - 1) {
    if (periksaLangkah(langkahAktif)) {
      tampilkanLangkah(langkahAktif + 1);
      formDaftar.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    return;
  }
  for (let n = 0; n < JUMLAH_LANGKAH; n++) if (!periksaLangkah(n)) return;

  const form = e.target;
  const submitBtn = document.getElementById("btn-langkah-lanjut");
  const box = document.getElementById("daftar-success");
  const pilihan = pilihanTerisi();

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
      const lanjut = await Dialog.konfirmasi(
        `Lokasi tidak tersedia. ${pesanGagalLokasi().replace(/<[^>]+>/g, "")}\n\nJika tetap dikirim, jarak zonasi tidak bisa dihitung — pilihan jalur Zonasi diberi skor 0 dengan catatan "lokasi tidak tersedia".`,
        { judul: "Kirim tanpa lokasi?", jenis: "peringatan", tombolOk: "Tetap kirim", tombolBatal: "Coba lagi nanti" }
      );
      if (!lanjut) throw new Error("Pendaftaran belum dikirim. Aktifkan lokasi, lalu klik Kirim Pendaftaran lagi.");
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
    berkasBaru.clear();
    renderProgresBaru();
    renderUploadList("upload-list", "baru", pendaftarBaruId, [], {
      onSelesai: (jenis) => { berkasBaru.add(jenis); renderProgresBaru(); },
    });
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
 * Pelacak progres 5 tahap: Daftar → Berkas → Verifikasi → Seleksi → Hasil.
 * Supaya pendaftar selalu tahu posisinya dan apa yang harus dilakukan berikutnya.
 */
function renderProgres(pendaftar, jumlahBerkas) {
  const final = pendaftar.status_global !== "Aktif";
  const lengkap = pendaftar.status_berkas === "Lengkap";
  const kurang = pendaftar.status_berkas === "Kurang Lengkap";
  const berkasPenuh = jumlahBerkas >= JENIS_DOKUMEN.length;
  const diPilihan = pendaftar.prioritas_aktif > 1 ? ` (Pilihan ${pendaftar.prioritas_aktif})` : "";

  const tahap = [
    { label: "Daftar", status: "selesai", ket: "Terdaftar" },
    final || berkasPenuh
      ? { label: "Unggah Berkas", status: "selesai", ket: `${Math.min(jumlahBerkas, 3)}/3 berkas` }
      : { label: "Unggah Berkas", status: "berjalan", ket: `${jumlahBerkas}/3 berkas` },
    final || lengkap ? { label: "Verifikasi", status: "selesai", ket: "Berkas lengkap" }
      : kurang ? { label: "Verifikasi", status: "masalah", ket: "Perlu revisi" }
      : berkasPenuh ? { label: "Verifikasi", status: "berjalan", ket: `Diperiksa panitia${diPilihan}` }
      : { label: "Verifikasi", status: "", ket: "Oleh panitia" },
    final ? { label: "Seleksi", status: "selesai", ket: "Selesai" }
      : lengkap ? { label: "Seleksi", status: "berjalan", ket: `Menunggu seleksi${diPilihan}` }
      : { label: "Seleksi", status: "", ket: "Zonasi / Prestasi" },
    pendaftar.status_global === "Diterima Final" ? { label: "Hasil", status: "selesai", ket: "Diterima ✓" }
      : pendaftar.status_global === "Tidak Diterima Final" ? { label: "Hasil", status: "gagal", ket: "Tidak diterima" }
      : { label: "Hasil", status: "", ket: "Pengumuman" },
  ];
  const ikon = { selesai: "✓", masalah: "!", gagal: "✕" };
  return `<div class="progres">${tahap.map((t, i) => `
    <div class="progres-item ${t.status}">
      <div class="progres-bulat">${ikon[t.status] || i + 1}</div>
      <div class="progres-label">${t.label}</div>
      <div class="progres-ket">${esc(t.ket)}</div>
    </div>`).join("")}</div>`;
}

// Berkas yang sudah diunggah di layar "Pendaftaran Berhasil" (sesaat setelah mendaftar)
const berkasBaru = new Set();
function renderProgresBaru() {
  document.getElementById("progres-baru").innerHTML = renderProgres(
    { status_global: "Aktif", status_berkas: "Menunggu Verifikasi", prioritas_aktif: 1 },
    berkasBaru.size
  );
}

document.getElementById("btn-selesai-unggah").addEventListener("click", async () => {
  const sisa = JENIS_DOKUMEN.length - berkasBaru.size;
  if (sisa > 0) {
    const lanjut = await Dialog.konfirmasi(
      `Masih ada ${sisa} berkas yang belum diunggah. Panitia baru bisa memverifikasi setelah ketiga berkas lengkap.\n\nAnda bisa melanjutkan unggah nanti dari menu Cek Status (login dengan nomor pendaftaran dan password).`,
      { judul: "Berkas belum lengkap", jenis: "peringatan", tombolOk: "Lanjutkan nanti", tombolBatal: "Unggah sekarang" }
    );
    if (!lanjut) return;
  }
  showView("status");
});

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
        ? `<span style="font-size:12px;color:var(--muted)">${ikon("gembok")} ${esc(terkunci)}</span>`
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
    Dialog.toast(`${jenis} berhasil diunggah.`);
    if (onSelesai) onSelesai(jenis);
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
  document.getElementById("status-result").innerHTML = ""; // jangan sisakan data pendaftar sebelumnya
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
  // Kerangka abu-abu selama data dimuat pertama kali (di Vercel bisa 1–2 detik)
  if (!container.innerHTML.trim()) {
    container.innerHTML = ["96px", "92px", "260px"].map((h) => `<div class="kerangka" style="height:${h};margin-bottom:16px"></div>`).join("");
  }
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
      <strong>${ikon("peringatan")} Berkas Anda Kurang Lengkap</strong> di ${esc(sekolahNama(pendaftar.sekolah_aktif_id))}.
      ${pendaftar.catatan_revisi ? `<br/>Catatan panitia: <em>${esc(pendaftar.catatan_revisi)}</em>` : ""}
      ${pendaftar.batas_revisi_at ? `<br/>Unggah ulang berkas di bagian <strong>Berkas Pendaftaran</strong> di bawah paling lambat <strong>${esc(formatWaktuWIB(pendaftar.batas_revisi_at))}</strong>. Jika lewat batas waktu, pendaftaran otomatis dialihkan ke pilihan berikutnya.` : ""}
    </div>`;
  } else {
    statusBanner = `<div class="alert alert-success" style="background:#fffbeb;color:#b45309;border-color:#fde68a">Sedang diproses di Pilihan ${pendaftar.prioritas_aktif}: <strong>${esc(sekolahNama(pendaftar.sekolah_aktif_id))}</strong> · Status berkas: ${esc(pendaftar.status_berkas)}</div>`;
  }

  // Perjalanan pilihan: Pilihan 1 → (dialihkan otomatis) → Pilihan 2 → ... -- inti konsep auto-transfer
  const perjalananHTML = pilihan.map((p) => {
    let kelas = "";
    let bulat = p.urutan_prioritas;
    if (p.status === "Diterima") { kelas = "diterima"; bulat = "✓"; }
    else if (p.status === "Ditolak") { kelas = "ditolak"; bulat = "✕"; }
    else if (p.status === "Menunggu Giliran") kelas = "menunggu";
    else if (p.status === "Dibatalkan") kelas = "batal";
    else if (pendaftar.status_global === "Aktif" && p.urutan_prioritas === pendaftar.prioritas_aktif) kelas = "aktif";

    const pengalihan = riwayat.find((r) => r.dari_sekolah_id === p.sekolah_id);
    const rinciJarak = p.jarak_km != null
      ? `<span>${ikon("lokasi")} <strong>${Number(p.jarak_km).toFixed(1)} km</strong> dari rumah</span>`
      : p.catatan_skor ? `<span style="color:#b45309">${ikon("peringatan")} ${esc(p.catatan_skor)}</span>` : "";
    return `
      <li class="pj-item ${kelas}">
        <div class="pj-garis"><div class="pj-bulat">${bulat}</div><div class="pj-batang"></div></div>
        <div class="pj-isi">
          <div class="pj-kartu">
            <div class="pj-atas">
              <div>
                <div class="pj-urutan">Pilihan ${p.urutan_prioritas}${p.urutan_prioritas === 1 ? " · utama" : ""}${kelas === "aktif" ? " · sedang diproses" : ""}</div>
                <div class="pj-sekolah">${esc(p.sekolah_nama)}</div>
              </div>
              ${pillHTML(p.status)}
            </div>
            <div class="pj-rinci">
              <span>Jalur <strong>${esc(p.jalur_nama)}</strong></span>
              ${rinciJarak}
              <span>Skor <strong>${p.skor}</strong> <span style="font-size:11px">(${asalSkor(p)})</span></span>
            </div>
            ${p.alasan_penolakan ? `<div class="pj-alasan">Alasan: ${esc(p.alasan_penolakan)}</div>` : ""}
          </div>
          ${pengalihan && pengalihan.ke_sekolah_id ? `<div class="pj-alih">↓ Dialihkan otomatis ke ${esc(pengalihan.ke_nama)} · ${esc(formatWaktuWIB(pengalihan.waktu))}</div>` : ""}
        </div>
      </li>`;
  }).join("");

  const notifItems = notifikasi.map((n) => `<li class="timeline-item"><div class="t-title">${esc(n.isi_pesan)}</div><div class="t-meta">${esc(formatWaktuWIB(n.waktu))}</div></li>`).join("");

  container.innerHTML = `
    <div class="table-wrap" style="padding:18px;margin-bottom:16px">
      <div style="margin-bottom:14px">
        <strong>${esc(pendaftar.nama)}</strong><br/>
        <span style="color:var(--muted);font-size:13px">${esc(pendaftar.nomor)}</span>
      </div>
      ${statusBanner}
    </div>
    ${renderProgres(pendaftar, (dokumen || []).length)}
    <h3 class="sub-heading" style="margin-top:4px">Perjalanan Pilihan Sekolah</h3>
    <ol class="perjalanan">${perjalananHTML}</ol>
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
const FILTER_PENGUMUMAN = [
  { kunci: "semua", label: "Semua", cocok: () => true },
  { kunci: "Aktif", label: "Masih diproses", cocok: (p) => p.status_global === "Aktif" },
  { kunci: "Diterima Final", label: "Diterima", cocok: (p) => p.status_global === "Diterima Final" },
  { kunci: "Tidak Diterima Final", label: "Tidak diterima", cocok: (p) => p.status_global === "Tidak Diterima Final" },
];
let filterPengumuman = "semua";

function pilihFilterPengumuman(kunci) {
  filterPengumuman = kunci;
  renderPengumuman();
}
document.getElementById("cari-pengumuman").addEventListener("input", () => renderPengumuman());
document.getElementById("filter-sekolah-pengumuman").addEventListener("change", () => renderPengumuman());

function renderPengumuman() {
  // Isi pilihan sekolah sekali (daftar sekolah sudah dimuat di loadData)
  const selSekolah = document.getElementById("filter-sekolah-pengumuman");
  if (selSekolah.options.length <= 1 && sekolahList.length) {
    selSekolah.innerHTML += sekolahList.map((s) => `<option value="${esc(s.nama)}">${esc(s.nama)}</option>`).join("");
  }

  const kata = document.getElementById("cari-pengumuman").value.trim().toLowerCase();
  const sekolah = selSekolah.value;
  const dasar = pendaftarList.filter((p) => (!sekolah || p.sekolah_aktif_nama === sekolah) &&
    (!kata || String(p.nomor).toLowerCase().includes(kata) || String(p.nama_samaran).toLowerCase().includes(kata)));

  document.getElementById("filter-status-pengumuman").innerHTML = FILTER_PENGUMUMAN.map((f) => `
    <button type="button" class="tab-item ${f.kunci === filterPengumuman ? "aktif" : ""}" onclick="pilihFilterPengumuman('${esc(f.kunci)}')">
      ${f.label} <span class="tab-jumlah">${dasar.filter(f.cocok).length}</span>
    </button>`).join("");

  const filter = FILTER_PENGUMUMAN.find((f) => f.kunci === filterPengumuman);
  const tampil = dasar.filter(filter.cocok);
  const nomorSaya = sesi.pendaftar?.nomor;

  document.getElementById("pengumuman-container").innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Nomor</th><th>Nama</th><th>Sekolah Saat Ini</th><th>Status Akhir</th></tr></thead>
        <tbody>
          ${tampil.length ? tampil.map((p) => `
            <tr class="${p.nomor === nomorSaya ? "baris-saya" : ""}">
              <td>${esc(p.nomor)}${p.nomor === nomorSaya ? ' <span class="tanda-saya">Anda</span>' : ""}</td>
              <td><strong>${esc(p.nama_samaran)}</strong></td>
              <td>${esc(p.sekolah_aktif_nama || "-")} ${p.status_global === "Aktif" ? `<span class="muted" style="font-size:12px;margin:0">(Pilihan ${p.prioritas_aktif})</span>` : ""}</td>
              <td>${pillHTML(p.status_global)}</td>
            </tr>`).join("")
          : `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:22px">${pendaftarList.length ? "Tidak ada pendaftar yang cocok dengan pencarian." : "Belum ada pendaftar."}</td></tr>`}
        </tbody>
      </table>
    </div>`;
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
