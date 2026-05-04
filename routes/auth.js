// routes/auth.js — مصادقة المستخدمين وإدارة التسجيل
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');

// Bug fix: duplicate require('../db') — one pulled { pool }, the other tried to pull
// { query, getClient } which didn't exist → query was undefined everywhere.
// Now db.js exports all three; a single require covers everything.
const { pool, query, getClient } = require('../db');

const { authenticate, requireRole, logAudit } = require('../middleware/auth');
const { sendRegistrationEmail } = require('../mailer');

const router = express.Router();

// ─── مساعدات توليد الـ Tokens ─────────────────────────────────────────────
function signAccessToken(userId, role) {
    return jwt.sign(
        { userId, role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES || '8h' }
    );
}

function signRefreshToken(userId) {
    return jwt.sign(
        { userId },
        process.env.REFRESH_SECRET,
        { expiresIn: process.env.REFRESH_EXPIRES_IN || '7d' }
    );
}

function setTokenCookies(res, accessToken, refreshToken) {
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('access_token', accessToken, {
        httpOnly: true,
        secure:   isProd,
        sameSite: 'lax',
        maxAge:   8 * 60 * 60 * 1000  // 8 ساعات
    });
    if (refreshToken) {
        res.cookie('refresh_token', refreshToken, {
            httpOnly: true,
            secure:   isProd,
            sameSite: 'lax',
            maxAge:   7 * 24 * 60 * 60 * 1000  // 7 أيام
        });
    }
}

// ─── POST /api/auth/login ────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const {
    firstname,
    lastname,
    email,
    role,
    specialty,
    year,
    password,
    registration_number
  } = req.body;

  // تحقق من البيانات
  if (!firstname || !lastname || !password || !registration_number) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }

  try {
    // 🔴 أهم خطوة: تشفير كلمة السر
    const hashedPassword = await bcrypt.hash(password.trim(), 10);

    // إدخال المستخدم
    const result = await query(
      `INSERT INTO users 
      (registration_number, password_hash, role, full_name_ar, email, specialization, year_of_study)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *`,
      [
        registration_number.trim(),
        hashedPassword, // ✅ هنا نحط hash مش password عادي
        role || 'student',
        ${firstname} ${lastname},
        email || null,
        specialty || null,
        year || null
      ]
    );

    res.status(201).json({
      message: 'تم إنشاء الحساب بنجاح',
      user: result.rows[0]
    });

  } catch (err) {
    console.error('[REGISTER ERROR]', err);

    // معالجة تكرار رقم التسجيل
    if (err.code === '23505') {
      return res.status(400).json({ error: 'رقم التسجيل موجود مسبقاً' });
    }

    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// ─── POST /api/auth/register ─────────────────────────────────────────────────
router.post('/register', async (req, res) => {
    const { firstname, lastname, email, role, specialty, year, password, registration_number } = req.body;

    if (!firstname || !lastname || !role || !password || !registration_number)
        return res.status(400).json({ error: 'البيانات الأساسية مطلوبة' });

    if (!['student', 'professor'].includes(role))
        return res.status(400).json({ error: 'الدور يجب أن يكون طالب أو أستاذ' });

    if (password.length < 8)
        return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' });

    try {
        const dupCheck = await query(
            'SELECT id FROM users WHERE registration_number=$1 OR (email=$2 AND email IS NOT NULL)',
            [registration_number.trim(), email?.toLowerCase() || null]
        );
        if (dupCheck.rows.length > 0)
            return res.status(409).json({ error: 'رقم التسجيل أو البريد الإلكتروني مستخدم بالفعل' });

        const hash = await bcrypt.hash(password.trim(), 12);

        const isPending = role === 'professor';
        const isActive  = role === 'student';

        const result = await query(
            // Bug fix: is_pending column was used here but missing from schema.
            // See schema.sql fix — the column must exist for this INSERT to work.
            `INSERT INTO users
                (registration_number, password_hash, role, full_name_ar, email,
                 specialization, year_of_study, is_active, is_pending, faculty_code)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'GEN')
             RETURNING *`,
            [
                registration_number.trim(),
                hash, role,
                `${firstname.trim()} ${lastname.trim()}`,
                email?.toLowerCase() || null,
                specialty || null,
                role === 'student' ? (parseInt(year) || null) : null,
                isActive,
                isPending
            ]
        );

        const newUser = result.rows[0];
        await logAudit(newUser.id, 'REGISTER', 'users', newUser.id, req, 201, { role });

        res.status(201).json({
            message: isPending
                ? 'تم تقديم طلب التسجيل، سيتم إعلامك عبر البريد الإلكتروني بعد المراجعة'
                : 'تم إنشاء الحساب بنجاح، يمكنك تسجيل الدخول الآن',
            registration_number: newUser.registration_number,
            pending: isPending
        });
    } catch (err) {
        console.error('[POST /auth/register]', err);
        res.status(500).json({ error: 'خطأ في التسجيل' });
    }
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
    res.json({ user: formatUser(req.user) });
});

// ─── POST /api/auth/logout ───────────────────────────────────────────────────
router.post('/logout', async (req, res) => {
    const refreshToken = req.cookies?.refresh_token;
    if (refreshToken) {
        try {
            const decoded = jwt.verify(refreshToken, process.env.REFRESH_SECRET);
            await query('DELETE FROM refresh_tokens WHERE user_id=$1', [decoded.userId]);
        } catch (_) { /* تجاهل خطأ الـ token المنتهي */ }
    }
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
    res.json({ message: 'تم تسجيل الخروج' });
});

// ─── POST /api/auth/refresh ──────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken)
        return res.status(401).json({ error: 'لا يوجد refresh token', code: 'NO_REFRESH' });

    try {
        const decoded = jwt.verify(refreshToken, process.env.REFRESH_SECRET);

        const userResult = await query(
            'SELECT * FROM users WHERE id=$1 AND is_active=true',
            [decoded.userId]
        );
        if (userResult.rows.length === 0)
            return res.status(401).json({ error: 'المستخدم غير موجود', code: 'USER_NOT_FOUND' });

        const user      = userResult.rows[0];
        const newAccess = signAccessToken(user.id, user.role);
        setTokenCookies(res, newAccess, null);

        res.json({ user: formatUser(user), message: 'تم تجديد الجلسة' });
    } catch (err) {
        res.clearCookie('access_token');
        res.clearCookie('refresh_token');
        return res.status(401).json({ error: 'refresh token غير صالح', code: 'REFRESH_INVALID' });
    }
});

