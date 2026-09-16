// ==================================================
// StageLink — counties data access
// ==================================================
const { pool } = require('../config/db');

/**
 * All counties, optionally filtered by a search term, with a count of
 * how many towns each one has (used on the county picker so an empty
 * county is visibly empty rather than indistinguishable from a full one).
 */
async function listCounties({ search } = {}) {
  const params = [];
  let where = '';

  if (search) {
    where = 'WHERE c.name LIKE ?';
    params.push(`%${search}%`);
  }

  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.code, COUNT(t.id) AS town_count
     FROM counties c
     LEFT JOIN towns t ON t.county_id = c.id
     ${where}
     GROUP BY c.id, c.name, c.code
     ORDER BY c.name ASC`,
    params
  );
  return rows;
}

async function getCountyById(countyId) {
  const [rows] = await pool.query('SELECT * FROM counties WHERE id = ?', [countyId]);
  return rows[0] || null;
}

module.exports = { listCounties, getCountyById };
