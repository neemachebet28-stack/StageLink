// ==================================================
// StageLink — drivers data access
// ==================================================
const { pool } = require('../config/db');

async function listDriversForOrganization(organizationId) {
  const [rows] = await pool.query(
    `SELECT * FROM drivers WHERE organization_id = ? AND status = 'active' ORDER BY full_name ASC`,
    [organizationId]
  );
  return rows;
}

async function getDriverForOrganization(driverId, organizationId) {
  const [rows] = await pool.query(
    `SELECT * FROM drivers WHERE id = ? AND organization_id = ?`,
    [driverId, organizationId]
  );
  return rows[0] || null;
}

async function createDriver({ organizationId, fullName, phone, licenseNumber }) {
  const [result] = await pool.query(
    `INSERT INTO drivers (organization_id, full_name, phone, license_number, status)
     VALUES (?, ?, ?, ?, 'active')`,
    [organizationId, fullName, phone || null, licenseNumber || null]
  );
  return result.insertId;
}

async function updateDriver(driverId, organizationId, { fullName, phone, licenseNumber, status }) {
  const [result] = await pool.query(
    `UPDATE drivers SET full_name = ?, phone = ?, license_number = ?, status = ?
     WHERE id = ? AND organization_id = ?`,
    [fullName, phone || null, licenseNumber || null, status, driverId, organizationId]
  );
  return result.affectedRows > 0;
}

module.exports = {
  listDriversForOrganization,
  getDriverForOrganization,
  createDriver,
  updateDriver,
};
