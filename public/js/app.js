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

// ---------- Efek tampilan ----------
const kurangiGerak = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
document.documentElement.classList.add("anim"); // CSS efek muncul hanya aktif kalau JS berjalan

// Bagian Beranda muncul halus saat masuk layar
(function pasangEfekMuncul() {
  const bagian = document.querySelectorAll("[data-muncul]");
  const tampilkan = (el) => {
    el.classList.add("tampak");
    setTimeout(() => el.classList.add("selesai"), 1200); // setelah itu hover kartu tanpa jeda
  };
  if (kurangiGerak || !("IntersectionObserver" in window)) return bagian.forEach(tampilkan);
  const pengamat = new IntersectionObserver((entri) => {
    entri.forEach((e) => {
      if (!e.isIntersecting) return;
      tampilkan(e.target);
      pengamat.unobserve(e.target);
    });
  }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 });
  bagian.forEach((el) => pengamat.observe(el));
})();

// Navbar mendapat bayangan setelah halaman digulir + garis progres gulir di bawah navbar
const garisProgres = document.getElementById("gulir-progres");
window.addEventListener("scroll", () => {
  document.querySelector(".topnav").classList.toggle("tergulir", window.scrollY > 8);
  const maks = document.documentElement.scrollHeight - window.innerHeight;
  garisProgres.style.transform = `scaleX(${maks > 0 ? Math.min(1, window.scrollY / maks) : 0})`;
}, { passive: true });

/* Menu "Masuk Staf": Panitia Sekolah / Dinas Pendidikan */
(function menuStaf() {
  const tombol = document.getElementById("btn-menu-staf");
  const isi = document.getElementById("daftar-menu-staf");
  if (!tombol || !isi) return;
  const item = () => [...isi.querySelectorAll("a")];
  const atur = (buka, fokusPertama = false) => {
    isi.hidden = !buka;
    tombol.setAttribute("aria-expanded", String(buka));
    tombol.parentElement.classList.toggle("buka", buka);
    if (buka && fokusPertama) item()[0].focus();
  };
  tombol.addEventListener("click", () => atur(isi.hidden));
  tombol.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); atur(true, true); } });
  isi.addEventListener("keydown", (e) => {
    const daftar = item(), i = daftar.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); daftar[(i + 1) % daftar.length].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); daftar[(i - 1 + daftar.length) % daftar.length].focus(); }
  });
  document.addEventListener("click", (e) => { if (!isi.hidden && !e.target.closest("#menu-staf")) atur(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !isi.hidden) { atur(false); tombol.focus(); } });
})();

/* Efek sentuh: riak (ripple) di titik yang ditekan + getaran halus di HP (jika didukung).
   Tanpa efek bila pengguna memilih "kurangi gerakan". */
const SASARAN_SENTUH = ".btn, .nav-item, .strip-cta, .sekolah-kartu, .jalur-info, .tab-filter button, .profil-jalur, .profil-sekolah-baris, .brand";
document.addEventListener("pointerdown", (e) => {
  const el = e.target.closest(SASARAN_SENTUH);
  if (!el || el.disabled || kurangiGerak || e.button > 0) return;
  const kotak = el.getBoundingClientRect();
  const ukuran = Math.max(kotak.width, kotak.height) * 2;
  const riak = document.createElement("span");
  riak.className = "riak";
  riak.style.cssText = `width:${ukuran}px;height:${ukuran}px;left:${e.clientX - kotak.left - ukuran / 2}px;top:${e.clientY - kotak.top - ukuran / 2}px`;
  el.classList.add("punya-riak");
  el.appendChild(riak);
  riak.addEventListener("animationend", () => riak.remove());
  if (e.pointerType === "touch" && navigator.vibrate) navigator.vibrate(8);
}, { passive: true });