// ─── GET /api/auth/pending — طلبات التسجيل المعلقة (Admin) ──────────────────
router.get('/pending', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const result = await query(
            `SELECT id, registration_number, full_name_ar, email, specialization,
                    year_of_study, role, created_at
             FROM users
             WHERE is_pending = true
             ORDER BY created_at ASC`,
            []
        );
        res.json({ pending: result.rows });
    } catch (err) {
        console.error('[GET /auth/pending]', err);
        res.status(500).json({ error: 'خطأ في جلب طلبات التسجيل' });
    }
});

// ─── POST /api/auth/pending/:id/decide — قبول / رفض طلب تسجيل (Admin) ──────
router.post('/pending/:id/decide', authenticate, requireRole('admin'), async (req, res) => {
    const { decision, rejectionReason } = req.body;

    if (!['accepted', 'rejected'].includes(decision))
        return res.status(400).json({ error: 'القرار يجب أن يكون accepted أو rejected' });

    try {
        const userResult = await query(
            'SELECT * FROM users WHERE id=$1 AND is_pending=true',
            [req.params.id]
        );
        if (userResult.rows.length === 0)
            return res.status(404).json({ error: 'الطلب غير موجود' });

        const pendingUser = userResult.rows[0];

        if (decision === 'accepted') {
            await query(
                'UPDATE users SET is_pending=false, is_active=true WHERE id=$1',
                [req.params.id]
            );
        } else {
            await query('DELETE FROM users WHERE id=$1', [req.params.id]);
        }

        await logAudit(req.user.id, `REGISTRATION_${decision.toUpperCase()}`, 'users', req.params.id, req, 200, {});

        if (pendingUser.email) {
            sendRegistrationEmail({
                to:                 pendingUser.email,
                fullName:           pendingUser.full_name_ar,
                registrationNumber: pendingUser.registration_number,
                decision,
                rejectionReason:    rejectionReason || ''
            }).catch(e => console.error('[mailer]', e.message));
        }

        res.json({
            message: decision === 'accepted'
                ? 'تم قبول طلب التسجيل وتفعيل الحساب'
                : 'تم رفض طلب التسجيل'
        });
    } catch (err) {
        console.error('[POST /auth/pending/:id/decide]', err);
        res.status(500).json({ error: 'خطأ في معالجة الطلب' });
    }
});

// ─── دالة تنسيق بيانات المستخدم ──────────────────────────────────────────────
function formatUser(u) {
    return {
        id:                 u.id,
        registrationNumber: u.registration_number,
        fullName:           u.full_name_ar,
        role:               u.role,
        email:              u.email || '',
        specialty:          u.specialization || u.department || '',
        year:               u.year_of_study || 0,
        faculty:            u.faculty_code || 'GEN',
        isActive:           u.is_active,
        isLocked:           u.is_locked,
        createdAt:          u.created_at,
        lastLogin:          u.last_login
    };
}

module.exports = router;