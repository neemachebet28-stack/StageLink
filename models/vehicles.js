// ==================================================
// StageLink — vehicles data access
// ==================================================
// Every query here is scoped to an organization_id — vehicles are
// tenant-owned and must never be visible or assignable across tenants.
const { pool } = require('../config/db');

async function listVehiclesForOrganization(organizationId) {
  const [rows] = await pool.query(
    `SELECT v.*, vsl.name AS seat_layout_name, vsl.total_seats
     FROM vehicles v
     JOIN vehicle_seat_layouts vsl ON vsl.id = v.seat_layout_id
     WHERE v.organization_id = ? AND v.status = 'active'
     ORDER BY v.registration_number ASC`,
    [organizationId]
  );
  return rows;
}

async function getVehicleForOrganization(vehicleId, organizationId) {
  const [rows] = await pool.query(
    `SELECT v.* FROM vehicles v WHERE v.id = ? AND v.organization_id = ?`,
    [vehicleId, organizationId]
  );
  return rows[0] || null;
}

async function createVehicle({ organizationId, seatLayoutId, registrationNumber, vehicleType, makeModel }) {
  const [result] = await pool.query(
    `INSERT INTO vehicles (organization_id, seat_layout_id, registration_number, vehicle_type, make_model, status)
     VALUES (?, ?, ?, ?, ?, 'active')`,
    [organizationId, seatLayoutId, registrationNumber, vehicleType || null, makeModel || null]
  );
  return result.insertId;
}

async function updateVehicle(vehicleId, organizationId, { seatLayoutId, vehicleType, makeModel, status }) {
  const [result] = await pool.query(
    `UPDATE vehicles SET seat_layout_id = ?, vehicle_type = ?, make_model = ?, status = ?
     WHERE id = ? AND organization_id = ?`,
    [seatLayoutId, vehicleType || null, makeModel || null, status, vehicleId, organizationId]
  );
  return result.affectedRows > 0;
}

module.exports = {
  listVehiclesForOrganization,
  getVehicleForOrganization,
  createVehicle,
  updateVehicle,
};
