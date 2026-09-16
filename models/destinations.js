// ==================================================
// StageLink — destinations data access
// ==================================================
const { pool } = require('../config/db');

async function listDestinations({ search } = {}) {
  const params = [];
  let where = '';

  if (search) {
    where = 'WHERE d.name LIKE ?';
    params.push(`%${search}%`);
  }

  const [rows] = await pool.query(
    `SELECT d.id, d.name, d.description, c.name AS county_name,
            COUNT(r.id) AS route_count
     FROM destinations d
     JOIN counties c ON c.id = d.county_id
     LEFT JOIN routes r ON r.destination_id = d.id AND r.status = 'active'
     ${where}
     GROUP BY d.id, d.name, d.description, c.name
     ORDER BY d.name ASC`,
    params
  );
  return rows;
}

async function getDestinationById(destinationId) {
  const [rows] = await pool.query(
    `SELECT d.*, c.name AS county_name
     FROM destinations d
     JOIN counties c ON c.id = d.county_id
     WHERE d.id = ?`,
    [destinationId]
  );
  return rows[0] || null;
}

/**
 * Every active route that terminates at a destination, with its
 * origin stage and operator — "how do I get to Kisumu, and who runs
 * it" in one query.
 */
async function listRoutesToDestination(destinationId) {
  const [rows] = await pool.query(
    `SELECT r.id, r.name, r.distance_km, r.typical_duration_minutes, r.base_fare_kes,
            s.id AS origin_stage_id, s.name AS origin_stage_name,
            t.name AS origin_town_name,
            o.id AS organization_id, o.name AS organization_name, o.verification_status
     FROM routes r
     JOIN stages s ON s.id = r.origin_stage_id
     JOIN towns t ON t.id = s.town_id
     JOIN organizations o ON o.id = r.organization_id
     WHERE r.destination_id = ? AND r.status = 'active' AND o.status = 'active'
     ORDER BY o.name ASC`,
    [destinationId]
  );
  return rows;
}

module.exports = { listDestinations, getDestinationById, listRoutesToDestination };
