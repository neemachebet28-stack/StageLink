// ==================================================
// StageLink — group/event transport quotations
// ==================================================
const { pool } = require('../config/db');

/**
 * Every quotation on a request, with the quoting operator's name and
 * real verification status — used on the passenger's compare page.
 * Withdrawn quotations are excluded; rejected ones are still shown so
 * the passenger can see their own decision history.
 */
async function listQuotationsForRequest(requestId) {
  const [rows] = await pool.query(
    `SELECT gq.*, o.name AS organization_name, o.verification_status
     FROM group_quotations gq
     JOIN organizations o ON o.id = gq.organization_id
     WHERE gq.group_request_id = ? AND gq.status != 'withdrawn'
     ORDER BY gq.price_kes ASC`,
    [requestId]
  );
  return rows;
}

async function getQuotationForOperator(quotationId, organizationId) {
  const [rows] = await pool.query(
    `SELECT * FROM group_quotations WHERE id = ? AND organization_id = ?`,
    [quotationId, organizationId]
  );
  return rows[0] || null;
}

async function getQuotationById(quotationId) {
  const [rows] = await pool.query('SELECT * FROM group_quotations WHERE id = ?', [quotationId]);
  return rows[0] || null;
}

async function getOwnQuotationForRequest(requestId, organizationId) {
  const [rows] = await pool.query(
    `SELECT * FROM group_quotations WHERE group_request_id = ? AND organization_id = ?`,
    [requestId, organizationId]
  );
  return rows[0] || null;
}

/**
 * Submits a new quotation, or updates the operator's existing one on
 * this request ("modify quotation") — one active quotation per
 * operator per request, enforced by the unique key on
 * (group_request_id, organization_id).
 */
async function submitOrUpdateQuotation({ requestId, organizationId, priceKes, vehicleDetails, notes }) {
  await pool.query(
    `INSERT INTO group_quotations (group_request_id, organization_id, price_kes, vehicle_details, notes, status)
     VALUES (?, ?, ?, ?, ?, 'pending')
     ON DUPLICATE KEY UPDATE
       price_kes = VALUES(price_kes),
       vehicle_details = VALUES(vehicle_details),
       notes = VALUES(notes),
       status = 'pending'`,
    [requestId, organizationId, priceKes, vehicleDetails || null, notes || null]
  );
}

async function withdrawQuotation(quotationId, organizationId) {
  const [result] = await pool.query(
    `UPDATE group_quotations SET status = 'withdrawn' WHERE id = ? AND organization_id = ? AND status = 'pending'`,
    [quotationId, organizationId]
  );
  return result.affectedRows > 0;
}

/**
 * A passenger declining a specific offer — doesn't affect the
 * request's overall status, just that one quotation.
 */
async function rejectQuotationAsPassenger(quotationId, requestId) {
  const [result] = await pool.query(
    `UPDATE group_quotations SET status = 'rejected' WHERE id = ? AND group_request_id = ? AND status = 'pending'`,
    [quotationId, requestId]
  );
  return result.affectedRows > 0;
}

async function listQuotationsForOrganization(organizationId) {
  const [rows] = await pool.query(
    `SELECT gq.*, gr.request_reference, gr.origin_text, gr.destination_text,
            gr.travel_date, gr.passenger_count, gr.status AS request_status
     FROM group_quotations gq
     JOIN group_requests gr ON gr.id = gq.group_request_id
     WHERE gq.organization_id = ?
     ORDER BY gq.created_at DESC`,
    [organizationId]
  );
  return rows;
}

module.exports = {
  listQuotationsForRequest,
  getQuotationForOperator,
  getQuotationById,
  getOwnQuotationForRequest,
  submitOrUpdateQuotation,
  withdrawQuotation,
  rejectQuotationAsPassenger,
  listQuotationsForOrganization,
};
