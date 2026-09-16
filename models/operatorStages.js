// ==================================================
// StageLink — operator service area (stages) management
// ==================================================
// Stages themselves are a shared, platform-wide directory (Phase 2) —
// what's organization-scoped here is which stages this operator
// serves (operator_stages), enforced on every query.
const { pool } = require('../config/db');

async function listStagesForOrganization(organizationId) {
  const [rows] = await pool.query(
    `SELECT os.id AS link_id, s.id AS stage_id, s.name, t.name AS town_name, c.name AS county_name
     FROM operator_stages os
     JOIN stages s ON s.id = os.stage_id
     JOIN towns t ON t.id = s.town_id
     JOIN counties c ON c.id = t.county_id
     WHERE os.organization_id = ?
     ORDER BY c.name ASC, t.name ASC, s.name ASC`,
    [organizationId]
  );
  return rows;
}

/**
 * Stages this operator does NOT yet serve, for the "add a stage"
 * picker — so the form only ever offers a stage once.
 */
async function listAvailableStagesToAdd(organizationId) {
  const [rows] = await pool.query(
    `SELECT s.id, s.name, t.name AS town_name, c.name AS county_name
     FROM stages s
     JOIN towns t ON t.id = s.town_id
     JOIN counties c ON c.id = t.county_id
     WHERE s.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM operator_stages os WHERE os.stage_id = s.id AND os.organization_id = ?
       )
     ORDER BY c.name ASC, t.name ASC, s.name ASC`,
    [organizationId]
  );
  return rows;
}

async function addStageToOrganization(organizationId, stageId) {
  await pool.query(
    `INSERT IGNORE INTO operator_stages (organization_id, stage_id) VALUES (?, ?)`,
    [organizationId, stageId]
  );
}

/**
 * Removes a stage from this operator's service area. Scoped by
 * organization_id in the WHERE clause itself — deleting by link_id
 * alone would let an operator remove a row it doesn't own if it
 * guessed another org's link_id.
 */
async function removeStageFromOrganization(organizationId, linkId) {
  const [result] = await pool.query(
    `DELETE FROM operator_stages WHERE id = ? AND organization_id = ?`,
    [linkId, organizationId]
  );
  return result.affectedRows > 0;
}

module.exports = {
  listStagesForOrganization,
  listAvailableStagesToAdd,
  addStageToOrganization,
  removeStageFromOrganization,
};
