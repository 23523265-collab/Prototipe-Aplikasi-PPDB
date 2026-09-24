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
  document.getElementById("panitia-login-wrap").style.display = loggedIn ? "none" : "flex";
  document.getElementById("panitia-view-wrap").style.display = loggedIn ? "block" : "none";
  document.getElementById("btn-logout-panitia").style.display = loggedIn ? "inline-block" : "none";
  document.getElementById("panitia-nama-label").innerText = loggedIn
    ? `${sesi.panitia.nama} · ${sekolahNama(sesi.panitia.sekolahId)}`
    : "";
  if (!loggedIn) return;

  const sekolahId = sesi.panitia.sekolahId;
  const antrean = await fetch(`/api/sekolah/${sekolahId}/antrean`).then((r) => r.json());
  antreanData = antrean;
  const tbody = document.querySelector("#table-panitia tbody");
  tbody.innerHTML = antrean.length
    ? antrean.map((a) => {
        const peringatan = [];
        if (a.catatan_validasi_nik) peringatan.push(`NIK: ${a.catatan_validasi_nik}`);
        if (a.catatan_validasi_alamat) peringatan.push(`Alamat: ${a.catatan_validasi_alamat}`);
        (a.dokumen || []).forEach((d) => {
          if (d.catatan_validasi) peringatan.push(`${d.jenis}: ${d.catatan_validasi}`);
        });
        const peringatanHTML = peringatan.length
          ? `<ul style="margin:0;padding-left:16px;font-size:11.5px;color:#b45309">${peringatan.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`
          : '<span style="font-size:12px;color:#047857">✓ Tidak ada</span>';
        return `
        <tr>
          <td>${esc(a.nomor)}</td>
          <td><strong>${esc(a.nama)}</strong></td>
          <td>${a.prioritas_aktif}</td>
          <td>${esc(a.jalur_nama)}${infoJarak(a)}</td>
          <td>${a.skor}${a.syarat_radius_km != null
            ? `<br/><span style="font-size:11px;color:var(--muted)" title="Zonasi diurutkan berdasarkan jarak terdekat; skor = 100 − 10 × km">dari jarak</span>`
            : infoNilai(a)}</td>
          <td>${pillHTML(a.status_berkas)}${infoRevisi(a)}</td>
          <td>${(a.dokumen || []).length ? a.dokumen.map((d) => `<a href="${safeUrl(d.url)}" target="_blank" rel="noopener" style="font-size:12px">${esc(d.jenis)}</a>`).join("<br/>") : '<span style="font-size:12px;color:var(--muted)">Belum ada</span>'}
            <br/><button class="action-btn btn-lokasi" style="margin-top:6px" onclick="bukaLokasi(${a.pendaftar_id})">📍 Lokasi Rumah</button></td>
          <td>${peringatanHTML}</td>
          <td>
            <button class="action-btn action-lengkap" onclick="verifikasi(${a.pendaftar_id}, 'Lengkap')">Lengkap</button>
            <button class="action-btn action-kurang" onclick="tandaiKurang(${a.pendaftar_id})">Kurang</button>
            <button class="action-btn action-tolak" onclick="verifikasi(${a.pendaftar_id}, 'Ditolak')">Tolak</button>
            <br/><button class="action-btn btn-lokasi" style="margin-top:6px" onclick="koreksiNilai(${a.pendaftar_id})">✎ Nilai Rapor</button>
          </td>
        </tr>
      `;
      }).join("")
    : `<tr><td colspan="9" style="text-align:center;color:var(--muted)">Belum ada pendaftar aktif di sekolah ini.</td></tr>`;

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
    ? '<p class="muted" style="font-size:12.5px;margin-top:4px">🔒 Seleksi baru bisa dijalankan setelah pendaftaran ditutup (lihat kotak Tahapan PPDB di atas).</p>'
    : "");
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
        <span>👥 Peminat <strong>${j.peminat}</strong></span>
        <span>⏱ Verifikasi <strong>${j.menunggu_verifikasi}</strong></span>
        <span>📋 Siap seleksi <strong>${j.menunggu_seleksi}</strong></span>
        <span>— Cadangan <strong>${j.cadangan}</strong></span>
        <span>✕ Ditolak <strong>${j.ditolak}</strong></span>
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
      <div class="tahapan-status ${t.dibuka ? "buka" : "tutup"}">${t.dibuka ? "🟢 Pendaftaran DIBUKA — seleksi belum bisa dijalankan" : "🔒 Pendaftaran DITUTUP — seleksi dapat dijalankan"}</div>
      ${info}
    </div>
    <span class="muted" style="margin:0;font-size:12.5px">🏛 Buka/tutup pendaftaran diatur oleh <strong>Admin Dinas</strong>.</span>`;
}


// Masa revisi berkas "Kurang Lengkap": batas waktu + catatan panitia
function infoRevisi(a) {
  if (a.status_berkas !== "Kurang Lengkap" || !a.batas_revisi_at) return "";
  return `<br/><span style="font-size:11px;color:#c2410c">⏳ revisi s/d ${esc(formatWaktuWIB(a.batas_revisi_at))}</span>` +
    (a.catatan_revisi ? `<br/><span style="font-size:11px;color:var(--muted)">"${esc(a.catatan_revisi)}"</span>` : "");
}

async function tandaiKurang(pendaftarId) {
  const a = antreanData.find((x) => x.pendaftar_id === pendaftarId);
  const catatan = prompt(
    `Tandai berkas ${a ? a.nama : ""} sebagai Kurang Lengkap.

