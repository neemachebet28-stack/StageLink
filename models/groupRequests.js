// ==================================================
// StageLink — group/event transport requests
// ==================================================
// A request is deliberately visible to every operator (see the note
// in database.sql) — ownership for the passenger side is by
// session_id, the same pattern as bookings and seat holds.
const crypto = require('crypto');
const { pool } = require('../config/db');

function generateRequestReference() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let ref = 'GR-';
  for (let i = 0; i < 8; i += 1) ref += chars[Math.floor(Math.random() * chars.length)];
  return ref;
}

async function createRequest(fields) {
  const reference = generateRequestReference();
  await pool.query(
    `INSERT INTO group_requests
       (request_reference, session_id, passenger_name, passenger_phone, passenger_email,
        passenger_count, origin_text, origin_county_id, destination_text, destination_county_id,
        travel_date, departure_time, return_date, return_time,
        vehicle_requirements, budget_kes, notes, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
    [
      reference,
      fields.sessionId,
      fields.passengerName,
      fields.passengerPhone,
      fields.passengerEmail || null,
      fields.passengerCount,
      fields.originText,
      fields.originCountyId || null,
      fields.destinationText,
      fields.destinationCountyId || null,
      fields.travelDate,
      fields.departureTime || null,
      fields.returnDate || null,
      fields.returnTime || null,
      fields.vehicleRequirements || null,
      fields.budgetKes || null,
      fields.notes || null,
    ]
  );
  return reference;
}

/**
 * A request as its own owner (passenger session) sees it — used for
 * the passenger's "view my request + compare quotations" page.
 */
async function getRequestByReferenceForSession(reference, sessionId) {
  const [rows] = await pool.query(
    `SELECT * FROM group_requests WHERE request_reference = ? AND session_id = ?`,
    [reference, sessionId]
  );
  return rows[0] || null;
}

/**
 * A request as any operator may see it — deliberately NOT scoped to
 * an organization_id, since every operator can browse and quote on
 * open requests. Only 'open' requests are listed by default so
 * operators aren't shown ones that are already spoken for.
 */
async function listOpenRequests() {
  const [rows] = await pool.query(
    `SELECT gr.*, oc.name AS origin_county_name, dc.name AS destination_county_name,
            (SELECT COUNT(*) FROM group_quotations gq WHERE gq.group_request_id = gr.id AND gq.status = 'pending') AS quotation_count
     FROM group_requests gr
     LEFT JOIN counties oc ON oc.id = gr.origin_county_id
     LEFT JOIN counties dc ON dc.id = gr.destination_county_id
     WHERE gr.status = 'open'
     ORDER BY gr.travel_date ASC`
  );
  return rows;
}

async function getRequestById(requestId) {
  const [rows] = await pool.query('SELECT * FROM group_requests WHERE id = ?', [requestId]);
  return rows[0] || null;
}

async function markRequestAccepted(connection, requestId) {
  await connection.query(`UPDATE group_requests SET status = 'accepted' WHERE id = ?`, [requestId]);
}

async function markRequestCompleted(connection, requestId) {
  await connection.query(
    `UPDATE group_requests SET status = 'completed' WHERE id = ? AND status = 'accepted'`,
    [requestId]
  );
}

module.exports = {
  createRequest,
  getRequestByReferenceForSession,
  listOpenRequests,
  getRequestById,
  markRequestAccepted,
  markRequestCompleted,
};
