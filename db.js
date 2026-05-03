const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}

async function getClient() {
  return await pool.connect();
}

module.exports = { query, getClient, pool };
console.log("DATABASE_URL =", process.env.DATABASE_URL);
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

async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}

async function getClient() {
  return await pool.connect();
}

module.exports = { query, getClient, pool };