// Usage:  NEW_PASSWORD='a-long-passphrase' node scripts/set-password.js user@example.com
// Rotates a user's password (e.g. replacing the published demo credentials
// before going to production). The password is read from the environment,
// not argv, so it doesn't land in shell history or process listings.
require('dotenv').config();
const bcrypt = require('bcrypt');
const { pool } = require('../config/db');

(async () => {
  const email = (process.argv[2] || '').trim().toLowerCase();
  const password = process.env.NEW_PASSWORD || '';
  if (!email || password.length < 12) {
    console.error("Usage: NEW_PASSWORD='<at least 12 characters>' node scripts/set-password.js user@example.com");
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  const [result] = await pool.query('UPDATE users SET password_hash = ? WHERE email = ?', [hash, email]);
  console.log(result.affectedRows ? `Password updated for ${email}` : `No user found with email ${email}`);
  await pool.end();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
