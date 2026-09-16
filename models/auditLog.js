// ==================================================
// StageLink — audit logging
// ==================================================
// record() is called from every admin write action that changes
// platform state (verification status, suspension, review
// moderation). It never blocks or rolls back the action it's
// recording — a failed audit write is logged to the console, not
// allowed to undo something an admin just did.
const { pool } = require('../config/db');

async function record({ actorUserId, action, targetType, targetId, details }) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)`,
      [actorUserId, action, targetType, targetId || null, details ? JSON.stringify(details) : null]
    );
  } catch (error) {
    console.error('[audit-log] failed to record:', action, error.message);
  }
}

async function list({ limit = 100 } = {}) {
  const [rows] = await pool.query(
    `SELECT al.*, u.full_name AS actor_name, u.email AS actor_email
     FROM audit_logs al
     JOIN users u ON u.id = al.actor_user_id
     ORDER BY al.created_at DESC, al.id DESC
     LIMIT ?`,
    [limit]
  );
  return rows;
}

module.exports = { record, list };
