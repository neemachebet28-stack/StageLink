// ==================================================
// StageLink — towns data access
// ==================================================
const { pool } = require('../config/db');

/**
 * Towns within a county, optionally filtered by search, with a count
 * of active stages in each town.
 */
async function listTownsByCounty(countyId, { search } = {}) {
  const params = [countyId];
  let searchClause = '';

  if (search) {
    searchClause = 'AND t.name LIKE ?';
    params.push(`%${search}%`);
  }

  const [rows] = await pool.query(
    `SELECT t.id, t.name, t.county_id, COUNT(s.id) AS stage_count
     FROM towns t
     LEFT JOIN stages s ON s.town_id = t.id AND s.status = 'active'
     WHERE t.county_id = ? ${searchClause}
     GROUP BY t.id, t.name, t.county_id
     ORDER BY t.name ASC`,
    params
  );
  return rows;
}

async function getTownById(townId) {
  const [rows] = await pool.query(
    `SELECT t.*, c.name AS county_name, c.id AS county_id
     FROM towns t
     JOIN counties c ON c.id = t.county_id
     WHERE t.id = ?`,
    [townId]
  );
  return rows[0] || null;
}

/**
 * Search towns by name across all counties (used by the manual stage
 * search when a person types a town name rather than picking a county
 * first).
 */
async function searchTowns(search, { limit = 10 } = {}) {
  const [rows] = await pool.query(
    `SELECT t.id, t.name, c.name AS county_name
     FROM towns t
     JOIN counties c ON c.id = t.county_id
     WHERE t.name LIKE ?
     ORDER BY t.name ASC
     LIMIT ?`,
    [`%${search}%`, limit]
  );
  return rows;
}

module.exports = { listTownsByCounty, getTownById, searchTowns };