/** Angka naik dari 0 ke nilai akhir (statistik Beranda) */
function hitungNaik(el) {
  const akhir = Number(el.dataset.angka) || 0;
  if (kurangiGerak || akhir === 0) { el.textContent = akhir; return; }
  const mulai = performance.now(), durasi = 900;
  const langkah = (t) => {
    const p = Math.min(1, (t - mulai) / durasi);
    el.textContent = Math.round(akhir * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(langkah);
  };
  requestAnimationFrame(langkah);
}

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
  window.scrollTo({ top: 0 }); // menu ada di atas: halaman baru selalu mulai dari atas
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
    "Tidak Daftar Ulang": ["pill-orange", "jam"],
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

/* Jalur SPMB 2026: jenis dari server (/api/jalur). Jalur dengan urut "jarak" butuh lokasi GPS. */
const JALUR_JARAK = ["domisili", "afirmasi", "mutasi"];
const DOKUMEN_DASAR = ["Kartu Keluarga", "Akta Kelahiran", "Rapor Terakhir"];
const jalurDariId = (id) => jalurList.find((j) => j.id === id);
const LABEL_JALUR = { domisili: "Domisili", afirmasi: "Afirmasi", mutasi: "Mutasi", prestasi_akademik: "Prestasi Akademik", prestasi_nonakademik: "Prestasi Nonakademik" };
// Berkas tambahan -> jalur yang mewajibkannya
const JALUR_BERKAS = { "Bukti Afirmasi": "afirmasi", "Surat Mutasi": "mutasi", "Sertifikat Prestasi": "prestasi_nonakademik" };
const KATEGORI_AFIRMASI = { kip: "Pemegang KIP", pkh: "Peserta PKH", dtks: "Terdaftar DTKS", disabilitas: "Penyandang disabilitas" };
const KATEGORI_MUTASI = { pindah_tugas: "Orang tua/wali pindah tugas", anak_gtk: "Anak guru/tenaga kependidikan" };

/**
 * Keterangan tiap berkas khusus: jalur & pilihan mana yang membutuhkannya.
 * daftarPilihan: [{ urutan, sekolah, jenis }]
 */
function keteranganBerkasKhusus(daftarPilihan) {
  const hasil = {};
  for (const [berkas, jenis] of Object.entries(JALUR_BERKAS)) {
    const dipakai = daftarPilihan.filter((p) => p.jenis === jenis);
    if (dipakai.length) {
      hasil[berkas] = `Jalur ${LABEL_JALUR[jenis]} · ${dipakai.map((p) => `Pilihan ${p.urutan} (${p.sekolah})`).join(", ")}`;
    }
  }
  return hasil;
}

// Keterangan asal skor: di jalur berbasis jarak skor hanya konversi jarak (100 − 10 × km), yang menentukan tetap jaraknya
function asalSkor(p) {
  const jalur = jalurList.find((j) => j.id === p.jalur_id);
  if (JALUR_JARAK.includes(jalur?.jenis) || p.jarak_km != null) {
    return p.jarak_km != null ? `dari jarak ${Number(p.jarak_km).toFixed(1)} km` : "jarak tidak tersedia";
  }
  if (jalur?.jenis === "prestasi_akademik") return "nilai rapor";
  if (jalur?.jenis === "prestasi_nonakademik") return p.catatan_skor ? "menunggu panitia" : "skor sertifikat";
  return "";
}

// Urutan jalur mengikuti SPMB 2026: Domisili, Afirmasi, Mutasi, Prestasi (akademik, nonakademik)
const URUTAN_JALUR = ["domisili", "afirmasi", "mutasi", "prestasi_akademik", "prestasi_nonakademik"];
function jalurOptionsForSekolah(sekolahId) {
  return jalurList
    .filter((j) => j.sekolah_id === Number(sekolahId))
    .sort((x, y) => URUTAN_JALUR.indexOf(x.jenis) - URUTAN_JALUR.indexOf(y.jenis));
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
  if (typeof terapkanJalurDisukai === "function") terapkanJalurDisukai(sel);
}

/* ---------- Cek jarak ke sekolah (sebelum mendaftar) ---------- */
let lokasiTerakhir = null; // { latitude, longitude, akurasi, waktu }

// Rumus Haversine -- sama dengan zonasi.js (rumus jarak) di server
function hitungJarakKm(lat1, lng1, lat2, lng2) {
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

function jarakKeSekolah(sekolah) {
  if (!lokasiTerakhir || sekolah.latitude == null || sekolah.longitude == null) return null;
  return hitungJarakKm(lokasiTerakhir.latitude, lokasiTerakhir.longitude, Number(sekolah.latitude), Number(sekolah.longitude));
}

function radiusDomisili(sekolahId) {
  return jalurList.find((j) => j.sekolah_id === sekolahId && j.jenis === "domisili")?.syarat_radius_km ?? null;
}

function labelJarakSekolah(sekolah) {
  const jarak = jarakKeSekolah(sekolah);
  if (jarak == null) return "";
  const radius = radiusDomisili(sekolah.id);
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
    .map((s) => ({ s, jarak: jarakKeSekolah(s), radius: radiusDomisili(s.id) }))
    .filter((x) => x.jarak != null)
    .sort((a, b) => a.jarak - b.jarak);
  const masuk = urut.filter((x) => x.radius != null && x.jarak <= Number(x.radius));
  info.innerHTML = `Akurasi GPS ± ${Math.round(lokasi.akurasi)} m. ` +
    (masuk.length
      ? `<strong style="color:#047857">${masuk.length} sekolah masuk radius domisili:</strong> ${masuk.map((x) => `${esc(x.s.nama)} (${x.jarak.toFixed(1)} km)`).join(", ")}.`
      : '<strong style="color:#b91c1c">Tidak ada sekolah dalam radius domisili dari lokasimu. Jalur Afirmasi, Mutasi, dan Prestasi tidak memakai syarat radius.</strong>') +
    ` Terdekat berikutnya: ${urut.filter((x) => !masuk.includes(x)).slice(0, 2).map((x) => `${esc(x.s.nama)} (${x.jarak.toFixed(1)} km)`).join(", ") || "-"}. Tanda ✓/✕ di pilihan sekolah menunjukkan masuk/tidak radius jalur Domisili.`;
});

// ---------- Beranda ----------
function renderBeranda() {
  const totalAktif = pendaftarList.filter((p) => p.status_global === "Aktif").length;
  const totalDiterima = pendaftarList.filter((p) => p.status_global === "Diterima Final").length;
  const totalTidakDiterima = pendaftarList.filter((p) => p.status_global === "Tidak Diterima Final").length;
  document.getElementById("stat-grid").innerHTML = `
    <div class="strip-item"><span class="strip-ikon">${ikon("sekolah")}</span><strong data-angka="${sekolahList.length}">${sekolahList.length}</strong><span><b>Sekolah</b>SMA Negeri peserta</span></div>
    <div class="strip-item"><span class="strip-ikon hijau">${ikon("orang")}</span><strong data-angka="${pendaftarList.length}">${pendaftarList.length}</strong><span><b>Pendaftar</b>total saat ini</span></div>
    <div class="strip-item"><span class="strip-ikon oranye">${ikon("jam")}</span><strong data-angka="${totalAktif}" style="color:#b45309">${totalAktif}</strong><span><b>Diproses</b>verifikasi &amp; seleksi</span></div>
    <div class="strip-item"><span class="strip-ikon hijau">${ikon("diterima")}</span><strong data-angka="${totalDiterima}" style="color:var(--amber)">${totalDiterima}</strong><span><b>Diterima</b>${totalTidakDiterima ? `${totalTidakDiterima} tidak diterima` : "di salah satu pilihan"}</span></div>
    <button type="button" class="strip-cta" onclick="showView('daftar')">Daftar Sekarang ${ikon("panahKanan")}</button>
  `;
  document.querySelectorAll("#stat-grid [data-angka]").forEach(hitungNaik);
  renderJalurBeranda();
  renderSekolahBeranda();
  renderTahapanBeranda(totalDiterima + totalTidakDiterima > 0);
}

/** Daftar sekolah peserta di Beranda: radius, kuota, dan jarak dari rumah (kalau lokasi sudah diambil). */
const JUMLAH_SEKOLAH_AWAL = 6; // sisanya lewat tombol "Tampilkan semua" supaya Beranda tidak terlalu panjang di HP
let tampilkanSemuaSekolah = false;

function renderSekolahBeranda() {
  const kata = document.getElementById("cari-sekolah").value.trim().toLowerCase();
  const cocok = sekolahList.filter((s) => !kata || `${s.nama} ${s.alamat || ""}`.toLowerCase().includes(kata));
  const dipotong = !kata && !tampilkanSemuaSekolah && cocok.length > JUMLAH_SEKOLAH_AWAL;
  const tampil = dipotong ? cocok.slice(0, JUMLAH_SEKOLAH_AWAL) : cocok;
  document.getElementById("sekolah-semua").hidden = !dipotong;
  document.getElementById("sekolah-semua").innerText = `Tampilkan semua ${cocok.length} sekolah`;
  document.getElementById("sekolah-jumlah").innerText = kata
    ? `${cocok.length} dari ${sekolahList.length} sekolah`
    : `${sekolahList.length} sekolah`;

  document.getElementById("beranda-sekolah").innerHTML = tampil.length ? tampil.map((s, i) => {
    const jalur = jalurOptionsForSekolah(s.id);
    const domisili = jalur.find((j) => j.jenis === "domisili");
    const kuotaJalur = (jenis) => jalur.find((j) => j.jenis === jenis)?.kuota;
    const jarak = jarakKeSekolah(s);
    const jarakHTML = jarak == null || !domisili ? ""
      : `<span class="${jarak <= Number(domisili.syarat_radius_km) ? "rinci-jarak" : "rinci-jauh"}">${jarak.toFixed(1)} km dari rumah</span>`;
    const totalKursi = jalur.reduce((n, j) => n + (Number(j.kuota) || 0), 0);
    const peta = s.latitude != null ? `https://www.google.com/maps?q=${Number(s.latitude)},${Number(s.longitude)}` : null;
    return `
      <div class="sekolah-kartu" role="button" tabindex="0" data-sekolah="${s.id}" style="--i:${i}" aria-label="Lihat profil ${esc(s.nama)}">
        <span class="sekolah-ikon">${ikon("sekolah")}</span>
        <div style="min-width:0">
          <strong>${esc(s.nama)}</strong>
          <div class="sekolah-alamat">${esc(s.alamat || "-")}</div>
          <div class="sekolah-rinci">
            <span class="rinci-total">${totalKursi} kursi</span>
            ${domisili ? `<span class="rinci-zonasi">Domisili ${esc(domisili.syarat_radius_km)} km · ${domisili.kuota}</span>` : ""}
            ${kuotaJalur("afirmasi") != null ? `<span>Afirmasi ${kuotaJalur("afirmasi")}</span>` : ""}
            ${kuotaJalur("mutasi") != null ? `<span>Mutasi ${kuotaJalur("mutasi")}</span>` : ""}
            ${kuotaJalur("prestasi_akademik") != null || kuotaJalur("prestasi_nonakademik") != null
              ? `<span class="rinci-prestasi">Prestasi ${(kuotaJalur("prestasi_akademik") || 0) + (kuotaJalur("prestasi_nonakademik") || 0)}</span>` : ""}
            ${jarakHTML}
          </div>
          <div class="sekolah-aksi">
            <span class="sekolah-profil">Lihat profil ${ikon("panahKanan")}</span>
            ${peta ? `<a class="sekolah-peta" href="${peta}" target="_blank" rel="noopener">${ikon("lokasi")} Peta</a>` : ""}
          </div>
        </div>
      </div>`;
  }).join("") : `<p class="muted" style="grid-column:1/-1">Tidak ada sekolah yang cocok dengan "${esc(kata)}".</p>`;
}
document.getElementById("cari-sekolah").addEventListener("input", () => renderSekolahBeranda());

// Klik / Enter pada kartu sekolah -> buka profil (tautan peta di dalam kartu tetap berfungsi sendiri)
const daftarSekolahEl = document.getElementById("beranda-sekolah");
daftarSekolahEl.addEventListener("click", (e) => {
  if (e.target.closest("a")) return;
  const kartu = e.target.closest("[data-sekolah]");
  if (kartu) bukaProfilSekolah(Number(kartu.dataset.sekolah), kartu);
});
daftarSekolahEl.addEventListener("keydown", (e) => {
  const kartu = e.target.closest("[data-sekolah]");
  if (kartu && e.target === kartu && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    bukaProfilSekolah(Number(kartu.dataset.sekolah), kartu);
  }
});

/* ---------- Profil sekolah: kuota & syarat tiap jalur, jarak dari rumah, peta, dan tombol daftar ---------- */
const KET_JALUR = {
  domisili: { ikon: "lokasi", urut: "jarak terdekat" },
  afirmasi: { ikon: "perisai", urut: "jarak terdekat", syarat: "Bukti KIP/PKH/DTKS/disabilitas" },
  mutasi: { ikon: "alih", urut: "jarak terdekat", syarat: "Surat pindah tugas / anak guru" },
  prestasi_akademik: { ikon: "piala", urut: "nilai tertinggi" },
  prestasi_nonakademik: { ikon: "kilau", urut: "skor sertifikat tertinggi", syarat: "Sertifikat prestasi, diberi skor panitia" },
};
let profilDibuka = null; // { tipe: "sekolah"|"jalur", id | kunci, asal } -- asal = elemen yang difokus kembali saat ditutup

function renderProfil() {
  if (profilDibuka?.tipe === "jalur") renderDetailJalur();
  else renderProfilSekolah();
}

/** Kepala lembar: ikon, label kecil, judul, dan subjudul */
function kepalaLembar(ikonNama, label, judul, sub) {
  document.getElementById("profil-ikon").innerHTML = ikon(ikonNama);
  document.getElementById("profil-label").innerText = label;
  document.getElementById("profil-nama").innerText = judul;
  document.getElementById("profil-alamat").innerText = sub;
}

/** Kotak "Seberapa jauh dari rumahmu?" + tombol cek jarak (id profil-cek-jarak) */
function kotakCekJarak(teks) {
  return `<div class="profil-jarak"><span>${ikon("lokasi")}</span><div><strong>Seberapa jauh dari rumahmu?</strong><small>${teks}</small></div>
      <button type="button" class="btn btn-outline" id="profil-cek-jarak">Cek jarak</button></div>`;
}
function pasangCekJarak() {
  document.getElementById("profil-cek-jarak")?.addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.innerText = "Mengambil lokasi…";
    const lokasi = await ambilLokasi(true);
    if (!lokasi) Dialog.toast(pesanGagalLokasi(), "peringatan");
    renderProfil();
    renderSekolahBeranda();
  });
}

