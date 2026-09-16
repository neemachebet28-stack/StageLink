// ==================================================
// StageLink — notifications data access
// ==================================================
// Recipients are identified by recipient_key ('user:<id>' or
// 'session:<id>') — see the note in database.sql. Every read and
// every state change here is scoped to the caller's own recipient
// keys, so one visitor can never read or mark another's notification.
const { pool } = require('../config/db');

const RETENTION_DAYS = 30;

function userKey(userId) {
  return `user:${userId}`;
}

function sessionKey(sessionId) {
  return `session:${sessionId}`;
}

/**
 * The recipient keys the current request may read. A signed-in user
 * sees their own notifications plus any created for this browser
 * session (e.g. an operator who also booked a seat as a passenger).
 */
function recipientKeysForRequest(req) {
  const keys = [sessionKey(req.sessionID)];
  if (req.currentUser) keys.push(userKey(req.currentUser.id));
  return keys;
}

/**
 * Creates a notification unless one with the same (recipient,
 * dedupe_key) already exists. Returns true if a new row was written.
 * INSERT IGNORE + the unique key makes this safe under concurrency —
 * two simultaneous identical events still yield one notification.
 */
async function create({ recipientKey, userId = null, organizationId = null, type, title, message, actionUrl = null, actionLabel = null, dedupeKey }) {
  const [result] = await pool.query(
    `INSERT IGNORE INTO notifications
       (recipient_key, user_id, organization_id, type, title, message, action_url, action_label, dedupe_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      recipientKey,
      userId,
      organizationId,
      type,
      title.slice(0, 150),
      message.slice(0, 500),
      actionUrl,
      actionLabel,
      dedupeKey.slice(0, 150),
    ]
  );
  return result.affectedRows > 0;
}

async function listForKeys(keys, { limit = 50, unreadOnly = false } = {}) {
  const [rows] = await pool.query(
    `SELECT id, type, title, message, action_url, action_label, read_at, created_at
     FROM notifications
     WHERE recipient_key IN (?) ${unreadOnly ? 'AND read_at IS NULL' : ''}
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    [keys, limit]
  );
  return rows;
}

async function countUnread(keys) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS count FROM notifications WHERE recipient_key IN (?) AND read_at IS NULL`,
    [keys]
  );
  return row.count;
}

async function getForKeys(id, keys) {
  const [rows] = await pool.query(
    `SELECT * FROM notifications WHERE id = ? AND recipient_key IN (?)`,
    [id, keys]
  );
  return rows[0] || null;
}

async function markRead(id, keys) {
  const [result] = await pool.query(
    `UPDATE notifications SET read_at = NOW() WHERE id = ? AND recipient_key IN (?) AND read_at IS NULL`,
    [id, keys]
  );
  return result.affectedRows > 0;
}

async function markAllRead(keys) {
  const [result] = await pool.query(
    `UPDATE notifications SET read_at = NOW() WHERE recipient_key IN (?) AND read_at IS NULL`,
    [keys]
  );
  return result.affectedRows;
}

/**
 * Retention: notifications older than RETENTION_DAYS are removed so
 * the table doesn't grow without bound (anonymous passenger sessions
 * generate rows that no one will ever come back for).
 */
async function pruneOld() {
  const [result] = await pool.query(
    `DELETE FROM notifications WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [RETENTION_DAYS]
  );
  return result.affectedRows;
}

module.exports = {
  userKey,
  sessionKey,
  recipientKeysForRequest,
  create,
  listForKeys,
  countUnread,
  getForKeys,
  markRead,
  markAllRead,
  pruneOld,
  RETENTION_DAYS,
};
