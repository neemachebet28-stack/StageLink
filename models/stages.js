// ==================================================
// StageLink — stages data access
// ==================================================
const { pool } = require('../config/db');

async function listStagesByTown(townId) {
  const [rows] = await pool.query(
    `SELECT s.*
     FROM stages s
     WHERE s.town_id = ? AND s.status = 'active'
     ORDER BY s.name ASC`,
    [townId]
  );
  return rows;
}

async function getStageById(stageId) {
  const [rows] = await pool.query(
    `SELECT s.*, t.name AS town_name, t.id AS town_id,
            c.name AS county_name, c.id AS county_id
     FROM stages s
     JOIN towns t ON t.id = s.town_id
     JOIN counties c ON c.id = t.county_id
     WHERE s.id = ?`,
    [stageId]
  );
  return rows[0] || null;
}

/**
 * Manual stage search: matches on stage name, landmark, town name, or
 * county name, so "Nakuru" finds every stage in Nakuru town even if
 * the stage itself is called something else.
 */
async function searchStages(search, { limit = 20 } = {}) {
  const term = `%${search}%`;
  const [rows] = await pool.query(
    `SELECT s.id, s.name, s.landmark, t.name AS town_name, c.name AS county_name
     FROM stages s
     JOIN towns t ON t.id = s.town_id
     JOIN counties c ON c.id = t.county_id
     WHERE s.status = 'active'
       AND (s.name LIKE ? OR s.landmark LIKE ? OR t.name LIKE ? OR c.name LIKE ?)
     ORDER BY s.name ASC
     LIMIT ?`,
    [term, term, term, term, limit]
  );
  return rows;
}

/**
 * Nearby stages by straight-line (haversine) distance from a given
 * point. Stages without coordinates are excluded rather than guessed
 * into the result — an honest "we don't know where this one is yet"
 * is better than a wrong distance.
 */
async function findNearbyStages(latitude, longitude, { radiusKm = 15, limit = 10 } = {}) {
  const [rows] = await pool.query(
    `SELECT s.id, s.name, s.landmark, t.name AS town_name, c.name AS county_name,
            s.latitude, s.longitude,
            (6371 * ACOS(
              COS(RADIANS(?)) * COS(RADIANS(s.latitude)) *
              COS(RADIANS(s.longitude) - RADIANS(?)) +
              SIN(RADIANS(?)) * SIN(RADIANS(s.latitude))
            )) AS distance_km
     FROM stages s
     JOIN towns t ON t.id = s.town_id
     JOIN counties c ON c.id = t.county_id
     WHERE s.status = 'active'
       AND s.latitude IS NOT NULL
       AND s.longitude IS NOT NULL
     HAVING distance_km <= ?
     ORDER BY distance_km ASC
     LIMIT ?`,
    [latitude, longitude, latitude, radiusKm, limit]
  );
  return rows;
}

/**
 * Operators known to serve a stage, including their verification
 * status so the UI never has to guess or assume it.
 */
async function listOperatorsForStage(stageId) {
  const [rows] = await pool.query(
    `SELECT o.id, o.name, o.slug, o.logo_url, o.verification_status
     FROM operator_stages os
     JOIN organizations o ON o.id = os.organization_id
     WHERE os.stage_id = ? AND o.status = 'active'
     ORDER BY o.name ASC`,
    [stageId]
  );
  return rows;
}

/**
 * Routes departing from a stage, joined with destination and operator
 * so a stage's "where can I go from here" list is a single query.
 */
async function listRoutesFromStage(stageId) {
  const [rows] = await pool.query(
    `SELECT r.id, r.name, r.distance_km, r.typical_duration_minutes, r.base_fare_kes,
            d.id AS destination_id, d.name AS destination_name,
            o.id AS organization_id, o.name AS organization_name, o.verification_status
     FROM routes r
     JOIN destinations d ON d.id = r.destination_id
     JOIN organizations o ON o.id = r.organization_id
     WHERE r.origin_stage_id = ? AND r.status = 'active' AND o.status = 'active'
     ORDER BY d.name ASC`,
    [stageId]
  );
  return rows;
}

/**
 * Routes a specific operator runs from a specific stage — the
 * "Destination" step of Stage → Operator → Destination → Available Trips.
 */
async function listRoutesFromStageForOperator(stageId, organizationId) {
  const [rows] = await pool.query(
    `SELECT r.id, r.name, r.distance_km, r.typical_duration_minutes, r.base_fare_kes,
            d.id AS destination_id, d.name AS destination_name
     FROM routes r
     JOIN destinations d ON d.id = r.destination_id
     WHERE r.origin_stage_id = ? AND r.organization_id = ? AND r.status = 'active'
     ORDER BY d.name ASC`,
    [stageId, organizationId]
  );
  return rows;
}

module.exports = {
  listStagesByTown,
  getStageById,
  searchStages,
  findNearbyStages,
  listOperatorsForStage,
  listRoutesFromStage,
  listRoutesFromStageForOperator,
};
