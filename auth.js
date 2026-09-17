const bcrypt = require("bcryptjs");

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compareSync(plain, hash);
}

/** Middleware: hanya lanjut kalau pendaftar sudah login (req.session.pendaftarId ada) */
function requirePendaftarLogin(req, res, next) {
  if (!req.session.pendaftarId) {
    return res.status(401).json({ error: "Silakan login terlebih dahulu." });
  }
  next();
}

/** Middleware: hanya lanjut kalau panitia sudah login (req.session.panitia ada) */
function requirePanitiaLogin(req, res, next) {
  if (!req.session.panitia) {
    return res.status(401).json({ error: "Silakan login sebagai panitia terlebih dahulu." });
  }
  next();
}

module.exports = { hashPassword, verifyPassword, requirePendaftarLogin, requirePanitiaLogin };
