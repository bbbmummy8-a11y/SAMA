const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.on('error', (err) => {
    console.error('PostgreSQL pool error:', err);
});

// ─── query helper — used by all routes ───────────────────────────────────────
// Bug fix: db.js only exported { pool }, so every route that imported
// { query } from '../db' received undefined → TypeError on every DB call.
async function query(text, params) {
    return pool.query(text, params);
}

// ─── getClient — for multi-statement transactions ─────────────────────────────
async function getClient() {
    return pool.connect();
}

module.exports = { pool, query, getClient };