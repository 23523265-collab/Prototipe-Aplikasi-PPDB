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
  const pulih = Dialog.sibuk(form.querySelector("button[type=submit]"), "Masuk…");
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
  } finally {
    pulih();
  }
});

document.getElementById("btn-logout-admin").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  await render();
});

async function render() {
  const sesi = await fetch("/api/auth/me").then((r) => r.json());
  const masuk = !!sesi.admin;
  document.getElementById("memuat-halaman").style.display = "none";
  document.getElementById("admin-login-wrap").style.display = masuk ? "none" : "flex";
  document.getElementById("admin-view-wrap").style.display = masuk ? "block" : "none";
  document.getElementById("btn-logout-admin").style.display = masuk ? "inline-block" : "none";
  document.getElementById("admin-nama-label").innerText = masuk ? sesi.admin.nama : "";
  if (!masuk) return;

  try {
    ringkasan = await api("/api/admin/ringkasan");
  } catch (err) {
    Dialog.galat(pesanKoneksi(err));
    return;
  }
  renderTahapan(ringkasan.tahapan);
  renderTotal(ringkasan.total);
  renderSekolah(ringkasan.sekolah);
  isiFilterLog(ringkasan.sekolah);
  if (document.getElementById("log-admin").open) muatLogAdmin();
}

/* =========================================================
   LOG AKTIVITAS (jejak audit, migration v7.3)
   ========================================================= */
function isiFilterLog(daftar) {
  const pilih = document.getElementById("log-filter-sekolah");
  const nilai = pilih.value;
  pilih.innerHTML = '<option value="">Semua sekolah</option>' + daftar.map((s) => `<option value="${s.id}">${esc(s.nama)}</option>`).join("");
  pilih.value = nilai;
}