Pendaftar diberi waktu 2×24 jam untuk mengunggah ulang. Tulis apa yang perlu diperbaiki (akan dikirim ke pendaftar):`,
    ""
  );
  if (catatan === null) return;
  await verifikasi(pendaftarId, "Kurang Lengkap", catatan);
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
  const input = prompt(
    `Koreksi nilai rapor untuk ${a.nama} (${a.nomor}).

Nilai saat ini: ${a.nilai_rapor ?? "belum diisi"}${a.nilai_rapor_awal != null && a.nilai_rapor_dikoreksi_oleh ? ` (isian awal pendaftar: ${a.nilai_rapor_awal})` : ""}
Cocokkan dengan berkas rapor, lalu masukkan nilai yang benar (0–100):`,
    a.nilai_rapor ?? ""
  );
  if (input === null || input.trim() === "") return;

  const res = await fetch(`/api/pendaftar/${pendaftarId}/nilai-rapor`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nilaiRapor: Number(input.replace(",", ".")) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    await renderPanitiaView();
    await alertSetelahRender(data.error || "Gagal mengoreksi nilai.");
    return;
  }
  await renderPanitiaView();
  await alertSetelahRender(`Nilai rapor diperbarui. ${data.pilihanDiperbarui} pilihan jalur Prestasi ikut diperbarui skornya, dan pendaftar sudah diberi notifikasi.`);
}

// Jarak rumah–sekolah untuk jalur zonasi, merah bila di luar radius
function infoJarak(a) {
  if (a.syarat_radius_km == null) return "";
  if (a.jarak_km == null) {
    return `<br/><span style="font-size:11.5px;color:#b91c1c">⚠ ${esc(a.catatan_skor || "Lokasi tidak tersedia")}</span>`;
  }
  const diLuar = Number(a.jarak_km) > Number(a.syarat_radius_km);
  return `<br/><span style="font-size:11.5px;color:${diLuar ? "#b91c1c" : "#047857"}">📍 ${Number(a.jarak_km).toFixed(2)} km / radius ${a.syarat_radius_km} km${diLuar ? " — di luar radius" : ""}</span>`;
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
    : `± ${akurasi} m${akurasi > 100 ? ' <span style="color:#b45309">⚠ kurang akurat</span>' : ""}`;
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
        ? `<span style="color:#b45309">⚠ ${esc(a.catatan_validasi_alamat)}</span>`
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
document.addEventListener("keydown", (e) => { if (e.key === "Escape") tutupLokasi(); });

// alert() menahan browser menggambar ulang layar -- tunggu tabel terbaru tampil dulu, baru munculkan pesan
function alertSetelahRender(pesan) {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(() => { alert(pesan); resolve(); }, 0)));
}

async function verifikasi(pendaftarId, status, catatan = null) {
  const res = await fetch(`/api/pendaftar/${pendaftarId}/berkas`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, catatan }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    await renderPanitiaView(); // data di layar mungkin sudah berubah (mis. pendaftar sudah dialihkan)
    await alertSetelahRender(data.error || "Gagal memverifikasi.");
    return;
  }
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
    await renderPanitiaView();
    if (data.jumlahDiproses === 0) {
      await alertSetelahRender("Tidak ada kandidat yang siap diseleksi di jalur ini.\n\nSeleksi hanya memproses pendaftar yang berkasnya sudah diverifikasi \"Lengkap\". Verifikasi berkas di tabel antrean terlebih dahulu.");
    } else {
      await alertSetelahRender(`Seleksi selesai — ${data.jumlahDiproses} kandidat diproses (sisa kuota sebelum seleksi: ${data.sisaKuotaSebelum} dari ${data.kuota}):\n\n✓ Diterima: ${data.diterima}\n✕ Tidak memenuhi syarat (radius/nilai/lokasi): ${data.ditolakSyarat}\n✕ Tidak masuk kuota: ${data.ditolakKuota}\n\nPendaftar yang ditolak otomatis dialihkan ke pilihan berikutnya.`);
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = btn.dataset.originalText;
    }
  }
}

init();