function renderProfilSekolah() {
  const s = sekolahList.find((x) => x.id === profilDibuka?.id);
  if (!s) return;
  const jalur = jalurOptionsForSekolah(s.id);
  const total = jalur.reduce((n, j) => n + (Number(j.kuota) || 0), 0);
  const diproses = pendaftarList.filter((p) => p.status_global === "Aktif" && p.sekolah_aktif_nama === s.nama).length;
  const diterima = pendaftarList.filter((p) => p.status_global === "Diterima Final" && p.sekolah_aktif_nama === s.nama).length;
  const domisili = jalur.find((j) => j.jenis === "domisili");
  const jarak = jarakKeSekolah(s);
  const lat = Number(s.latitude), lng = Number(s.longitude);
  const adaKoordinat = s.latitude != null && Number.isFinite(lat) && Number.isFinite(lng);

  kepalaLembar("sekolah", "Profil sekolah", s.nama, s.alamat || "-");

  let jarakHTML;
  if (jarak == null) {
    jarakHTML = kotakCekJarak("Izinkan lokasi untuk melihat jarak dan apakah rumahmu masuk radius Domisili.");
  } else {
    const masuk = domisili && jarak <= Number(domisili.syarat_radius_km);
    jarakHTML = `<div class="profil-jarak ${masuk ? "masuk" : "luar"}"><span>${ikon("lokasi")}</span><div><strong>${jarak.toFixed(1)} km dari lokasimu</strong>
      <small>${domisili ? (masuk ? `Masuk radius Domisili (${esc(domisili.syarat_radius_km)} km).` : `Di luar radius Domisili (${esc(domisili.syarat_radius_km)} km); jalur Afirmasi, Mutasi, dan Prestasi tetap bisa dipilih.`) : ""}</small></div></div>`;
  }

  const jalurHTML = jalur.map((j) => {
    const k = KET_JALUR[j.jenis] || { ikon: "info", urut: "-" };
    const syarat = j.jenis === "domisili" ? `Jarak ≤ ${esc(j.syarat_radius_km)} km`
      : j.jenis === "prestasi_akademik" ? `Nilai rapor/TKA ≥ ${esc(j.syarat_nilai_minimum ?? "-")}`
      : k.syarat || "-";
    const persen = total ? Math.round((Number(j.kuota) / total) * 100) : 0;
    const kunciJalur = j.jenis.startsWith("prestasi") ? "prestasi" : j.jenis;
    return `<div class="profil-jalur" role="button" tabindex="0" data-buka-jalur="${kunciJalur}" aria-label="Detail jalur ${esc(j.nama)}">
        <span class="profil-jalur-ikon">${ikon(k.ikon)}</span>
        <div class="profil-jalur-isi">
          <div class="profil-jalur-atas"><strong>${esc(j.nama)}</strong><span><b>${j.kuota}</b> kursi · ${persen}%</span></div>
          <div class="profil-batang"><span style="--lebar:${persen}%"></span></div>
          <small>${syarat} · urut ${k.urut}</small>
        </div>
        <span class="profil-panah">${ikon("panahKanan")}</span>
      </div>`;
  }).join("");

  document.getElementById("profil-isi").innerHTML = `
    <div class="profil-angka">
      <div><strong>${total}</strong><span>total kursi</span></div>
      <div><strong>${jalur.length}</strong><span>jalur SPMB</span></div>
      <div><strong>${diproses}</strong><span>sedang diproses</span></div>
      <div><strong>${diterima}</strong><span>sudah diterima</span></div>
    </div>
    ${jarakHTML}
    <h3 class="profil-sub">Kuota & syarat per jalur <span>ketuk untuk detail</span></h3>
    <div class="profil-jalur-daftar">${jalurHTML}</div>
    ${adaKoordinat ? `<h3 class="profil-sub">Lokasi</h3>
      <iframe class="profil-peta" title="Peta lokasi ${esc(s.nama)}" loading="lazy"
        src="https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.012},${lat - 0.008},${lng + 0.012},${lat + 0.008}&layer=mapnik&marker=${lat},${lng}"></iframe>` : ""}
    <p class="profil-catatan">Angka pendaftar diperbarui langsung dari sistem. Kuota ditetapkan Admin Dinas dan dapat berubah sebelum pendaftaran ditutup.</p>`;

  document.getElementById("profil-kaki").innerHTML = `
    ${adaKoordinat ? `<a class="btn btn-outline" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}" target="_blank" rel="noopener">${ikon("lokasi")} Rute</a>` : ""}
    <button type="button" class="btn btn-accent" id="profil-daftar">Daftar di sekolah ini ${ikon("panahKanan")}</button>`;

  pasangCekJarak();
  document.getElementById("profil-daftar").addEventListener("click", () => daftarDiSekolah(s.id));
}

/* ---------- Detail jalur pendaftaran (Domisili, Afirmasi, Mutasi, Prestasi) ---------- */
const INFO_JALUR = {
  domisili: {
    ikon: "lokasi", judul: "Jalur Domisili", sub: "Berdasarkan jarak tempat tinggal ke sekolah", jenis: ["domisili"], pakaiJarak: true,
    cocok: ["Calon siswa yang tinggal dekat sekolah (di dalam radius domisili).", "Alamat di Kartu Keluarga sesuai dengan lokasi rumah yang diajukan."],
    syarat: (r) => [`Jarak rumah ke sekolah <strong>≤ radius domisili</strong> sekolah itu (${r}).`, "Lokasi rumah diambil dari GPS saat mendaftar, lalu dicocokkan panitia dengan alamat di KK."],
    berkas: [], urut: "Jarak <strong>terdekat</strong> ke sekolah diterima lebih dulu.",
  },
  afirmasi: {
    ikon: "perisai", judul: "Jalur Afirmasi", sub: "Keluarga tidak mampu & penyandang disabilitas", jenis: ["afirmasi"], pakaiJarak: true,
    cocok: ["Pemegang KIP (Kartu Indonesia Pintar) atau peserta PKH.", "Keluarga yang terdaftar di DTKS.", "Calon siswa penyandang disabilitas."],
    syarat: () => ["Memilih kategori (KIP/PKH/DTKS/disabilitas) di formulir.", "Kelayakan dibuktikan dengan berkas yang diverifikasi panitia; <strong>tidak ada syarat radius</strong>."],
    berkas: ["Bukti Afirmasi (kartu KIP/PKH, bukti DTKS, atau surat keterangan disabilitas)"], urut: "Jarak <strong>terdekat</strong> diterima lebih dulu; pendaftar tanpa lokasi ditempatkan paling akhir.",
  },
  mutasi: {
    ikon: "alih", judul: "Jalur Mutasi", sub: "Perpindahan tugas orang tua & anak guru", jenis: ["mutasi"], pakaiJarak: true,
    cocok: ["Anak dari orang tua/wali yang dipindahtugaskan ke wilayah ini.", "Anak guru atau tenaga kependidikan di sekolah tujuan."],
    syarat: () => ["Memilih kategori (pindah tugas / anak guru) di formulir.", "Surat penugasan/keterangan diverifikasi panitia; <strong>tidak ada syarat radius</strong>."],
    berkas: ["Surat Mutasi / surat keterangan anak guru-tenaga kependidikan"], urut: "Jarak <strong>terdekat</strong> diterima lebih dulu; pendaftar tanpa lokasi ditempatkan paling akhir.",
  },
  prestasi: {
    ikon: "piala", judul: "Jalur Prestasi", sub: "Akademik (nilai) & nonakademik (lomba, organisasi)", jenis: ["prestasi_akademik", "prestasi_nonakademik"], pakaiJarak: false,
    cocok: ["<strong>Akademik:</strong> nilai rapor (atau hasil TKA) tinggi.", "<strong>Nonakademik:</strong> juara lomba, ketua OSIS, pramuka, olahraga, seni, dan sejenisnya."],
    syarat: (r, n) => [`<strong>Akademik:</strong> rata-rata nilai ≥ ${n}.`, "<strong>Nonakademik:</strong> menuliskan prestasi di formulir; panitia memberi skor 0–100 dari sertifikat."],
    berkas: ["Sertifikat Prestasi (khusus nonakademik)"], urut: "<strong>Akademik:</strong> nilai tertinggi. <strong>Nonakademik:</strong> skor sertifikat tertinggi.",
  },
};

function renderDetailJalur() {
  const info = INFO_JALUR[profilDibuka?.kunci];
  if (!info) return;
  const jalurIni = jalurList.filter((j) => info.jenis.includes(j.jenis));
  const totalKursi = jalurIni.reduce((n, j) => n + (Number(j.kuota) || 0), 0);
  const totalSemua = jalurList.reduce((n, j) => n + (Number(j.kuota) || 0), 0);
  const unik = (arr) => [...new Set(arr.filter((x) => x != null).map(Number))].sort((a, b) => a - b);
  const radius = unik(jalurIni.map((j) => j.syarat_radius_km));
  const nilaiMin = unik(jalurIni.filter((j) => j.jenis === "prestasi_akademik").map((j) => j.syarat_nilai_minimum));
  kepalaLembar(info.ikon, "Jalur pendaftaran", info.judul, info.sub);

  const adaLokasi = !!lokasiTerakhir;
  const barisSekolah = sekolahList.map((s) => {
    const j = jalurIni.filter((x) => x.sekolah_id === s.id);
    return { s, j, kursi: j.reduce((n, x) => n + (Number(x.kuota) || 0), 0), jarak: jarakKeSekolah(s) };
  }).filter((x) => x.j.length);
  barisSekolah.sort(adaLokasi ? (a, b) => a.jarak - b.jarak : (a, b) => b.kursi - a.kursi || a.s.nama.localeCompare(b.s.nama));
  const masukRadius = barisSekolah.filter((x) => { const d = x.j.find((y) => y.jenis === "domisili"); return d && x.jarak != null && x.jarak <= Number(d.syarat_radius_km); });

  const daftarSekolahHTML = barisSekolah.map((x) => {
    const dom = x.j.find((y) => y.jenis === "domisili");
    const rinci = profilDibuka.kunci === "prestasi"
      ? x.j.map((y) => `${y.jenis === "prestasi_akademik" ? "Akademik" : "Nonakademik"} ${y.kuota}`).join(" · ")
      : dom ? `radius ${esc(dom.syarat_radius_km)} km` : "";
    let tanda = "";
    if (x.jarak != null) {
      const cocok = dom ? x.jarak <= Number(dom.syarat_radius_km) : null;
      tanda = `<span class="ps-jarak ${cocok === true ? "masuk" : cocok === false ? "luar" : ""}">${cocok === true ? "✓ " : cocok === false ? "✕ " : ""}${x.jarak.toFixed(1)} km</span>`;
    }
    return `<div class="profil-sekolah-baris" role="button" tabindex="0" data-buka-sekolah="${x.s.id}" aria-label="Profil ${esc(x.s.nama)}">
        <div class="ps-isi"><strong>${esc(x.s.nama)}</strong><small>${rinci}</small></div>
        ${tanda}
        <span class="ps-kursi"><b>${x.kursi}</b> kursi</span>
        <span class="profil-panah">${ikon("panahKanan")}</span>
      </div>`;
  }).join("");

  const daftar = (arr) => `<ul class="profil-poin">${arr.map((x) => `<li>${x}</li>`).join("")}</ul>`;
  let jarakHTML = "";
  if (info.pakaiJarak) {
    jarakHTML = !adaLokasi
      ? kotakCekJarak(profilDibuka.kunci === "domisili" ? "Izinkan lokasi untuk melihat sekolah mana saja yang masuk radius dari rumahmu." : "Peringkat jalur ini memakai jarak; izinkan lokasi untuk melihat sekolah terdekat.")
      : profilDibuka.kunci === "domisili"
        ? `<div class="profil-jarak ${masukRadius.length ? "masuk" : "luar"}"><span>${ikon("lokasi")}</span><div><strong>${masukRadius.length ? `${masukRadius.length} sekolah masuk radius dari rumahmu` : "Belum ada sekolah dalam radius dari rumahmu"}</strong>
            <small>${masukRadius.length ? masukRadius.map((x) => esc(x.s.nama)).join(", ") : "Jalur Afirmasi, Mutasi, dan Prestasi tidak memakai syarat radius."}</small></div></div>`
        : `<div class="profil-jarak masuk"><span>${ikon("lokasi")}</span><div><strong>Sekolah diurutkan dari yang terdekat</strong><small>Makin dekat, makin tinggi peringkatmu di jalur ini.</small></div></div>`;
  }

  document.getElementById("profil-isi").innerHTML = `
    <div class="profil-angka">
      <div><strong>${totalKursi}</strong><span>kursi di semua sekolah</span></div>
      <div><strong>${totalSemua ? Math.round((totalKursi / totalSemua) * 100) : 0}%</strong><span>dari total kursi</span></div>
      <div><strong>${barisSekolah.length}</strong><span>sekolah membuka</span></div>
      <div><strong>${info.pakaiJarak ? "Jarak" : "Nilai"}</strong><span>dasar peringkat</span></div>
    </div>
    <h3 class="profil-sub">Siapa yang cocok</h3>${daftar(info.cocok)}
    <h3 class="profil-sub">Syarat</h3>${daftar(info.syarat(radius.length ? radius.join(" atau ") + " km" : "-", nilaiMin.length ? nilaiMin.join(" / ") : "-"))}
    <h3 class="profil-sub">Berkas yang diunggah</h3>
    <div class="profil-berkas">${DOKUMEN_DASAR.map((b) => `<span>${ikon("berkas")} ${esc(b)}</span>`).join("")}${info.berkas.map((b) => `<span class="khusus">${ikon("berkas")} ${b}</span>`).join("")}</div>
    <h3 class="profil-sub">Cara peringkat</h3>
    <p class="profil-teks">${info.urut} Jika sama, <strong>usia lebih tua</strong> didahulukan, lalu yang <strong>mendaftar lebih awal</strong>.</p>
    ${jarakHTML}
    <h3 class="profil-sub">Kursi jalur ini per sekolah <span>${adaLokasi && info.pakaiJarak ? "urut terdekat" : "ketuk untuk profil"}</span></h3>
    <div class="profil-jalur-daftar">${daftarSekolahHTML}</div>
    <p class="profil-catatan">Setiap pilihan sekolah boleh memakai jalur berbeda. Kuota ditetapkan Admin Dinas dan dapat berubah sebelum pendaftaran ditutup.</p>`;

  document.getElementById("profil-kaki").innerHTML = `
    <button type="button" class="btn btn-accent" id="profil-daftar">Daftar lewat jalur ini ${ikon("panahKanan")}</button>`;
  pasangCekJarak();
  document.getElementById("profil-daftar").addEventListener("click", () => daftarLewatJalur(profilDibuka.kunci));
}

/** Jalur yang dipilih dari detail jalur: dipasang otomatis saat pendaftar memilih sekolah di formulir */
let jenisJalurDisukai = null;
function daftarLewatJalur(kunci) {
  const info = INFO_JALUR[kunci];
  jenisJalurDisukai = info.jenis[0];
  tutupProfilSekolah();
  showView("daftar");
  document.querySelectorAll(".select-sekolah").forEach((sel) => { if (sel.value) terapkanJalurDisukai(sel); });
  perbaruiInfoJalur();
  Dialog.toast(`${info.judul} dipilih. Di langkah Pilihan Sekolah, jalur ini otomatis terpasang untuk sekolah yang kamu pilih (bisa diubah).`);
}
function terapkanJalurDisukai(sel) {
  if (!jenisJalurDisukai) return;
  const jalurSel = document.querySelector(`.select-jalur[data-index="${sel.dataset.index}"]`);
  const cocok = jalurOptionsForSekolah(sel.value).find((j) => j.jenis === jenisJalurDisukai);
  if (cocok) jalurSel.value = String(cocok.id);
}

/** Tampilkan lembar (dipakai profil sekolah & detail jalur). Bila sudah terbuka, cukup ganti isinya. */
function tampilkanLembar(isi) {
  const sudahBuka = !!profilDibuka;
  const asal = sudahBuka ? profilDibuka.asal : isi.asal;
  profilDibuka = { ...isi, asal };
  renderProfil();
  const lembar = document.getElementById("profil-sekolah");
  lembar.querySelector(".profil-isi").scrollTop = 0;
  if (sudahBuka) { lembar.classList.remove("ganti"); void lembar.offsetWidth; lembar.classList.add("ganti"); return; }
  const latar = document.getElementById("profil-latar");
  clearTimeout(timerTutupLembar);
  lembar.hidden = false;
  latar.hidden = false;
  document.body.classList.add("profil-terbuka");
  requestAnimationFrame(() => { lembar.classList.add("buka"); latar.classList.add("buka"); });
  setTimeout(() => document.getElementById("profil-tutup").focus(), 60);
}
function bukaProfilJalur(kunci, asal = null) { tampilkanLembar({ tipe: "jalur", kunci, asal }); }

// Klik/Enter di dalam lembar: baris jalur -> detail jalur, baris sekolah -> profil sekolah
(function navigasiDalamLembar() {
  const isi = document.getElementById("profil-isi");
  const buka = (el) => {
    if (el.dataset.bukaJalur) bukaProfilJalur(el.dataset.bukaJalur);
    else if (el.dataset.bukaSekolah) bukaProfilSekolah(Number(el.dataset.bukaSekolah));
  };
  isi.addEventListener("click", (e) => { const el = e.target.closest("[data-buka-jalur], [data-buka-sekolah]"); if (el) buka(el); });
  isi.addEventListener("keydown", (e) => {
    const el = e.target.closest("[data-buka-jalur], [data-buka-sekolah]");
    if (el && e.target === el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); buka(el); }
  });
})();

// Kartu jalur di Beranda
(function kartuJalurBisaDiklik() {
  const wadah = document.getElementById("beranda-jalur");
  wadah.addEventListener("click", (e) => { const k = e.target.closest("[data-jalur]"); if (k) bukaProfilJalur(k.dataset.jalur, k); });
  wadah.addEventListener("keydown", (e) => {
    const k = e.target.closest("[data-jalur]");
    if (k && e.target === k && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); bukaProfilJalur(k.dataset.jalur, k); }
  });
})();

function bukaProfilSekolah(id, asal = null) {
  tampilkanLembar({ tipe: "sekolah", id, asal });
}

let timerTutupLembar = null;
function tutupProfilSekolah() {
  if (!profilDibuka) return;
  const lembar = document.getElementById("profil-sekolah");
  const latar = document.getElementById("profil-latar");
  lembar.classList.remove("buka");
  latar.classList.remove("buka");
  document.body.classList.remove("profil-terbuka");
  const asal = profilDibuka.asal;
  profilDibuka = null;
  lembar.classList.remove("ganti");
  timerTutupLembar = setTimeout(() => { lembar.hidden = true; latar.hidden = true; }, kurangiGerak ? 0 : 280);
  asal?.focus();
}
document.getElementById("profil-tutup").addEventListener("click", tutupProfilSekolah);
document.getElementById("profil-latar").addEventListener("click", tutupProfilSekolah);
document.addEventListener("keydown", (e) => {
  if (!profilDibuka) return;
  if (e.key === "Escape") tutupProfilSekolah();
  if (e.key === "Tab") { // fokus tetap di dalam lembar profil
    const fokusable = [...document.querySelectorAll("#profil-sekolah button, #profil-sekolah a, #profil-sekolah iframe, #profil-sekolah [tabindex='0']")].filter((x) => !x.disabled);
    const [pertama, terakhir] = [fokusable[0], fokusable[fokusable.length - 1]];
    if (e.shiftKey && document.activeElement === pertama) { e.preventDefault(); terakhir.focus(); }
    else if (!e.shiftKey && document.activeElement === terakhir) { e.preventDefault(); pertama.focus(); }
  }
});

// Geser lembar ke bawah untuk menutup (HP)
(function geserUntukTutup() {
  const lembar = document.getElementById("profil-sekolah");
  let awalY = null, geser = 0;
  lembar.querySelector(".profil-pegangan").parentElement.addEventListener("touchstart", (e) => {
    if (!e.target.closest(".profil-kepala, .profil-pegangan")) return;
    awalY = e.touches[0].clientY; geser = 0;
    lembar.style.transition = "none";
  }, { passive: true });
  lembar.addEventListener("touchmove", (e) => {
    if (awalY == null) return;
    geser = Math.max(0, e.touches[0].clientY - awalY);
    lembar.style.transform = `translateY(${geser}px)`;
  }, { passive: true });
  lembar.addEventListener("touchend", () => {
    if (awalY == null) return;
    lembar.style.transition = "";
    lembar.style.transform = "";
    if (geser > 90) tutupProfilSekolah();
    awalY = null;
  });
})();

/** Tombol "Daftar di sekolah ini": pilih sekolah itu di slot pilihan kosong pertama, lalu buka formulir */
function daftarDiSekolah(sekolahId) {
  tutupProfilSekolah();
  showView("daftar");
  const slot = [...document.querySelectorAll(".select-sekolah")];
  const sudah = slot.find((sel) => Number(sel.value) === sekolahId);
  const kosong = sudah || slot.find((sel) => !sel.value);
  if (!kosong) return Dialog.toast("Ketiga pilihan sekolah sudah terisi. Ubah salah satu di langkah Pilihan Sekolah.", "peringatan");
  if (!sudah) {
    kosong.value = String(sekolahId);
    isiJalur(kosong);
    perbaruiInfoJalur();
  }
  Dialog.toast(`${sekolahNama(sekolahId)} sudah dipasang sebagai Pilihan ${Number(kosong.dataset.index) + 1}. Lengkapi data diri dulu.`);
}
document.getElementById("sekolah-semua").addEventListener("click", () => {
  tampilkanSemuaSekolah = true;
  renderSekolahBeranda();
});

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
      <span class="jadwal-kepala"><span class="jadwal-no">${x.status === "selesai" ? ikon("centang") : i + 1}</span><span class="jadwal-ikon">${ikon(["formulir", "daftarCek", "orang", "perisai"][i])}</span></span>
      <div>
        <div class="jadwal-atas"><strong>${x.judul}</strong><span class="jadwal-label">${x.label}</span></div>
        <p>${x.ket}</p>
      </div>
    </li>`).join("");
}

