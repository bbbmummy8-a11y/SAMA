const { Pool } = require('pg');
require('dotenv').config();

// Bug fix: SSL مطلوب في الإنتاج (Render) لكن يسبب خطأ في البيئة المحلية
// الحل: تفعيل SSL فقط عند وجود DATABASE_URL أو NODE_ENV=production
const isProduction = process.env.NODE_ENV === 'production' ||
                     (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com'));

const poolConfig = process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: isProduction ? { rejectUnauthorized: false } : false
      }
    : {
        host:     process.env.DB_HOST     || 'localhost',
        port:     parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME     || 'uniabsence',
        user:     process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASSWORD || '',
        ssl:      false
      };

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
    console.error('PostgreSQL pool error:', err);
});

// ─── query helper ─────────────────────────────────────────────────────────────
async function query(text, params) {
    return pool.query(text, params);
}

// ─── getClient — للمعاملات متعددة الخطوات ────────────────────────────────────
async function getClient() {
    return pool.connect();
}

module.exports = { pool, query, getClient };