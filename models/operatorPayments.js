// ==================================================
// StageLink — operator payments view
// ==================================================
const { pool } = require('../config/db');

async function listPaymentsForOrganization(organizationId) {
  const [rows] = await pool.query(
    `SELECT p.id, p.booking_reference, p.phone_number, p.amount_kes, p.status,
            p.mpesa_receipt_number, p.result_desc, p.created_at, p.completed_at
     FROM payments p
     WHERE p.organization_id = ?
     ORDER BY p.created_at DESC
     LIMIT 200`,
    [organizationId]
  );
  return rows;
}

module.exports = { listPaymentsForOrganization };
