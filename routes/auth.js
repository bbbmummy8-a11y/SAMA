// routes/auth.js — تسجيل الدخول والخروج والتسجيل
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { query, getClient } = require('../db');
const { authenticate, logAudit } = require('../middleware/auth');

const router = express.Router();

// ─── دوال مساعدة ─────────────────────────────────────────────────────────────
function generateAccessToken(user) {
    return jwt.sign(
        { userId: user.id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES || '8h' }
    );
}
function generateRefreshToken(user) {
    return jwt.sign(
        { userId: user.id },
        process.env.REFRESH_SECRET,
        { expiresIn: process.env.REFRESH_EXPIRES_IN || '7d' }
    );
}
function setTokenCookies(res, accessToken, refreshToken) {
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('access_token', accessToken, {
        httpOnly: true, secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        maxAge: 8 * 60 * 60 * 1000
    });
    res.cookie('refresh_token', refreshToken, {
        httpOnly: true, secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/api/auth/refresh'
    });
}
function formatUser(u) {
    return {
        id:                 u.id,
        registrationNumber: u.registration_number,
        fullName:           u.full_name_ar,
        role:               u.role,
        email:              u.email || '',
        specialty:          u.specialization || u.department || '',
        year:               u.year_of_study || 0,
        faculty:            u.faculty_code,
        isActive:           u.is_active
    };
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', async (req, res) => {
    const {
        firstname, lastname, email, role, specialty,
        year, password, registration_number
    } = req.body;

    if (!firstname || !lastname || !role || !password || !registration_number)
        return res.status(400).json({ error: 'البيانات الأساسية مطلوبة' });

    if (!['student', 'professor'].includes(role))
        return res.status(400).json({ error: 'الدور غير مسموح به' });

    if (password.length < 8)
        return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' });

    try {
        // التحقق من تكرار رقم التسجيل
        const existing = await query(
            'SELECT id FROM users WHERE registration_number = $1',
            [registration_number]
        );
        if (existing.rows.length > 0)
            return res.status(409).json({ error: 'رقم التسجيل مستخدم بالفعل' });

        // التحقق من تكرار البريد
        if (email) {
            const emailCheck = await query(
                'SELECT id FROM users WHERE email = $1',
                [email.toLowerCase()]
            );
            if (emailCheck.rows.length > 0)
                return res.status(409).json({ error: 'البريد الإلكتروني مستخدم بالفعل' });
        }

        const hash     = await bcrypt.hash(password, 12);
        const fullName = `${firstname} ${lastname}`;

        // Bug fix: is_pending=true للأستاذ (ينتظر موافقة الإدارة)، false للطالب
        const isPending = role === 'professor';
        const isActive  = role === 'student';

        const result = await query(
            `INSERT INTO users
             (registration_number, password_hash, role, full_name_ar, email,
              faculty_code, year_of_study, specialization, is_active, is_pending)
             VALUES ($1,$2,$3,$4,$5,'GEN',$6,$7,$8,$9) RETURNING *`,
            [
                registration_number, hash, role, fullName,
                email?.toLowerCase() || null,
                role === 'student' ? (year || null) : null,
                specialty || null,
                isActive,
                isPending
            ]
        );

        const newUser = result.rows[0];
        await logAudit(newUser.id, 'USER_REGISTERED', 'users', newUser.id, req, 201, { role });

        if (isPending) {
            return res.status(201).json({
                message: 'تم إنشاء الحساب بنجاح. يرجى الانتظار حتى تفعيل حسابك من الإدارة.',
                registration_number: newUser.registration_number,
                pending: true
            });
        }

        res.status(201).json({
            message: 'تم إنشاء الحساب بنجاح',
            registration_number: newUser.registration_number
        });
    } catch (err) {
        console.error('[POST /auth/register]', err);
        if (err.code === '23505')
            return res.status(409).json({ error: 'رقم التسجيل أو البريد الإلكتروني مستخدم' });
        res.status(500).json({ error: 'خطأ في إنشاء الحساب' });
    }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
    const { registration_number, password } = req.body;
    if (!registration_number || !password)
        return res.status(400).json({ error: 'رقم التسجيل وكلمة المرور مطلوبان' });

    try {
        const result = await query(
            'SELECT * FROM users WHERE registration_number = $1',
            [registration_number]
        );

        if (result.rows.length === 0)
            return res.status(401).json({ error: 'رقم التسجيل أو كلمة المرور غير صحيحة' });

        const user = result.rows[0];

        // Bug fix: التحقق من is_pending قبل is_active
        if (user.is_pending)
            return res.status(403).json({ error: 'حسابك قيد المراجعة. يرجى الانتظار حتى تفعيله من الإدارة.' });

        if (!user.is_active)
            return res.status(403).json({ error: 'الحساب معطّل. تواصل مع الإدارة.' });

        if (user.is_locked)
            return res.status(403).json({ error: 'الحساب مقفل بسبب محاولات دخول متعددة. تواصل مع الإدارة.' });

        const valid = await bcrypt.compare(password, user.password_hash);

        if (!valid) {
            // زيادة عداد المحاولات الفاشلة
            const attempts = (user.failed_login_attempts || 0) + 1;
            const lock     = attempts >= 5;
            await query(
                'UPDATE users SET failed_login_attempts=$1, is_locked=$2 WHERE id=$3',
                [attempts, lock, user.id]
            );
            if (lock)
                return res.status(403).json({ error: 'تم قفل الحساب بعد 5 محاولات فاشلة. تواصل مع الإدارة.' });
            return res.status(401).json({ error: 'رقم التسجيل أو كلمة المرور غير صحيحة' });
        }

        // إعادة تعيين عداد المحاولات وتحديث آخر دخول
        await query(
            'UPDATE users SET failed_login_attempts=0, last_login=NOW() WHERE id=$1',
            [user.id]
        );

        const accessToken  = generateAccessToken(user);
        const refreshToken = generateRefreshToken(user);

        // حفظ hash الـ refresh token
        const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await query(
            'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
            [user.id, tokenHash, expiresAt]
        );

        setTokenCookies(res, accessToken, refreshToken);
        await logAudit(user.id, 'LOGIN', 'users', user.id, req, 200, {});

        res.json({ user: formatUser(user) });
    } catch (err) {
        console.error('[POST /auth/login]', err);
        res.status(500).json({ error: 'خطأ في تسجيل الدخول' });
    }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', async (req, res) => {
    try {
        const refreshToken = req.cookies?.refresh_token;
        if (refreshToken) {
            const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
            await query('DELETE FROM refresh_tokens WHERE token_hash=$1', [tokenHash]);
        }
    } catch (_) {}

    const isProd = process.env.NODE_ENV === 'production';
    res.clearCookie('access_token',  { httpOnly: true, secure: isProd, sameSite: isProd ? 'none' : 'lax' });
    res.clearCookie('refresh_token', { httpOnly: true, secure: isProd, sameSite: isProd ? 'none' : 'lax', path: '/api/auth/refresh' });
    res.json({ message: 'تم تسجيل الخروج' });
});

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken)
        return res.status(401).json({ error: 'لا يوجد refresh token', code: 'NO_REFRESH' });

    try {
        const decoded   = jwt.verify(refreshToken, process.env.REFRESH_SECRET);
        const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

        const stored = await query(
            'SELECT * FROM refresh_tokens WHERE token_hash=$1 AND expires_at > NOW()',
            [tokenHash]
        );
        if (stored.rows.length === 0)
            return res.status(401).json({ error: 'الجلسة منتهية أو غير صالحة', code: 'REFRESH_INVALID' });

        const userResult = await query(
            'SELECT * FROM users WHERE id=$1 AND is_active=true',
            [decoded.userId]
        );
        if (userResult.rows.length === 0)
            return res.status(401).json({ error: 'المستخدم غير موجود', code: 'USER_NOT_FOUND' });

        const user           = userResult.rows[0];
        const newAccess      = generateAccessToken(user);
        const newRefresh     = generateRefreshToken(user);
        const newTokenHash   = crypto.createHash('sha256').update(newRefresh).digest('hex');
        const newExpiresAt   = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        // تدوير الـ refresh token (rotation)
        await query('DELETE FROM refresh_tokens WHERE token_hash=$1', [tokenHash]);
        await query(
            'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
            [user.id, newTokenHash, newExpiresAt]
        );

        setTokenCookies(res, newAccess, newRefresh);
        res.json({ user: formatUser(user) });
    } catch (err) {
        return res.status(401).json({ error: 'refresh token غير صالح', code: 'REFRESH_INVALID' });
    }
});

// ─── GET /api/auth/me — جلب بيانات الجلسة الحالية ────────────────────────────
router.get('/me', authenticate, async (req, res) => {
    res.json({ user: formatUser(req.user) });
});

// ─── GET /api/auth/pending — قائمة المستخدمين المنتظرين (admin) ──────────────
router.get('/pending', authenticate, async (req, res) => {
    if (req.user.role !== 'admin')
        return res.status(403).json({ error: 'غير مصرح' });
    try {
        const result = await query(
            `SELECT id, registration_number, full_name_ar, role, email, specialization, created_at
             FROM users WHERE is_pending=true ORDER BY created_at DESC`
        );
        res.json({ pending: result.rows });
    } catch (err) {
        res.status(500).json({ error: 'خطأ في جلب الطلبات المعلقة' });
    }
});

module.exports = router;