// ==================================================
// StageLink — operator (organization) data access
// ==================================================
// "Operator" is the organizations table viewed from the passenger
// side — see the note in database.sql for why there is no separate
// operators table.
const { pool } = require('../config/db');

async function listOperators({ search } = {}) {
  const params = [];
  let where = "WHERE o.status = 'active'";

  if (search) {
    where += ' AND o.name LIKE ?';
    params.push(`%${search}%`);
  }

  const [rows] = await pool.query(
    `SELECT o.id, o.name, o.slug, o.logo_url, o.description, o.verification_status,
            COUNT(DISTINCT os.stage_id) AS stage_count,
            COUNT(DISTINCT r.id) AS route_count
     FROM organizations o
     LEFT JOIN operator_stages os ON os.organization_id = o.id
     LEFT JOIN routes r ON r.organization_id = o.id AND r.status = 'active'
     ${where}
     GROUP BY o.id, o.name, o.slug, o.logo_url, o.description, o.verification_status
     ORDER BY o.name ASC`,
    params
  );
  return rows;
}

async function getOperatorById(organizationId) {
  const [rows] = await pool.query(
    `SELECT o.*
     FROM organizations o
     WHERE o.id = ? AND o.status = 'active'`,
    [organizationId]
  );
  return rows[0] || null;
}

/**
 * The stages an operator serves, with town/county for display —
 * this is the operator's "service area".
 */
async function listStagesForOperator(organizationId) {
  const [rows] = await pool.query(
    `SELECT s.id, s.name AS stage_name, t.name AS town_name, c.name AS county_name
     FROM operator_stages os
     JOIN stages s ON s.id = os.stage_id
     JOIN towns t ON t.id = s.town_id
     JOIN counties c ON c.id = t.county_id
     WHERE os.organization_id = ? AND s.status = 'active'
     ORDER BY c.name ASC, t.name ASC, s.name ASC`,
    [organizationId]
  );
  return rows;
}

/**
 * The routes an operator runs, joined with origin stage and
 * destination for display on the operator's profile page.
 */
async function listRoutesForOperator(organizationId) {
  const [rows] = await pool.query(
    `SELECT r.id, r.name, r.distance_km, r.typical_duration_minutes, r.base_fare_kes,
            os.id AS origin_stage_id, os.name AS origin_stage_name,
            d.id AS destination_id, d.name AS destination_name
     FROM routes r
     JOIN stages os ON os.id = r.origin_stage_id
     JOIN destinations d ON d.id = r.destination_id
     WHERE r.organization_id = ? AND r.status = 'active'
     ORDER BY d.name ASC`,
    [organizationId]
  );
  return rows;
}

module.exports = {
  listOperators,
  getOperatorById,
  listStagesForOperator,
  listRoutesForOperator,
};
