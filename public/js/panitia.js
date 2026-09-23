let sekolahList = [];
let jalurList = [];
let sesi = { panitia: null };

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
  return `<span class="pill ${cls}">${icon} ${status}</span>`;
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
    : `<tr><td colspan="9" style="text-align:center;color:var(--muted)">Belum ada pendaftar aktif di sekolah ini.</td></tr>`;

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
    alert(`Seleksi dijalankan. ${data.jumlahDiproses} pendaftar diproses pada jalur ini.`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = btn.dataset.originalText;
    }
  }
}

init();