async function muatLogAdmin() {
  const kotak = document.getElementById("log-admin-isi");
  kotak.innerHTML = '<div class="kerangka" style="height:60px"></div>';
  const sekolah = document.getElementById("log-filter-sekolah").value;
  try {
    const daftar = await api(`/api/admin/log-aktivitas${sekolah ? `?sekolah=${sekolah}` : ""}`);
    kotak.innerHTML = daftar.length ? `<ul class="log-daftar">${daftar.map((l) => `
      <li>
        <div class="log-waktu">${esc(formatWaktuWIB(l.waktu))}</div>
        <div class="log-isi">
          <strong>${esc(l.aksi)}</strong>${l.detail ? ` <span class="log-detail">· ${esc(l.detail)}</span>` : ""}
          <div class="log-meta">${l.aktor_tipe === "admin" ? "Admin Dinas · " : l.aktor_tipe === "pendaftar" ? "Pendaftar · " : ""}${esc(l.aktor)}${l.sekolah_nama ? ` · ${esc(l.sekolah_nama)}` : ""}${l.pendaftar_nomor ? ` · ${esc(l.pendaftar_nomor)}` : ""}</div>
        </div>
      </li>`).join("")}</ul>` : '<p class="muted" style="margin:0;font-size:13px">Belum ada aktivitas tercatat.</p>';
  } catch (err) {
    kotak.innerHTML = `<p class="muted" style="margin:0;font-size:13px">${esc(pesanKoneksi(err))}</p>`;
  }
}
document.getElementById("log-admin").addEventListener("toggle", (e) => { if (e.target.open) muatLogAdmin(); });
document.getElementById("log-filter-sekolah").addEventListener("change", muatLogAdmin);

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
      <div class="tahapan-status ${t.dibuka ? "buka" : "tutup"}">${t.dibuka ? ikon("gembokBuka") + " Pendaftaran DIBUKA — seleksi belum bisa dijalankan" : ikon("gembok") + " Pendaftaran DITUTUP — panitia dapat menjalankan seleksi"}</div>
      ${t.diubahOleh ? `<div class="muted" style="margin:4px 0 0;font-size:12px">Terakhir diubah oleh ${esc(t.diubahOleh)} · ${esc(formatWaktuWIB(t.diubahAt))}</div>` : ""}
    </div>
    <button class="btn ${t.dibuka ? "btn-primary" : "btn-outline"}" onclick="ubahTahapan(${!t.dibuka}, this)">
      ${t.dibuka ? "Tutup Pendaftaran" : "Buka Kembali Pendaftaran"}
    </button>`;
}

async function ubahTahapan(dibuka, btn) {
  const ya = await Dialog.konfirmasi(
    dibuka
      ? "Pendaftar baru bisa mendaftar lagi, dan tombol seleksi di semua sekolah dikunci sampai pendaftaran ditutup kembali."
      : "Pendaftar baru tidak bisa mendaftar, dan panitia semua sekolah bisa mulai menjalankan seleksi.",
    { judul: dibuka ? "Buka kembali pendaftaran?" : "Tutup pendaftaran?", jenis: "peringatan", tombolOk: dibuka ? "Ya, buka" : "Ya, tutup" }
  );
  if (!ya) return;
  const teksAsli = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="border-color:rgba(27,51,88,0.25);border-top-color:#1B3358"></span>Memproses…';
  try {
    await api("/api/tahapan", { method: "PATCH", body: JSON.stringify({ dibuka }) });
    await render();
    Dialog.toast(dibuka ? "Pendaftaran dibuka kembali." : "Pendaftaran ditutup. Panitia dapat menjalankan seleksi.");
  } catch (err) {
    Dialog.galat(pesanKoneksi(err));
    btn.disabled = false;
    btn.innerHTML = teksAsli;
  }
}

/* =========================================================
   RINGKASAN & SEKOLAH
   ========================================================= */
function renderTotal(t) {
  document.getElementById("admin-total").innerHTML = `
    <div class="stat-card"><span class="stat-ico">${ikon("orang")}</span><div class="stat-num">${t.pendaftar}</div><div class="stat-label">Total pendaftar</div></div>
    <div class="stat-card"><span class="stat-ico">${ikon("jam")}</span><div class="stat-num" style="color:var(--amber)">${t.aktif}</div><div class="stat-label">Masih diproses</div></div>
    <div class="stat-card"><span class="stat-ico">${ikon("diterima")}</span><div class="stat-num" style="color:#047857">${t.diterima}</div><div class="stat-label">Diterima</div></div>
    <div class="stat-card"><span class="stat-ico">${ikon("sekolah")}</span><div class="stat-num">${t.sekolah}</div><div class="stat-label">Sekolah</div></div>`;
}

/*
 * Batas porsi kuota per jalur SPMB, dalam persen dari total kursi sekolah.
 * Hanya dipakai untuk PERINGATAN (kuota tetap bebas diatur Admin Dinas).
 * CEK dan sesuaikan angka ini dengan regulasi SPMB resmi yang berlaku.
 */
const PORSI_SPMB = {
  domisili: { min: 30 },
  afirmasi: { min: 30 },
  mutasi: { maks: 5 },
};
const LABEL_JALUR = { domisili: "Domisili", afirmasi: "Afirmasi", mutasi: "Mutasi", prestasi_akademik: "Prestasi Akademik", prestasi_nonakademik: "Prestasi Nonakademik" };
const URUTAN_JALUR = Object.keys(LABEL_JALUR);

/** Hitung porsi tiap jalur dari angka kuota yang sedang diketik di satu baris, lalu tampilkan peringatan. */
function perbaruiPorsi(sekolahId) {
  const baris = document.querySelector(`tr[data-sekolah="${sekolahId}"]`);
  const kuota = {};
  baris.querySelectorAll('input[data-field="kuota"]').forEach((inp) => { kuota[inp.dataset.jenis] = Math.max(0, Number(inp.value) || 0); });
  const total = Object.values(kuota).reduce((a, b) => a + b, 0);
  const persen = (j) => (total ? Math.round(((kuota[j] || 0) / total) * 100) : 0);
  const peringatan = [];
  for (const [jenis, batas] of Object.entries(PORSI_SPMB)) {
    if (!(jenis in kuota)) continue;
    if (batas.min != null && persen(jenis) < batas.min) peringatan.push(`${LABEL_JALUR[jenis]} ${persen(jenis)}% (min. ${batas.min}%)`);
    if (batas.maks != null && persen(jenis) > batas.maks) peringatan.push(`${LABEL_JALUR[jenis]} ${persen(jenis)}% (maks. ${batas.maks}%)`);
  }
  baris.querySelector(".porsi-sel").innerHTML = `
    <strong>${total} kursi</strong>
    <div class="porsi-rinci">${URUTAN_JALUR.filter((j) => j in kuota).map((j) => `${LABEL_JALUR[j].split(" ").map((k) => k[0]).join("")} ${persen(j)}%`).join(" · ")}</div>
    ${peringatan.length
      ? `<div class="porsi-peringatan">${ikon("peringatan")} ${esc(peringatan.join("; "))}</div>`
      : total ? `<div class="porsi-ok">${ikon("centang")} Porsi sesuai</div>` : ""}`;
}

function renderSekolah(daftar) {
  const tbody = document.querySelector("#tabel-sekolah tbody");
  tbody.innerHTML = daftar.map((s) => {
    const jalur = (jenis) => s.jalur.find((j) => j.jenis === jenis);
    // Satu sel per jalur: kuota (+ radius untuk domisili, + nilai minimum untuk prestasi akademik) dan kursi terisi
    const sel = (jenis) => {
      const j = jalur(jenis);
      if (!j) return "<td>-</td>";
      const ekstra = jenis === "domisili"
        ? `<input type="number" min="0.1" step="0.1" data-jalur="${j.jalur_id}" data-field="syarat_radius_km" value="${esc(j.syarat_radius_km)}" title="Radius domisili (km)" aria-label="Radius domisili ${esc(s.nama)}" />`
        : jenis === "prestasi_akademik"
          ? `<input type="number" min="0" max="100" data-jalur="${j.jalur_id}" data-field="syarat_nilai_minimum" value="${esc(j.syarat_nilai_minimum)}" title="Nilai minimum" aria-label="Nilai minimum ${esc(s.nama)}" />`
          : "";
      return `<td>
        <div class="input-mini">
          <input type="number" min="0" data-jalur="${j.jalur_id}" data-jenis="${jenis}" data-field="kuota" value="${j.kuota}"
            title="Kuota ${LABEL_JALUR[jenis]}" aria-label="Kuota ${LABEL_JALUR[jenis]} ${esc(s.nama)}" oninput="perbaruiPorsi(${s.id})" />${ekstra}
        </div>
        <div class="terisi-mini">${j.diterima} diterima</div>
      </td>`;
    };
    const panitia = s.panitia.map((a) => `
      <div style="font-size:12.5px">${esc(a.username)}
        <button class="action-btn btn-lokasi" data-username="${esc(a.username)}" onclick="resetPasswordPanitia(${a.id}, this.dataset.username)">Reset password</button>
      </div>`).join("") || '<span class="muted" style="font-size:12px">Belum ada</span>';
    return `
    <tr data-sekolah="${s.id}">
      <td class="sel-sekolah"><strong>${esc(s.nama)}</strong><br/><span class="muted" style="font-size:11.5px;margin:0">${esc(s.alamat || "")}</span></td>
      ${URUTAN_JALUR.map(sel).join("")}
      <td class="porsi-sel"></td>
      <td>${panitia}</td>
      <td><button class="btn btn-accent" style="padding:6px 12px;font-size:13px" onclick="simpanSekolah(${s.id}, this)">Simpan</button></td>
    </tr>`;
  }).join("");
  daftar.forEach((s) => perbaruiPorsi(s.id));
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
    Dialog.toast("Perubahan kuota dan syarat tersimpan.");
  } catch (err) {
    Dialog.galat(pesanKoneksi(err));
    btn.disabled = false;
    btn.innerText = "Simpan";
  }
}

async function resetPasswordPanitia(panitiaId, username) {
  const baru = await Dialog.isian(
    "Minimal 6 karakter. Panitia akan diminta login ulang dengan password baru.",
    { tipe: "text", placeholder: "Password baru", wajib: true },
    { judul: `Reset password ${username}`, tombolOk: "Ganti password" }
  );
  if (baru === null) return;
  try {
    await api(`/api/admin/panitia/${panitiaId}/reset-password`, { method: "POST", body: JSON.stringify({ passwordBaru: baru }) });
    Dialog.toast(`Password ${username} berhasil diganti.`);
  } catch (err) {
    Dialog.galat(pesanKoneksi(err));
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
