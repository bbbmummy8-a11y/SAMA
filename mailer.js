// mailer.js — إرسال البريد عبر Resend API (يعمل على Render بدون قيود SMTP)
const { Resend } = require('resend');
require('dotenv').config();

const FROM_NAME    = process.env.MAIL_FROM_NAME || 'نظام UniAbsence';
// ملاحظة: في الحساب المجاني لـ Resend يجب استخدام onboarding@resend.dev
// بعد إضافة دومين خاص يمكن تغييره
const FROM_ADDRESS = process.env.MAIL_FROM_ADDRESS || 'onboarding@resend.dev';

// ─── قالب HTML مشترك ─────────────────────────────────────────────────────────
function wrapHtml(title, color, icon, bodyContent) {
    return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Tahoma,sans-serif;direction:rtl;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0"
               style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:${color};padding:32px 40px;text-align:center;">
              <div style="font-size:48px;margin-bottom:12px;">${icon}</div>
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${title}</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;color:#374151;font-size:15px;line-height:1.7;">
              ${bodyContent}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;text-align:center;
                       color:#9ca3af;font-size:12px;border-top:1px solid #e5e7eb;">
              هذه رسالة تلقائية من نظام UniAbsence — يُرجى عدم الرد عليها
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── دالة الإرسال المشتركة ────────────────────────────────────────────────────
async function sendEmail({ to, subject, html, text }) {
    if (!process.env.RESEND_API_KEY) {
        console.error('[mailer] ❌ RESEND_API_KEY غير موجود في Environment Variables!');
        return;
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    try {
        const { data, error } = await resend.emails.send({
            from:    `${FROM_NAME} <${FROM_ADDRESS}>`,
            to:      [to],
            subject,
            html,
            text
        });

        if (error) {
            console.error('[mailer] ❌ خطأ من Resend:', JSON.stringify(error));
            return;
        }

        console.log('[mailer] ✅ الإيميل أُرسل بنجاح — id:', data.id);
    } catch (err) {
        console.error('[mailer] ❌ استثناء أثناء الإرسال:', err.message);
    }
}

// ─── إرسال إشعار قرار التسجيل (قبول / رفض) ───────────────────────────────────
async function sendRegistrationEmail({ to, fullName, registrationNumber, decision, rejectionReason }) {
    const isAccepted = decision === 'accepted';

    const subject = isAccepted
        ? '✅ تم قبول طلب تسجيلك — UniAbsence'
        : '❌ تم رفض طلب تسجيلك — UniAbsence';

    const color = isAccepted ? '#10b981' : '#ef4444';
    const icon  = isAccepted ? '✅' : '❌';
    const title = isAccepted ? 'تم قبول طلب التسجيل' : 'تم رفض طلب التسجيل';

    let bodyContent;

    if (isAccepted) {
        bodyContent = `
          <p>مرحباً <strong>${fullName}</strong>،</p>
          <p>يسعدنا إعلامك بأن طلب تسجيلك كأستاذ في نظام UniAbsence قد <strong style="color:#10b981;">تمت الموافقة عليه</strong>.</p>

          <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:20px 24px;margin:24px 0;text-align:center;">
            <div style="font-size:13px;color:#6b7280;margin-bottom:6px;">رقم التسجيل الخاص بك</div>
            <div style="font-size:26px;font-weight:800;color:#10b981;letter-spacing:2px;direction:ltr;">
              ${registrationNumber}
            </div>
          </div>

          <p>يمكنك الآن <strong>تسجيل الدخول</strong> إلى النظام باستخدام رقم التسجيل وكلمة المرور التي اخترتها عند التسجيل.</p>

          <p style="color:#6b7280;font-size:13px;margin-top:28px;">
            إذا لم تقم بهذا الطلب أو كان لديك أي استفسار، يُرجى التواصل مع الإدارة.
          </p>`;
    } else {
        bodyContent = `
          <p>مرحباً <strong>${fullName}</strong>،</p>
          <p>نأسف لإعلامك بأن طلب تسجيلك كأستاذ في نظام UniAbsence قد <strong style="color:#ef4444;">تم رفضه</strong>.</p>

          ${rejectionReason ? `
          <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:12px;padding:20px 24px;margin:24px 0;">
            <div style="font-size:13px;color:#6b7280;margin-bottom:6px;font-weight:600;">سبب الرفض:</div>
            <div style="color:#991b1b;">${rejectionReason}</div>
          </div>` : ''}

          <p>للاستفسار أو تقديم طعن، يُرجى التواصل مع إدارة المعهد مباشرةً.</p>

          <p style="color:#6b7280;font-size:13px;margin-top:28px;">
            شكراً لتفهمك.
          </p>`;
    }

    console.log(`[mailer] 📤 إرسال إيميل ${isAccepted ? 'قبول' : 'رفض'} إلى: ${to}`);
    await sendEmail({
        to,
        subject,
        html: wrapHtml(title, color, icon, bodyContent),
        text: isAccepted
            ? `مرحباً ${fullName}، تم قبول طلب تسجيلك. رقم التسجيل: ${registrationNumber}`
            : `مرحباً ${fullName}، تم رفض طلب تسجيلك.${rejectionReason ? ' السبب: ' + rejectionReason : ''}`
    });
}

// ─── إرسال إشعار تفعيل حساب الأستاذ ─────────────────────────────────────────
async function sendActivationEmail({ to, fullName, registrationNumber }) {
    console.log('[mailer] 🔔 sendActivationEmail — إلى:', to);

    const bodyContent = `
      <p>مرحباً <strong>${fullName}</strong>،</p>
      <p>يسعدنا إعلامك بأنه <strong style="color:#10b981;">تم تفعيل حسابك</strong> في منصة UniAbsence لإدارة الغيابات الجامعية.</p>

      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:20px 24px;margin:24px 0;text-align:center;">
        <div style="font-size:13px;color:#6b7280;margin-bottom:6px;">رقم التسجيل الخاص بك</div>
        <div style="font-size:26px;font-weight:800;color:#10b981;letter-spacing:2px;direction:ltr;">
          ${registrationNumber}
        </div>
      </div>

      <div style="text-align:center;margin:28px 0;">
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}"
           style="background:#10b981;color:#ffffff;padding:14px 32px;border-radius:10px;
                  text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">
          الولوج إلى المنصة
        </a>
      </div>

      <p>يمكنك تسجيل الدخول باستخدام رقم التسجيل وكلمة المرور التي اخترتها عند التسجيل.</p>

      <p style="color:#6b7280;font-size:13px;margin-top:28px;">
        إذا لم تطلب هذا الحساب أو كان لديك أي استفسار، يُرجى التواصل مع الإدارة.
      </p>`;

    await sendEmail({
        to,
        subject: '✅ تم تفعيل حسابك — UniAbsence',
        html:    wrapHtml('تم تفعيل حسابك', '#10b981', '🎉', bodyContent),
        text:    `مرحباً ${fullName}، تم تفعيل حسابك في منصة UniAbsence. رقم التسجيل: ${registrationNumber}. يمكنك الولوج إلى المنصة الآن.`
    });
}

module.exports = { sendRegistrationEmail, sendActivationEmail };