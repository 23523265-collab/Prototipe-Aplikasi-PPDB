/* =========================================================
   Dialog & toast -- pengganti alert() / confirm() / prompt() bawaan browser.
   Tampil sesuai desain SiPPDB, tidak memblokir browser menggambar ulang layar,
   dan bisa berisi input (catatan revisi, nilai rapor, password baru).
   Dipakai di situs pendaftar, panel panitia, dan Admin Dinas.
   ========================================================= */
const Dialog = (() => {
  const escD = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Ikon SVG dari ikon.js bila dimuat; kalau tidak, pakai karakter biasa
  const pakaiSvg = typeof ikon === "function";
  const IKON = pakaiSvg
    ? { info: ikon("info"), sukses: ikon("centang"), peringatan: ikon("peringatan"), bahaya: ikon("seru") }
    : { info: "i", sukses: "✓", peringatan: "!", bahaya: "!" };

  /**
   * opsi: { judul, pesan (teks biasa, \n = baris baru), html (isi HTML yang sudah aman),
   *         jenis: info|sukses|peringatan|bahaya, bahaya: true = tombol OK merah (aksi berisiko), tombolOk, tombolBatal (null = tanpa tombol batal),
   *         input: { tipe, nilai, placeholder, multiline, wajib, min, max, step } }
   * Hasil: true/false (tanpa input), atau string/null (dengan input).
   */
  function buka(opsi) {
    const { judul = "", pesan = "", html = "", jenis = "info", tombolOk = "OK", tombolBatal = null, input = null, bahaya = false } = opsi;
    return new Promise((resolve) => {
      const kembaliFokus = document.activeElement;
      const latar = document.createElement("div");
      latar.className = "dlg-latar";
      const idInput = "dlg-input-" + Date.now();
      const inputHTML = !input ? "" : input.multiline
        ? `<textarea id="${idInput}" class="dlg-input" rows="3" placeholder="${escD(input.placeholder)}">${escD(input.nilai)}</textarea>`
        : `<input id="${idInput}" class="dlg-input" type="${escD(input.tipe || "text")}" value="${escD(input.nilai)}" placeholder="${escD(input.placeholder)}"
             ${input.min != null ? `min="${escD(input.min)}"` : ""} ${input.max != null ? `max="${escD(input.max)}"` : ""} ${input.step != null ? `step="${escD(input.step)}"` : ""} />`;
      latar.innerHTML = `
        <div class="dlg-kotak dlg-${escD(jenis)}" role="dialog" aria-modal="true" aria-labelledby="dlg-judul">
          <div class="dlg-kepala">
            <span class="dlg-ikon">${IKON[jenis] || IKON.info}</span>
            <h3 id="dlg-judul">${escD(judul)}</h3>
          </div>
          <div class="dlg-isi">${html || `<p>${escD(pesan)}</p>`}</div>
          ${inputHTML ? `<label class="dlg-label" for="${idInput}">${inputHTML}</label><div class="dlg-galat"></div>` : ""}
          <div class="dlg-aksi">
            ${tombolBatal ? `<button type="button" class="btn btn-outline" data-aksi="batal">${escD(tombolBatal)}</button>` : ""}
            <button type="button" class="btn ${bahaya ? "btn-bahaya" : "btn-primary"}" data-aksi="ok">${escD(tombolOk)}</button>
          </div>
        </div>`;
      document.body.appendChild(latar);
      document.body.classList.add("dlg-terbuka");
      requestAnimationFrame(() => latar.classList.add("tampil"));

      const elInput = latar.querySelector(".dlg-input");
      const elGalat = latar.querySelector(".dlg-galat");
      (elInput || latar.querySelector('[data-aksi="ok"]')).focus();
      if (elInput && !input.multiline) elInput.select?.();

      function tutup(hasil) {
        document.removeEventListener("keydown", tombolKeyboard, true);
        latar.classList.remove("tampil");
        setTimeout(() => {
          latar.remove();
          if (!document.querySelector(".dlg-latar")) document.body.classList.remove("dlg-terbuka");
        }, 160);
        kembaliFokus?.focus?.();
        resolve(hasil);
      }
      function ok() {
        if (!input) return tutup(true);
        const nilai = elInput.value.trim();
        if (input.wajib && !nilai) {
          elGalat.textContent = "Wajib diisi.";
          elInput.focus();
          return;
        }
        tutup(nilai);
      }
      const batal = () => tutup(input ? null : false);
      function tombolKeyboard(e) {
        if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); tombolBatal ? batal() : tutup(input ? null : true); }
        if (e.key === "Enter" && !(e.target.tagName === "TEXTAREA") && e.target.dataset.aksi !== "batal") { e.preventDefault(); ok(); }
      }
      document.addEventListener("keydown", tombolKeyboard, true);
      latar.querySelector('[data-aksi="ok"]').onclick = ok;
      const btnBatal = latar.querySelector('[data-aksi="batal"]');
      if (btnBatal) btnBatal.onclick = batal;
      latar.addEventListener("mousedown", (e) => { if (e.target === latar && tombolBatal) batal(); });
    });
  }

  /** Pesan singkat di pojok layar yang hilang sendiri (untuk aksi yang berhasil). */
  function toast(pesan, jenis = "sukses") {
    let wadah = document.querySelector(".toast-wadah");
    if (!wadah) {
      wadah = document.createElement("div");
      wadah.className = "toast-wadah";
      wadah.setAttribute("role", "status");
      document.body.appendChild(wadah);
    }
    const el = document.createElement("div");
    el.className = `toast toast-${jenis}`;
    el.innerHTML = `<span class="dlg-ikon">${IKON[jenis] || IKON.info}</span><span>${escD(pesan)}</span>`;
    wadah.appendChild(el);
    requestAnimationFrame(() => el.classList.add("tampil"));
    setTimeout(() => { el.classList.remove("tampil"); setTimeout(() => el.remove(), 250); }, 4200);
  }

  return {
    info: (pesan, o = {}) => buka({ judul: "Informasi", ...o, pesan }),
    galat: (pesan, o = {}) => buka({ judul: "Tidak dapat diproses", jenis: "bahaya", ...o, pesan }),
    konfirmasi: (pesan, o = {}) => buka({ judul: "Konfirmasi", tombolOk: "Ya, lanjutkan", tombolBatal: "Batal", ...o, pesan }),
    isian: (pesan, input = {}, o = {}) => buka({ judul: "Isi data", tombolOk: "Simpan", tombolBatal: "Batal", ...o, pesan, input }),
    buka,
    toast,
  };
})();
