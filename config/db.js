// ==================================================
// StageLink — MySQL connection pool
// ==================================================
// A single shared pool is created at startup and reused across the
// application. Routes/services should `require('../config/db')` and
// call `pool.query(...)` or `pool.getConnection()` — never open ad
// hoc connections.
//
// Credentials come only from environment variables (see .env.example).
// Nothing here should ever hard-code a password or host.
// ==================================================

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
  queueLimit: 0,
  dateStrings: true,
});

/**
 * Verifies the pool can actually reach the database. Called once at
 * startup so a misconfigured DB is reported clearly in the logs
 * instead of surfacing as a confusing error on the first request.
 * The server is still allowed to start when this fails — see the
 * comment in server.js — so the landing page and static assets stay
 * reachable even if the database is temporarily unavailable.
 */
async function verifyConnection() {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    return { connected: true };
  } catch (error) {
    return { connected: false, error };
  }
}

module.exports = { pool, verifyConnection };
