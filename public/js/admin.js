const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const formatWaktuWIB = (d) =>
  new Date(d).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) + " WIB";
const pesanKoneksi = (err) => (err instanceof TypeError ? "Tidak dapat terhubung ke server. Periksa koneksi internet." : err.message);

let ringkasan = null;

/** fetch JSON dengan pesan error yang jelas (termasuk sesi habis) */
async function api(url, opsi = {}) {
  const res = await fetch(url, {
    ...opsi,
    headers: { "Content-Type": "application/json", ...(opsi.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("Sesi Admin Dinas sudah habis. Silakan login ulang.");
  if (!res.ok) throw new Error(data.error || "Terjadi kesalahan.");
  return data;
}

/* =========================================================
   LOGIN
   ========================================================= */
document.getElementById("form-login-admin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const errBox = document.getElementById("admin-login-error");
  try {
    await api("/api/auth/admin/login", {
      method: "POST",
      body: JSON.stringify({ username: form.username.value, password: form.password.value }),
    });
    errBox.style.display = "none";
    await render();
  } catch (err) {
    errBox.style.display = "block";
    errBox.innerText = pesanKoneksi(err);
  }
});

document.getElementById("btn-logout-admin").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  await render();
});

async function render() {
  const sesi = await fetch("/api/auth/me").then((r) => r.json());
  const masuk = !!sesi.admin;
  document.getElementById("admin-login-wrap").style.display = masuk ? "none" : "flex";
  document.getElementById("admin-view-wrap").style.display = masuk ? "block" : "none";
  document.getElementById("btn-logout-admin").style.display = masuk ? "inline-block" : "none";
  document.getElementById("admin-nama-label").innerText = masuk ? sesi.admin.nama : "";
  if (!masuk) return;

  try {
    ringkasan = await api("/api/admin/ringkasan");
  } catch (err) {
    alert(pesanKoneksi(err));
    return;
  }
  renderTahapan(ringkasan.tahapan);
  renderTotal(ringkasan.total);
  renderSekolah(ringkasan.sekolah);
}

/* =========================================================
   TAHAPAN (buka/tutup pendaftaran)
   ========================================================= */
function renderTahapan(t) {
  const box = document.getElementById("admin-tahapan");
  if (!t.aktif) {
    box.innerHTML = '<span class="muted" style="margin:0">Fitur tahapan belum aktif — jalankan migration v6.7.</span>';
    return;
  }
  box.innerHTML = `
    <div>
      <div class="tahapan-label">Tahapan PPDB <span class="muted" style="font-size:11.5px;margin:0">(berlaku untuk semua sekolah)</span></div>
      <div class="tahapan-status ${t.dibuka ? "buka" : "tutup"}">${t.dibuka ? "🟢 Pendaftaran DIBUKA — seleksi belum bisa dijalankan" : "🔒 Pendaftaran DITUTUP — panitia dapat menjalankan seleksi"}</div>
      ${t.diubahOleh ? `<div class="muted" style="margin:4px 0 0;font-size:12px">Terakhir diubah oleh ${esc(t.diubahOleh)} · ${esc(formatWaktuWIB(t.diubahAt))}</div>` : ""}
    </div>
    <button class="btn ${t.dibuka ? "btn-primary" : "btn-outline"}" onclick="ubahTahapan(${!t.dibuka}, this)">
      ${t.dibuka ? "Tutup Pendaftaran" : "Buka Kembali Pendaftaran"}
    </button>`;
}

async function ubahTahapan(dibuka, btn) {
  const pesan = dibuka
    ? "Buka kembali pendaftaran?\n\nPendaftar baru bisa mendaftar lagi, dan tombol seleksi di semua sekolah dikunci sampai pendaftaran ditutup kembali."
    : "Tutup pendaftaran?\n\nPendaftar baru tidak bisa mendaftar, dan panitia semua sekolah bisa mulai menjalankan seleksi.";
  if (!confirm(pesan)) return;
  const teksAsli = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="border-color:rgba(27,51,88,0.25);border-top-color:#1B3358"></span>Memproses…';
  try {
    await api("/api/tahapan", { method: "PATCH", body: JSON.stringify({ dibuka }) });
    await render();
  } catch (err) {
    alert(pesanKoneksi(err));
    btn.disabled = false;
    btn.innerHTML = teksAsli;
  }
}

/* =========================================================
   RINGKASAN & SEKOLAH
   ========================================================= */
function renderTotal(t) {
  document.getElementById("admin-total").innerHTML = `
    <div class="stat-card"><span class="stat-ico">👥</span><div class="stat-num">${t.pendaftar}</div><div class="stat-label">Total pendaftar</div></div>
    <div class="stat-card"><span class="stat-ico">⏱</span><div class="stat-num" style="color:var(--amber)">${t.aktif}</div><div class="stat-label">Masih diproses</div></div>
    <div class="stat-card"><span class="stat-ico">✅</span><div class="stat-num" style="color:#047857">${t.diterima}</div><div class="stat-label">Diterima</div></div>
    <div class="stat-card"><span class="stat-ico">🏫</span><div class="stat-num">${t.sekolah}</div><div class="stat-label">Sekolah</div></div>`;
}

function renderSekolah(daftar) {
  const tbody = document.querySelector("#tabel-sekolah tbody");
  tbody.innerHTML = daftar.map((s) => {
    const zonasi = s.jalur.find((j) => j.syarat_radius_km != null);
    const prestasi = s.jalur.find((j) => j.syarat_nilai_minimum != null);
    const terisi = s.jalur.map((j) => `${esc(j.nama)}: <strong>${j.diterima}</strong>/${j.kuota}`).join("<br/>");
    const panitia = s.panitia.map((a) => `
      <div style="font-size:12.5px">${esc(a.username)}
        <button class="action-btn btn-lokasi" onclick="resetPasswordPanitia(${a.id}, '${esc(a.username)}')">Reset password</button>
      </div>`).join("") || '<span class="muted" style="font-size:12px">Belum ada</span>';
    return `
    <tr data-sekolah="${s.id}">
      <td><strong>${esc(s.nama)}</strong><br/><span class="muted" style="font-size:11.5px;margin:0">${esc(s.alamat || "")}</span></td>
      <td>${zonasi ? `
        <div class="input-mini">
          <input type="number" min="0" data-jalur="${zonasi.jalur_id}" data-field="kuota" value="${zonasi.kuota}" title="Kuota zonasi" />
          <input type="number" min="0.1" step="0.1" data-jalur="${zonasi.jalur_id}" data-field="syarat_radius_km" value="${esc(zonasi.syarat_radius_km)}" title="Radius (km)" />
        </div>` : "-"}</td>
      <td>${prestasi ? `
        <div class="input-mini">
          <input type="number" min="0" data-jalur="${prestasi.jalur_id}" data-field="kuota" value="${prestasi.kuota}" title="Kuota prestasi" />
          <input type="number" min="0" max="100" data-jalur="${prestasi.jalur_id}" data-field="syarat_nilai_minimum" value="${esc(prestasi.syarat_nilai_minimum)}" title="Nilai minimum" />
        </div>` : "-"}</td>
      <td style="font-size:12.5px">${terisi}</td>
      <td>${panitia}</td>
      <td><button class="btn btn-accent" style="padding:6px 12px;font-size:13px" onclick="simpanSekolah(${s.id}, this)">Simpan</button></td>
    </tr>`;
  }).join("");
}

async function simpanSekolah(sekolahId, btn) {
  const baris = document.querySelector(`tr[data-sekolah="${sekolahId}"]`);
  const perJalur = {};
  baris.querySelectorAll("input[data-jalur]").forEach((inp) => {
    (perJalur[inp.dataset.jalur] ||= {})[inp.dataset.field] = inp.value;
  });
  btn.disabled = true;
  btn.innerText = "Menyimpan…";
  try {
    for (const [jalurId, nilai] of Object.entries(perJalur)) {
      await api(`/api/admin/jalur/${jalurId}`, { method: "PATCH", body: JSON.stringify(nilai) });
    }
    await render();
  } catch (err) {
    alert(pesanKoneksi(err));
    btn.disabled = false;
    btn.innerText = "Simpan";
  }
}

async function resetPasswordPanitia(panitiaId, username) {
  const baru = prompt(`Password baru untuk ${username} (minimal 6 karakter).\nPanitia akan diminta login ulang.`, "");
  if (baru === null) return;
  try {
    await api(`/api/admin/panitia/${panitiaId}/reset-password`, { method: "POST", body: JSON.stringify({ passwordBaru: baru }) });
    alert(`Password ${username} berhasil diganti.`);
  } catch (err) {
    alert(pesanKoneksi(err));
  }
}

document.getElementById("form-tambah-sekolah").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const info = document.getElementById("tambah-info");
  const btn = form.querySelector("button[type=submit]");
  const data = Object.fromEntries(new FormData(form).entries());
  btn.disabled = true;
  try {
    await api("/api/admin/sekolah", { method: "POST", body: JSON.stringify(data) });
    info.className = "alert alert-success";
    info.innerText = `${data.nama} berhasil ditambahkan. Akun panitia: ${data.usernamePanitia}.`;
    form.reset();
    await render();
  } catch (err) {
    info.className = "alert alert-error";
    info.innerText = pesanKoneksi(err);
  } finally {
    info.style.display = "block";
    btn.disabled = false;
  }
});

render();
