const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const supabase = require("./supabase");

const SESSION_DURATION_MS = 1000 * 60 * 60 * 8; // 8 jam

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compareSync(plain, hash);
}

/**
 * Sesi login disimpan di tabel `sesi` (Supabase), BUKAN di memori server.
 * Ini penting untuk lingkungan serverless (Vercel) karena tiap request
 * bisa dilayani instance server yang berbeda-beda -- data di memori
 * tidak bisa diandalkan untuk "mengingat" siapa yang sedang login.
 */
async function buatSesi(tipe, { pendaftarId, panitiaId, adminId }) {
  const token = crypto.randomBytes(32).toString("hex");
  const kadaluarsa = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  const baris = {
    token,
    tipe,
    pendaftar_id: pendaftarId || null,
    panitia_id: panitiaId || null,
    kadaluarsa_at: kadaluarsa,
  };
  if (adminId) baris.admin_id = adminId; // kolom admin_id ada sejak migration v6.8
  const { error } = await supabase.from("sesi").insert(baris);
  if (error) throw new Error(`Gagal membuat sesi: ${error.message}`);
  return token;
}

/**
 * Kolom `timestamp` (tanpa zona waktu) di Supabase berisi waktu UTC, tapi dikirim tanpa akhiran "Z".
 * new Date() di Node akan membacanya sebagai jam lokal (WIB, UTC+7) -- sesi 8 jam jadi habis dalam 1 jam.
 */
function waktuUtc(nilai) {
  const s = String(nilai);
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z");
}

async function ambilSesi(token) {
  if (!token) return null;
  const { data } = await supabase.from("sesi").select("*").eq("token", token).maybeSingle();
  if (!data) return null;
  if (waktuUtc(data.kadaluarsa_at) < new Date()) {
    await supabase.from("sesi").delete().eq("token", token);
    return null;
  }
  return data;
}

async function hapusSesi(token) {
  if (!token) return;
  await supabase.from("sesi").delete().eq("token", token);
}

function opsiCookie(req) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: req.protocol === "https", // otomatis aktif di Vercel (HTTPS), nonaktif di localhost (HTTP)
    maxAge: SESSION_DURATION_MS,
    path: "/",
  };
}

/** Middleware: hanya lanjut kalau pendaftar sudah login. Melekatkan req.pendaftar = { id, nomor } */
async function requirePendaftarLogin(req, res, next) {
  const token = req.cookies?.sid;
  const sesi = await ambilSesi(token);
  if (!sesi || sesi.tipe !== "pendaftar") {
    return res.status(401).json({ error: "Silakan login terlebih dahulu." });
  }
  const { data: pendaftar } = await supabase.from("pendaftar").select("id, nomor").eq("id", sesi.pendaftar_id).single();
  if (!pendaftar) return res.status(401).json({ error: "Sesi tidak valid." });
  req.pendaftar = pendaftar;
  next();
}

/** Middleware: hanya lanjut kalau panitia sudah login. Melekatkan req.panitia = { id, nama, sekolahId, username } */
async function requirePanitiaLogin(req, res, next) {
  const token = req.cookies?.sid;
  const sesi = await ambilSesi(token);
  if (!sesi || sesi.tipe !== "panitia") {
    return res.status(401).json({ error: "Silakan login sebagai panitia terlebih dahulu." });
  }
  const { data: akun } = await supabase.from("akun_panitia").select("*").eq("id", sesi.panitia_id).single();
  if (!akun) return res.status(401).json({ error: "Sesi tidak valid." });
  req.panitia = { id: akun.id, nama: akun.nama, sekolahId: akun.sekolah_id, username: akun.username };
  next();
}

/* ---------------------------------------------------------
   Batas percobaan login (anti brute force)
   Disimpan di tabel login_gagal (migration v6.4), bukan di memori,
   supaya tetap berlaku di Vercel serverless.
   --------------------------------------------------------- */
const JENDELA_MENIT = 15;
const MAKS_GAGAL_PER_AKUN = 5;
const MAKS_GAGAL_PER_IP = 20;

function kunciLogin(tipe, identitas, ip) {
  return { akun: `${tipe}:${String(identitas).trim().toLowerCase()}`, ip: `ip:${ip || "tidak-diketahui"}` };
}

/** Mengembalikan jumlah menit yang harus ditunggu (0 = boleh mencoba login). */
async function cekBatasLogin({ akun, ip }) {
  const sejak = new Date(Date.now() - JENDELA_MENIT * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("login_gagal")
    .select("kunci, waktu")
    .in("kunci", [akun, ip])
    .gte("waktu", sejak)
    .order("waktu", { ascending: true });
  if (error) {
    // Tabel belum dibuat (migration v6.4 belum dijalankan): jangan kunci siapa pun
    console.warn("[auth] Batas login tidak aktif:", error.message);
    return 0;
  }

  const gagalAkun = data.filter((d) => d.kunci === akun);
  const gagalIp = data.filter((d) => d.kunci === ip);
  let terkunciSampai = 0;
  if (gagalAkun.length >= MAKS_GAGAL_PER_AKUN) {
    terkunciSampai = Math.max(terkunciSampai, waktuUtc(gagalAkun[gagalAkun.length - MAKS_GAGAL_PER_AKUN].waktu).getTime());
  }
  if (gagalIp.length >= MAKS_GAGAL_PER_IP) {
    terkunciSampai = Math.max(terkunciSampai, waktuUtc(gagalIp[gagalIp.length - MAKS_GAGAL_PER_IP].waktu).getTime());
  }
  if (!terkunciSampai) return 0;
  const sisaMs = terkunciSampai + JENDELA_MENIT * 60 * 1000 - Date.now();
  return sisaMs > 0 ? Math.ceil(sisaMs / 60000) : 0;
}

async function catatLoginGagal({ akun, ip }) {
  const { error } = await supabase.from("login_gagal").insert([{ kunci: akun }, { kunci: ip }]);
  if (error) console.warn("[auth] Gagal mencatat login gagal:", error.message);
}

/** Login berhasil: hapus catatan gagal untuk akun itu (IP tetap tercatat). */
async function resetLoginGagal({ akun }) {
  await supabase.from("login_gagal").delete().eq("kunci", akun);
}

/** Middleware: hanya lanjut kalau Admin Dinas sudah login. Melekatkan req.admin = { id, nama, username } */
async function requireAdminLogin(req, res, next) {
  const sesi = await ambilSesi(req.cookies?.sid);
  if (!sesi || sesi.tipe !== "admin") {
    return res.status(401).json({ error: "Silakan login sebagai Admin Dinas terlebih dahulu." });
  }
  const { data: akun } = await supabase.from("akun_admin").select("id, nama, username").eq("id", sesi.admin_id).single();
  if (!akun) return res.status(401).json({ error: "Sesi tidak valid." });
  req.admin = akun;
  next();
}

/** Setelah password diganti: keluarkan semua sesi pendaftar itu di perangkat lain */
async function hapusSesiPendaftar(pendaftarId) {
  await supabase.from("sesi").delete().eq("tipe", "pendaftar").eq("pendaftar_id", pendaftarId);
}

module.exports = {
  requireAdminLogin,
  hapusSesiPendaftar,
  kunciLogin,
  cekBatasLogin,
  catatLoginGagal,
  resetLoginGagal,
  hashPassword,
  verifyPassword,
  buatSesi,
  ambilSesi,
  hapusSesi,
  opsiCookie,
  requirePendaftarLogin,
  requirePanitiaLogin,
};
