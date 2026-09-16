// ==================================================
// StageLink — users data access
// ==================================================
const { pool } = require('../config/db');

/**
 * Looks up an active user by email, joined with their role name and
 * organization name, for login and session population. Returns the
 * password hash too — callers must never forward it into the session
 * or a response; it exists only for the login route's bcrypt.compare.
 */
async function findActiveUserByEmail(email) {
  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.password_hash, u.organization_id,
            r.name AS role, o.name AS organization_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN organizations o ON o.id = u.organization_id
     WHERE u.email = ? AND u.status = 'active'`,
    [email]
  );
  return rows[0] || null;
}

async function touchLastLogin(userId) {
  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [userId]);
}

module.exports = { findActiveUserByEmail, touchLastLogin };
