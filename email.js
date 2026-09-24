const nodemailer = require("nodemailer");

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) {
    console.warn("[email] EMAIL_USER/EMAIL_APP_PASSWORD belum diisi -- notifikasi email dilewati (hanya tersimpan di database).");
    return null;
  }
  // Port 587 (STARTTLS) dipakai, bukan 465: antivirus seperti Avast Mail Shield
  // menyadap koneksi 465 sehingga Node.js menolak sertifikatnya. requireTLS memastikan
  // koneksi tetap wajib terenkripsi sebelum login.
  transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_APP_PASSWORD,
    },
  });
  return transporter;
}

/** Kirim satu email notifikasi. Gagal secara diam-diam (tidak melempar error)
 *  supaya kegagalan kirim email tidak menghentikan proses utama (auto-transfer, dst). */
async function kirimEmail(tujuan, subjek, isiHtml) {
  const t = getTransporter();
  if (!t || !tujuan) return { terkirim: false, alasan: "Transporter atau alamat tujuan tidak tersedia." };

  try {
    await t.sendMail({
      from: `"SiPPDB" <${process.env.EMAIL_USER}>`,
      to: tujuan,
      subject: subjek,
      html: `
        <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 10px;">
          <h2 style="color:#1B3358; margin: 0 0 16px;">SiPPDB &mdash; Notifikasi Status</h2>
          <p style="font-size:15px; color:#1f2430; line-height:1.6; margin: 0 0 16px;">${isiHtml}</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0" />
          <p style="font-size:12px;color:#6b7280; margin:0;">Email ini dikirim otomatis oleh sistem SiPPDB. Mohon tidak membalas email ini.</p>
        </div>
      `,
    });
    return { terkirim: true };
  } catch (err) {
    console.error("[email] Gagal mengirim email:", err.message);
    return { terkirim: false, alasan: err.message };
  }
}

module.exports = { kirimEmail };
