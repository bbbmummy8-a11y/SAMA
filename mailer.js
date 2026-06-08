// mailer.js — إرسال الإيميلات (Nodemailer أو Resend)
const nodemailer = require('nodemailer');

// ─── إنشاء transporter ───────────────────────────────────────────────────────
// يدعم SMTP عبر متغيرات البيئة، ويتراجع إلى وضع التسجيل فقط إذا لم تُضبط
function createTransporter() {
    if (process.env.SMTP_HOST) {
        return nodemailer.createTransport({
            host:   process.env.SMTP_HOST,
            port:   parseInt(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
    }
    // وضع التطوير: يطبع الإيميل في الـ console بدلاً من إرساله
    return null;
}

// ─── sendActivationEmail ──────────────────────────────────────────────────────
async function sendActivationEmail({ to, fullName, registrationNumber }) {
    const subject = 'تم تفعيل حسابك — نظام تبريرات الغياب';
    const html = `
        <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #059669;">مرحباً ${fullName}</h2>
            <p>تم تفعيل حسابك في نظام تبريرات الغياب بنجاح.</p>
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="margin: 0; font-weight: bold;">رقم التسجيل الخاص بك:</p>
                <p style="margin: 8px 0 0; font-size: 1.2em; color: #059669; font-family: monospace; direction: ltr;">${registrationNumber}</p>
            </div>
            <p>يمكنك الآن تسجيل الدخول باستخدام رقم التسجيل وكلمة المرور التي أنشأتها.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
            <p style="color: #6b7280; font-size: 0.85em;">نظام إدارة تبريرات الغياب الجامعي</p>
        </div>
    `;

    const transporter = createTransporter();

    if (!transporter) {
        // وضع التطوير: طباعة في الـ console
        console.log('\n📧 [Mailer - DEV MODE] إيميل تفعيل:');
        console.log('   إلى:', to);
        console.log('   الموضوع:', subject);
        console.log('   رقم التسجيل:', registrationNumber);
        console.log('');
        return;
    }

    try {
        await transporter.sendMail({
            from:    process.env.SMTP_FROM || `"نظام الغياب" <noreply@univ.dz>`,
            to,
            subject,
            html
        });
        console.log(`[Mailer] ✅ تم إرسال إيميل التفعيل إلى: ${to}`);
    } catch (err) {
        // نسجّل الخطأ لكن لا نوقف العملية
        console.error('[Mailer] ❌ فشل إرسال الإيميل:', err.message);
    }
}

module.exports = { sendActivationEmail };