// ==================================================
// StageLink — MySQL-backed session store
// ==================================================
// Replaces express-session's MemoryStore, which leaks memory, loses
// every session (including a passenger's in-progress booking) on
// restart, and can't be shared across processes. Expiry is evaluated
// by the database clock (NOW()) so it can't drift from the app server.
const session = require('express-session');

const DEFAULT_TTL_SECONDS = 8 * 60 * 60;

function ttlSeconds(sess) {
  const cookie = sess && sess.cookie;
  let ms = null;
  if (cookie && typeof cookie.maxAge === 'number') ms = cookie.maxAge;
  else if (cookie && typeof cookie.originalMaxAge === 'number') ms = cookie.originalMaxAge;
  return Math.max(60, Math.round((ms || DEFAULT_TTL_SECONDS * 1000) / 1000));
}

class MySQLSessionStore extends session.Store {
  constructor(pool) {
    super();
    this.pool = pool;
  }

  get(sid, callback) {
    this.pool
      .query('SELECT data FROM sessions WHERE sid = ? AND expires_at > NOW()', [sid])
      .then(([rows]) => {
        if (rows.length === 0) return callback(null, null);
        try {
          return callback(null, JSON.parse(rows[0].data));
        } catch (error) {
          return callback(error);
        }
      })
      .catch(callback);
  }

  set(sid, sess, callback) {
    this.pool
      .query(
        `INSERT INTO sessions (sid, data, expires_at)
         VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))
         ON DUPLICATE KEY UPDATE data = VALUES(data), expires_at = VALUES(expires_at)`,
        [sid, JSON.stringify(sess), ttlSeconds(sess)]
      )
      .then(() => callback && callback(null))
      .catch((error) => callback && callback(error));
  }

  touch(sid, sess, callback) {
    this.pool
      .query('UPDATE sessions SET expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE sid = ?', [ttlSeconds(sess), sid])
      .then(() => callback && callback(null))
      .catch((error) => callback && callback(error));
  }

  destroy(sid, callback) {
    this.pool
      .query('DELETE FROM sessions WHERE sid = ?', [sid])
      .then(() => callback && callback(null))
      .catch((error) => callback && callback(error));
  }

  async pruneExpired() {
    const [result] = await this.pool.query('DELETE FROM sessions WHERE expires_at <= NOW()');
    return result.affectedRows;
  }
}

module.exports = { MySQLSessionStore };