function renderJalurBeranda() {
  const unik = (arr) => [...new Set(arr.filter((x) => x != null).map(Number))].sort((a, b) => a - b);
  const radius = unik(jalurList.filter((j) => j.jenis === "domisili").map((j) => j.syarat_radius_km));
  const nilaiMin = unik(jalurList.filter((j) => j.jenis === "prestasi_akademik").map((j) => j.syarat_nilai_minimum));
  const kunciDari = { Domisili: "domisili", Afirmasi: "afirmasi", Mutasi: "mutasi", Prestasi: "prestasi" };
  const kartu = (ikonNama, judul, sub, isi, berkas) => `
    <div class="jalur-info" role="button" tabindex="0" data-jalur="${kunciDari[judul]}" aria-label="Lihat detail jalur ${judul}">
      <div class="jalur-info-kepala"><span class="stat-ico">${ikon(ikonNama)}</span><div><strong>${judul}</strong><span>${sub}</span></div></div>
      <ul>${isi.map((x) => `<li>${x}</li>`).join("")}</ul>
      ${berkas ? `<p class="jalur-berkas">${ikon("berkas")} Berkas tambahan: <strong>${berkas}</strong></p>` : ""}
      <span class="jalur-detail">Lihat detail & sekolah ${ikon("panahKanan")}</span>
    </div>`;
  document.getElementById("beranda-jalur").innerHTML =
    kartu("lokasi", "Domisili", "Berdasarkan jarak tempat tinggal", [
      `Syarat: jarak rumah ke sekolah <strong>≤ radius domisili</strong> (${radius.length ? radius.join(" atau ") + " km" : "-"}; Kota Yogyakarta lebih kecil dari Sleman).`,
      "Jarak dihitung otomatis dari lokasi GPS, dicocokkan panitia dengan alamat di KK.",
      "Peringkat: <strong>jarak terdekat</strong> diterima lebih dulu.",
    ]) +
    kartu("perisai", "Afirmasi", "Keluarga tidak mampu & penyandang disabilitas", [
      "Untuk pemegang KIP/PKH, terdaftar DTKS, atau penyandang disabilitas.",
      "Kelayakan dibuktikan dengan berkas yang diverifikasi panitia; tidak ada syarat radius.",
      "Peringkat: <strong>jarak terdekat</strong> diterima lebih dulu.",
    ], "Bukti Afirmasi (KIP/PKH/DTKS/surat disabilitas)") +
    kartu("alih", "Mutasi", "Perpindahan tugas orang tua & anak guru", [
      "Untuk orang tua/wali yang pindah tugas, atau anak guru/tenaga kependidikan.",
      "Kelayakan dibuktikan dengan surat penugasan/keterangan yang diverifikasi panitia.",
      "Peringkat: <strong>jarak terdekat</strong> diterima lebih dulu.",
    ], "Surat Mutasi / keterangan GTK") +
    kartu("piala", "Prestasi", "Akademik & nonakademik", [
      `<strong>Akademik:</strong> rata-rata nilai rapor (atau hasil TKA) <strong>≥ ${nilaiMin.length ? nilaiMin.join(" / ") : "-"}</strong>, peringkat nilai tertinggi.`,
      "<strong>Nonakademik:</strong> lomba, ketua OSIS, pramuka, dan sejenisnya — panitia memberi skor 0–100 dari sertifikat, peringkat skor tertinggi.",
    ], "Sertifikat Prestasi (khusus nonakademik)") +
    `<p class="muted" style="grid-column:1/-1;font-size:12.5px;margin:0">Setiap pilihan sekolah boleh memakai jalur yang berbeda. Jika jarak atau nilai sama, <strong>usia lebih tua</strong> didahulukan, lalu yang <strong>mendaftar lebih awal</strong>. Semua jalur wajib mengunggah KK, akta kelahiran, dan rapor.</p>`;
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

/** Kotak Afirmasi/Mutasi/Prestasi Nonakademik muncul (dan isiannya jadi wajib) hanya jika jalurnya dipilih. */
function perbaruiInfoJalur() {
  const pilihan = pilihanTerisi().map((p, i) => ({ urutan: i + 1, sekolah: sekolahNama(p.sekolahId), jenis: jalurDariId(p.jalurId)?.jenis }));
  for (const jenis of ["afirmasi", "mutasi", "prestasi_nonakademik"]) {
    const kotak = document.getElementById(`jk-${jenis}`);
    const dipakai = pilihan.filter((p) => p.jenis === jenis);
    kotak.hidden = !dipakai.length;
    kotak.querySelectorAll("select, input").forEach((el) => { el.disabled = !dipakai.length; });
    kotak.querySelector(".jk-pilihan").textContent = dipakai.length ? `— ${dipakai.map((p) => `Pilihan ${p.urutan}: ${p.sekolah}`).join(", ")}` : "";
  }
}
formDaftar.addEventListener("change", (e) => {
  if (e.target.matches(".select-sekolah, .select-jalur")) perbaruiInfoJalur();
});

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
    const pakaiPrestasi = pilihan.some((p) => jalurDariId(p.jalurId)?.jenis === "prestasi_akademik");
    if (pakaiPrestasi && formDaftar.nilaiRapor.value === "") {
      formDaftar.nilaiRapor.setCustomValidity("Nilai rapor wajib diisi karena memilih jalur Prestasi Akademik.");
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
      ${!f.kategoriAfirmasi.disabled ? `<dt>Afirmasi</dt><dd>${esc(KATEGORI_AFIRMASI[f.kategoriAfirmasi.value] || "-")}</dd>` : ""}
      ${!f.kategoriMutasi.disabled ? `<dt>Mutasi</dt><dd>${esc(KATEGORI_MUTASI[f.kategoriMutasi.value] || "-")}</dd>` : ""}
      ${!f.keteranganPrestasi.disabled ? `<dt>Prestasi</dt><dd>${esc(f.keteranganPrestasi.value)}</dd>` : ""}
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

    const pakaiJarak = pilihan.some((p) => JALUR_JARAK.includes(jalurDariId(p.jalurId)?.jenis));
    if (!lokasi && pakaiJarak) {
      const lanjut = await Dialog.konfirmasi(
        `Lokasi tidak tersedia. ${pesanGagalLokasi().replace(/<[^>]+>/g, "")}\n\nJika tetap dikirim, jarak tidak bisa dihitung — jalur Domisili tidak dapat diseleksi, dan di jalur Afirmasi/Mutasi Anda berada di urutan terakhir.`,
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
      kategoriAfirmasi: form.kategoriAfirmasi.disabled ? null : form.kategoriAfirmasi.value,
      kategoriMutasi: form.kategoriMutasi.disabled ? null : form.kategoriMutasi.value,
      keteranganPrestasi: form.keteranganPrestasi.disabled ? null : form.keteranganPrestasi.value,
      akurasiLokasi: lokasi ? lokasi.akurasi : null,
      latitude: lokasi ? lokasi.latitude : null,
      longitude: lokasi ? lokasi.longitude : null,
      persetujuanData: form.persetujuanData.checked,
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
    jenisDokumenBaru = Array.isArray(data.jenisDokumen) && data.jenisDokumen.length ? data.jenisDokumen : DOKUMEN_DASAR;
    renderProgresBaru();
    const pilihanDipilih = pilihan.map((p, i) => ({ urutan: i + 1, sekolah: sekolahNama(p.sekolahId), jenis: jalurDariId(p.jalurId)?.jenis }));
    renderUploadList("upload-list", "baru", pendaftarBaruId, [], {
      keteranganKhusus: keteranganBerkasKhusus(pilihanDipilih),
      jenisDokumen: jenisDokumenBaru,
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


/**
 * Pelacak progres 5 tahap: Daftar → Berkas → Verifikasi → Seleksi → Hasil.
 * Supaya pendaftar selalu tahu posisinya dan apa yang harus dilakukan berikutnya.
 */
function renderProgres(pendaftar, jumlahBerkas, totalBerkas = DOKUMEN_DASAR.length) {
  const final = pendaftar.status_global !== "Aktif";
  const lengkap = pendaftar.status_berkas === "Lengkap";
  const kurang = pendaftar.status_berkas === "Kurang Lengkap";
  const berkasPenuh = jumlahBerkas >= totalBerkas;
  const diPilihan = pendaftar.prioritas_aktif > 1 ? ` (Pilihan ${pendaftar.prioritas_aktif})` : "";

  const tahap = [
    { label: "Daftar", status: "selesai", ket: "Terdaftar" },
    final || berkasPenuh
      ? { label: "Unggah Berkas", status: "selesai", ket: `${Math.min(jumlahBerkas, totalBerkas)}/${totalBerkas} berkas` }
      : { label: "Unggah Berkas", status: "berjalan", ket: `${jumlahBerkas}/${totalBerkas} berkas` },
    final || lengkap ? { label: "Verifikasi", status: "selesai", ket: "Berkas lengkap" }
      : kurang ? { label: "Verifikasi", status: "masalah", ket: "Perlu revisi" }
      : berkasPenuh ? { label: "Verifikasi", status: "berjalan", ket: `Diperiksa panitia${diPilihan}` }
      : { label: "Verifikasi", status: "", ket: "Oleh panitia" },
    final ? { label: "Seleksi", status: "selesai", ket: "Selesai" }
      : lengkap ? { label: "Seleksi", status: "berjalan", ket: `Menunggu seleksi${diPilihan}` }
      : { label: "Seleksi", status: "", ket: "Sesuai jalur" },
    pendaftar.status_global === "Diterima Final"
      ? (pendaftar.daftar_ulang_at ? { label: "Hasil", status: "selesai", ket: "Diterima · daftar ulang ✓" } : { label: "Hasil", status: "masalah", ket: "Diterima · konfirmasi daftar ulang" })
      : pendaftar.status_global === "Tidak Diterima Final" ? { label: "Hasil", status: "gagal", ket: "Tidak diterima" }
      : pendaftar.status_global === "Tidak Daftar Ulang" ? { label: "Hasil", status: "gagal", ket: "Tidak daftar ulang" }
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
let jenisDokumenBaru = DOKUMEN_DASAR; // diganti daftar dari server sesuai jalur yang dipilih
function renderProgresBaru() {
  document.getElementById("progres-baru").innerHTML = renderProgres(
    { status_global: "Aktif", status_berkas: "Menunggu Verifikasi", prioritas_aktif: 1 },
    berkasBaru.size, jenisDokumenBaru.length
  );
}

document.getElementById("btn-selesai-unggah").addEventListener("click", async () => {
  const sisa = jenisDokumenBaru.length - berkasBaru.size;
  if (sisa > 0) {
    const lanjut = await Dialog.konfirmasi(
      `Masih ada ${sisa} berkas yang belum diunggah. Panitia baru bisa memverifikasi setelah semua berkas lengkap.\n\nAnda bisa melanjutkan unggah nanti dari menu Cek Status (login dengan nomor pendaftaran dan password).`,
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
function renderUploadList(containerId, prefix, pendaftarId, dokumen = [], { terkunci = null, onSelesai = null, jenisDokumen = DOKUMEN_DASAR, keteranganKhusus = {} } = {}) {
  uploadCtx[prefix] = { pendaftarId, onSelesai, jenisDokumen };
  const container = document.getElementById(containerId);
  const itemHTML = (jenis, i) => {
    const ada = dokumen.find((d) => d.jenis === jenis);
    const statusHTML = ada
      ? `<span style="color:#047857">✓ ${ada.url ? `<a href="${safeUrl(ada.url)}" target="_blank" rel="noopener">${esc(ada.nama_file)}</a>` : esc(ada.nama_file)}</span>`
      : "Belum diunggah";
    return `
    <div class="upload-item">
      <div class="upload-info">
        <strong>${esc(jenis)}</strong>${DOKUMEN_DASAR.includes(jenis) ? "" : ' <span class="lencana-jalur">khusus jalur</span>'}
        ${keteranganKhusus[jenis] ? `<div class="upload-jalur">${esc(keteranganKhusus[jenis])}</div>` : ""}
        <div class="upload-status" id="${prefix}-status-${i}">${statusHTML}</div>
      </div>
      <div>${terkunci
        ? `<span style="font-size:12px;color:var(--muted)">${ikon("gembok")} ${esc(terkunci)}</span>`
        : `<input type="file" id="${prefix}-file-${i}" accept=".pdf,.jpg,.jpeg,.png" style="display:none" onchange="unggahBerkas('${prefix}', ${i})" />
           <button class="btn btn-outline" onclick="document.getElementById('${prefix}-file-${i}').click()">${ada ? "Ganti" : "Pilih File"}</button>`}
      </div>
    </div>`;
  };
  // Indeks tetap mengikuti urutan jenisDokumen (dipakai unggahBerkas)
  const umum = jenisDokumen.map((j, i) => [j, i]).filter(([j]) => DOKUMEN_DASAR.includes(j));
  const khusus = jenisDokumen.map((j, i) => [j, i]).filter(([j]) => !DOKUMEN_DASAR.includes(j));
  container.innerHTML = khusus.length
    ? `<p class="upload-grup">Berkas umum <span>wajib untuk semua jalur</span></p>${umum.map(([j, i]) => itemHTML(j, i)).join("")}
       <p class="upload-grup upload-grup-khusus">${ikon("info")} Berkas khusus jalur <span>diperiksa panitia sekolah pada pilihan yang memakai jalur tersebut</span></p>${khusus.map(([j, i]) => itemHTML(j, i)).join("")}`
    : umum.map(([j, i]) => itemHTML(j, i)).join("");
}

async function unggahBerkas(prefix, idx) {
  const { pendaftarId, onSelesai, jenisDokumen } = uploadCtx[prefix];
  const jenis = jenisDokumen[idx];
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
  const pulih = Dialog.sibuk(form.querySelector("button[type=submit]"), "Masuk…");
  try {
    const res = await fetch("/api/auth/pendaftar/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nomor: form.nomor.value, password: form.password.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      errBox.style.display = "block";
      errBox.innerText = data.error || "Gagal masuk.";
      return;
    }
    errBox.style.display = "none";
    await muatSesi();
    await renderStatusView();
  } catch {
    errBox.style.display = "block";
    errBox.innerText = "Tidak dapat terhubung ke server. Periksa koneksi internet.";
  } finally {
    pulih();
  }
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

/* ---------- K2: Daftar ulang (konfirmasi kursi) + surat keterangan diterima ---------- */
function daftarUlangHTML(p) {
  if (p.daftar_ulang_at) {
    return `<div class="daftar-ulang selesai">
      <div class="du-ikon">${ikon("diterima")}</div>
      <div class="du-isi"><strong>Daftar ulang terkonfirmasi</strong>
        <small>${esc(formatWaktuWIB(p.daftar_ulang_at))}. Bawa Surat Keterangan Diterima dan berkas asli (KK, akta, rapor) ke sekolah sesuai jadwal dari sekolah.</small></div>
      <a class="btn btn-accent" href="/surat.html" target="_blank" rel="noopener">${ikon("cetak")} Surat Keterangan Diterima</a>
    </div>`;
  }
  const sisaJam = p.daftar_ulang_batas_at ? Math.max(0, Math.floor((new Date(p.daftar_ulang_batas_at) - Date.now()) / 3600000)) : null;
  return `<div class="daftar-ulang">
    <div class="du-ikon">${ikon("jam")}</div>
    <div class="du-isi"><strong>Konfirmasi daftar ulang${sisaJam != null ? ` · sisa ${sisaJam >= 24 ? `${Math.floor(sisaJam / 24)} hari ${sisaJam % 24} jam` : `${sisaJam} jam`}` : ""}</strong>
      <small>${p.daftar_ulang_batas_at ? `Paling lambat <b>${esc(formatWaktuWIB(p.daftar_ulang_batas_at))}</b>. ` : ""}Jika tidak dikonfirmasi, kursi dilepas untuk pendaftar lain.</small></div>
    <button type="button" class="btn btn-accent" id="btn-daftar-ulang">${ikon("centang")} Konfirmasi daftar ulang</button>
  </div>`;
}

function pasangDaftarUlang(p) {
  const btn = document.getElementById("btn-daftar-ulang");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const ok = await Dialog.konfirmasi(
      `Dengan mengonfirmasi, Anda menyatakan akan bersekolah di ${sekolahNama(p.sekolah_aktif_id)}. Kursi ini menjadi milik Anda dan Surat Keterangan Diterima dapat dicetak.`,
      { judul: "Konfirmasi daftar ulang", tombolOk: "Ya, konfirmasi" });
    if (!ok) return;
    const pulih = Dialog.sibuk(btn, "Menyimpan…");
    try {
      const res = await fetch(`/api/pendaftar/${p.id}/daftar-ulang`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Gagal mengonfirmasi daftar ulang.");
      Dialog.toast("Daftar ulang terkonfirmasi. Surat Keterangan Diterima sudah bisa dicetak.");
      await renderStatusView();
    } catch (err) {
      pulih();
      Dialog.galat(err instanceof TypeError ? "Tidak dapat terhubung ke server." : err.message);
      await renderStatusView();
    }
  });
}

/* ---------- Data diri di halaman Status: bisa diperbaiki selama berkas belum Lengkap ---------- */
const bisaUbahDataDiri = (p) => p.status_global === "Aktif" && p.status_berkas !== "Lengkap";

function dataDiriHTML(p) {
  const tglLahir = p.tanggal_lahir ? new Date(p.tanggal_lahir + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "-";
  const perluPerbaiki = p.status_berkas === "Kurang Lengkap";
  return `
    <div class="data-diri ${perluPerbaiki ? "perlu" : ""}" id="data-diri">
      <div class="data-diri-kepala">
        <strong>Data diri</strong>
        ${bisaUbahDataDiri(p) ? `<button type="button" class="btn ${perluPerbaiki ? "btn-accent" : "btn-outline"}" id="btn-ubah-data">${ikon("pensil")} Perbaiki data diri</button>` : ""}
      </div>
      <dl class="data-diri-isi" id="data-diri-lihat">
        <div><dt>NIK</dt><dd>${esc(p.nik)}</dd></div>
        <div><dt>Tanggal lahir</dt><dd>${esc(tglLahir)}</dd></div>
        <div class="penuh"><dt>Alamat</dt><dd>${esc(p.alamat || "-")}</dd></div>
      </dl>
      <form class="data-diri-form" id="form-data-diri" hidden novalidate>
        <label>Nama lengkap (sesuai akta)<input name="nama" required minlength="3" maxlength="100" value="${esc(p.nama)}" autocomplete="name" /></label>
        <label>NIK (16 digit, sesuai KK)<input name="nik" required inputmode="numeric" maxlength="20" value="${esc(p.nik)}" /></label>
        <label>Tanggal lahir<input name="tanggalLahir" type="date" required value="${esc(String(p.tanggal_lahir || "").slice(0, 10))}" /></label>
        <label class="penuh">Alamat rumah (sesuai KK)<textarea name="alamat" rows="2" maxlength="300">${esc(p.alamat || "")}</textarea></label>
        <p class="data-diri-info penuh">${ikon("info")} Perubahan dicatat dan diperiksa ulang panitia. Lokasi GPS dan pilihan sekolah tidak berubah.</p>
        <div class="data-diri-tombol penuh">
          <button type="button" class="btn btn-outline" id="btn-batal-data">Batal</button>
          <button type="submit" class="btn btn-primary">Simpan perbaikan</button>
        </div>
      </form>
    </div>`;
}

function pasangDataDiri(p) {
  const form = document.getElementById("form-data-diri");
  const lihat = document.getElementById("data-diri-lihat");
  const tombol = document.getElementById("btn-ubah-data");
  if (!form || !tombol) return;
  const tampilForm = (buka) => {
    form.hidden = !buka; lihat.hidden = buka; tombol.hidden = buka;
    if (buka) form.nik.focus();
  };
  tombol.addEventListener("click", () => tampilForm(true));
  document.getElementById("btn-batal-data").addEventListener("click", () => { form.reset(); tampilForm(false); });
  form.nik.addEventListener("input", () => {
    const n = form.nik.value.replace(/\s+/g, "");
    form.nik.setCustomValidity(/^\d{16}$/.test(n) ? "" : "NIK harus 16 digit angka.");
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    form.nik.dispatchEvent(new Event("input"));
    if (!form.reportValidity()) return;
    const kirim = form.querySelector('button[type="submit"]');
    kirim.disabled = true; kirim.innerText = "Menyimpan…";
    try {
      const res = await fetch(`/api/pendaftar/${p.id}/data-diri`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nama: form.nama.value, nik: form.nik.value, tanggalLahir: form.tanggalLahir.value, alamat: form.alamat.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Gagal menyimpan perbaikan.");
      Dialog.toast(p.status_berkas === "Kurang Lengkap"
        ? "Perbaikan tersimpan. Pendaftaran kembali ke antrean verifikasi panitia."
        : "Perbaikan data diri tersimpan.");
      await renderStatusView();
    } catch (err) {
      Dialog.toast(err instanceof TypeError ? "Tidak dapat terhubung ke server." : err.message, "peringatan");
      kirim.disabled = false; kirim.innerText = "Simpan perbaikan";
    }
  });
}

/** FR-11: kotak estimasi posisi sementara di kartu pilihan yang sedang diproses */
function estimasiHTML(e) {
  if (!e) return "";
  const catatan = `<div class="est-catatan">Estimasi sementara, dapat berubah karena pendaftar baru, hasil verifikasi berkas, dan koreksi nilai. Hasil resmi ditentukan saat seleksi setelah pendaftaran ditutup.</div>`;
  if (e.menungguSkor) {
    return `<div class="pj-estimasi"><div class="est-judul">Estimasi peringkat</div>Muncul setelah panitia memberi skor dari sertifikat prestasi Anda.</div>`;
  }
  if (!e.memenuhiSyarat) {
    return `<div class="pj-estimasi luar"><div class="est-judul">${ikon("peringatan")} Saat ini belum memenuhi syarat jalur</div>${esc(e.alasan)}. Jika tetap begitu saat seleksi, pendaftaran otomatis dialihkan ke pilihan berikutnya.${catatan}</div>`;
  }
  const dasar = e.jenis === "prestasi_akademik" || e.jenis === "prestasi_nonakademik" ? "skor tertinggi" : "jarak terdekat";
  const lebar = e.jumlahPesaing ? Math.max(6, Math.round(((e.jumlahPesaing - e.posisi + 1) / e.jumlahPesaing) * 100)) : 0;
  const kalimat = e.sisaKuota === 0
    ? "Kuota jalur ini sudah penuh dari seleksi sebelumnya."
    : e.masukKuota
      ? `Posisi Anda saat ini <strong>masih di dalam kuota</strong> (${e.sisaKuota} kursi tersisa).`
      : `Posisi Anda saat ini <strong>di luar kuota</strong> (${e.sisaKuota} kursi tersisa). Jika tidak masuk saat seleksi, pendaftaran otomatis dialihkan ke pilihan berikutnya.`;
  return `<div class="pj-estimasi ${e.masukKuota ? "masuk" : "luar"}">
      <div class="est-atas">
        <div><div class="est-judul">Estimasi peringkat sementara</div><div class="est-dasar">diurutkan berdasarkan ${dasar}</div></div>
        <div class="est-angka">#${e.posisi}<span> dari ${e.jumlahPesaing}</span></div>
      </div>
      <div class="est-batang" aria-hidden="true"><span style="width:${lebar}%"></span></div>
      <div>${kalimat}</div>${catatan}
    </div>`;
}

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
  const { pendaftar, pilihan, riwayat, notifikasi, dokumen, estimasi, jenisDokumen: jenisDariServer } = await res.json();
  const jenisDokumen = Array.isArray(jenisDariServer) && jenisDariServer.length ? jenisDariServer : DOKUMEN_DASAR;
  const jumlahBerkas = (dokumen || []).filter((d) => jenisDokumen.includes(d.jenis)).length;

  let terkunci = null;
  if (pendaftar.status_global !== "Aktif") terkunci = "Pendaftaran selesai";
  else if (pendaftar.status_berkas === "Lengkap") terkunci = "Sudah diverifikasi";

  let statusBanner = "";
  if (pendaftar.status_global === "Diterima Final") {
    statusBanner = `<div class="badge-final-accept">Diterima di ${esc(sekolahNama(pendaftar.sekolah_aktif_id))}</div>${daftarUlangHTML(pendaftar)}`;
  } else if (pendaftar.status_global === "Tidak Daftar Ulang") {
    statusBanner = `<div class="badge-final-reject">Kursi di ${esc(sekolahNama(pendaftar.sekolah_aktif_id))} dilepas karena daftar ulang tidak dikonfirmasi${pendaftar.daftar_ulang_batas_at ? ` sampai ${esc(formatWaktuWIB(pendaftar.daftar_ulang_batas_at))}` : ""}.</div>`;
  } else if (pendaftar.status_global === "Tidak Diterima Final") {
    statusBanner = `<div class="badge-final-reject">Tidak diterima di seluruh pilihan sekolah</div>`;
  } else if (pendaftar.status_berkas === "Kurang Lengkap") {
    statusBanner = `<div class="alert alert-error" style="background:#fff7ed;color:#c2410c;border-color:#fed7aa">
      <strong>${ikon("peringatan")} Berkas Anda Kurang Lengkap</strong> di ${esc(sekolahNama(pendaftar.sekolah_aktif_id))}.
      ${pendaftar.catatan_revisi ? `<br/>Catatan panitia: <em>${esc(pendaftar.catatan_revisi)}</em>` : ""}
      ${pendaftar.batas_revisi_at ? `<br/>Perbaiki paling lambat <strong>${esc(formatWaktuWIB(pendaftar.batas_revisi_at))}</strong>: jika yang salah isian data (mis. NIK), tekan <strong>Perbaiki data diri</strong> di atas; jika berkasnya, unggah ulang di bagian <strong>Berkas Pendaftaran</strong>. Jika lewat batas waktu, pendaftaran otomatis dialihkan ke pilihan berikutnya.` : ""}
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
            ${kelas === "aktif" ? estimasiHTML(estimasi) : ""}
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
      ${dataDiriHTML(pendaftar)}
    </div>
    ${renderProgres(pendaftar, jumlahBerkas, jenisDokumen.length)}
    <h3 class="sub-heading" style="margin-top:4px">Perjalanan Pilihan Sekolah</h3>
    <ol class="perjalanan">${perjalananHTML}</ol>
    <h3 class="sub-heading" style="margin-top:0">Berkas Pendaftaran</h3>
    <p class="muted" style="margin:-4px 0 10px;font-size:12.5px">PDF/JPG/PNG, maks 5MB. Berkas dapat diganti selama belum diverifikasi Lengkap oleh panitia.</p>
    <div id="status-upload-list"></div>
    <h3 class="sub-heading">Riwayat Notifikasi</h3>
    <ul class="timeline">${notifItems || '<li class="timeline-item">Belum ada notifikasi.</li>'}</ul>
  `;

  pasangDataDiri(pendaftar);
  pasangDaftarUlang(pendaftar);
  renderUploadList("status-upload-list", "status", pendaftar.id, dokumen || [], {
    jenisDokumen,
    keteranganKhusus: keteranganBerkasKhusus(pilihan.map((p) => ({ urutan: p.urutan_prioritas, sekolah: p.sekolah_nama, jenis: p.jalur_jenis }))),
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
  { kunci: "Tidak Diterima Final", label: "Tidak diterima", cocok: (p) => p.status_global === "Tidak Diterima Final" || p.status_global === "Tidak Daftar Ulang" },
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
