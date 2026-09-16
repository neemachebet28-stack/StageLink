// ==================================================
// StageLink — security event log
// ==================================================
// Anonymous-friendly (user_id is nullable) record of security-relevant
// events that aren't admin actions: failed logins, lockouts, CSRF and
// rate-limit rejections, access denials, payment-callback anomalies.
// record() never throws — logging must not break the request it is
// observing.
const { pool } = require('../config/db');

async function record({ type, userId = null, ip = null, details = null }) {
  try {
    await pool.query(
      `INSERT INTO security_events (event_type, user_id, ip, details) VALUES (?, ?, ?, ?)`,
      [type, userId, ip ? String(ip).slice(0, 64) : null, details ? String(details).slice(0, 500) : null]
    );
  } catch (error) {
    console.error('[security-events] failed to record', type, error.message);
  }
}

async function list({ limit = 100 } = {}) {
  const [rows] = await pool.query(
    `SELECT se.*, u.email AS user_email
     FROM security_events se
     LEFT JOIN users u ON u.id = se.user_id
     ORDER BY se.created_at DESC, se.id DESC
     LIMIT ?`,
    [limit]
  );
  return rows;
}

module.exports = { record, list };
