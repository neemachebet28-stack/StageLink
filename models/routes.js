// ==================================================
// StageLink — routes data access
// ==================================================
const { pool } = require('../config/db');

async function getRouteById(routeId) {
  const [rows] = await pool.query(
    `SELECT r.*,
            s.id AS origin_stage_id, s.name AS origin_stage_name,
            st.name AS origin_town_name, sc.name AS origin_county_name,
            d.id AS destination_id, d.name AS destination_name,
            o.id AS organization_id, o.name AS organization_name,
            o.slug AS organization_slug, o.verification_status
     FROM routes r
     JOIN stages s ON s.id = r.origin_stage_id
     JOIN towns st ON st.id = s.town_id
     JOIN counties sc ON sc.id = st.county_id
     JOIN destinations d ON d.id = r.destination_id
     JOIN organizations o ON o.id = r.organization_id
     WHERE r.id = ?`,
    [routeId]
  );
  return rows[0] || null;
}

/**
 * Routes owned by an organization, shaped for the operator's "new
 * trip" form dropdown.
 */
async function listRoutesForOrganization(organizationId, { activeOnly = false } = {}) {
  const statusClause = activeOnly ? "AND r.status = 'active'" : '';
  const [rows] = await pool.query(
    `SELECT r.id, r.name, r.distance_km, r.typical_duration_minutes, r.base_fare_kes, r.status,
            s.name AS origin_stage_name, d.name AS destination_name
     FROM routes r
     JOIN stages s ON s.id = r.origin_stage_id
     JOIN destinations d ON d.id = r.destination_id
     WHERE r.organization_id = ? ${statusClause}
     ORDER BY r.name ASC`,
    [organizationId]
  );
  return rows;
}

async function getRouteForOrganization(routeId, organizationId) {
  const [rows] = await pool.query(
    `SELECT r.*, s.name AS origin_stage_name, d.name AS destination_name
     FROM routes r
     JOIN stages s ON s.id = r.origin_stage_id
     JOIN destinations d ON d.id = r.destination_id
     WHERE r.id = ? AND r.organization_id = ?`,
    [routeId, organizationId]
  );
  return rows[0] || null;
}

async function createRoute({ organizationId, originStageId, destinationId, name, distanceKm, durationMinutes, baseFareKes }) {
  const [result] = await pool.query(
    `INSERT INTO routes (organization_id, origin_stage_id, destination_id, name, distance_km, typical_duration_minutes, base_fare_kes, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
    [organizationId, originStageId, destinationId, name || null, distanceKm || null, durationMinutes || null, baseFareKes || null]
  );
  return result.insertId;
}

async function updateRoute(routeId, organizationId, { name, distanceKm, durationMinutes, baseFareKes, status }) {
  const [result] = await pool.query(
    `UPDATE routes
     SET name = ?, distance_km = ?, typical_duration_minutes = ?, base_fare_kes = ?, status = ?
     WHERE id = ? AND organization_id = ?`,
    [name || null, distanceKm || null, durationMinutes || null, baseFareKes || null, status, routeId, organizationId]
  );
  return result.affectedRows > 0;
}

module.exports = {
  getRouteById,
  listRoutesForOrganization,
  getRouteForOrganization,
  createRoute,
  updateRoute,
};
