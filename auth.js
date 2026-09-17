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
async function buatSesi(tipe, { pendaftarId, panitiaId }) {
  const token = crypto.randomBytes(32).toString("hex");
  const kadaluarsa = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  await supabase.from("sesi").insert({
    token,
    tipe,
    pendaftar_id: pendaftarId || null,
    panitia_id: panitiaId || null,
    kadaluarsa_at: kadaluarsa,
  });
  return token;
}

async function ambilSesi(token) {
  if (!token) return null;
  const { data } = await supabase.from("sesi").select("*").eq("token", token).maybeSingle();
  if (!data) return null;
  if (new Date(data.kadaluarsa_at) < new Date()) {
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

module.exports = {
  hashPassword,
  verifyPassword,
  buatSesi,
  ambilSesi,
  hapusSesi,
  opsiCookie,
  requirePendaftarLogin,
  requirePanitiaLogin,
};
