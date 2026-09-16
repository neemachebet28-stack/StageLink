// ==================================================
// StageLink — tickets, QR verification, boarding
// ==================================================
const crypto = require('crypto');
const { pool } = require('../config/db');
const notifier = require('../services/notifier');

function generateQrToken() {
  return crypto.randomBytes(24).toString('hex'); // 48 hex chars, unguessable
}

/**
 * Generates one ticket per newly-confirmed booking under a reference.
 * Called from inside models/payments.js's processCallback, using the
 * SAME transaction connection that just confirmed the bookings — a
 * ticket only ever comes into existence as part of that same atomic,
 * verified-payment-success operation. The NOT EXISTS guard makes this
 * safe to call defensively even if it were ever invoked twice.
 */
async function generateTicketsForReference(connection, bookingReference) {
  const [bookings] = await connection.query(
    `SELECT b.id, b.booking_reference, s.seat_number
     FROM bookings b
     JOIN seats s ON s.id = b.seat_id
     WHERE b.booking_reference = ? AND b.status = 'confirmed'
       AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.booking_id = b.id)`,
    [bookingReference]
  );

  for (const booking of bookings) {
    const ticketNumber = `${booking.booking_reference}-${booking.seat_number}`;
    const qrToken = generateQrToken();
    await connection.query(
      `INSERT INTO tickets (booking_id, ticket_number, qr_code_token, status) VALUES (?, ?, ?, 'valid')`,
      [booking.id, ticketNumber, qrToken]
    );
  }

  return bookings.length;
}

const TICKET_DETAIL_SELECT = `
  SELECT
    tk.id AS ticket_id, tk.ticket_number, tk.qr_code_token, tk.status AS ticket_status,
    tk.issued_at,
    b.id AS booking_id, b.booking_reference, b.passenger_name, b.passenger_phone,
    b.fare_kes, b.status AS booking_status, b.session_id,
    s.seat_number,
    t.id AS trip_id, t.scheduled_departure, t.estimated_departure, t.confirmed_departure,
    t.status AS trip_status,
    os.name AS origin_stage_name, d.name AS destination_name,
    v.registration_number,
    o.id AS organization_id, o.name AS organization_name, o.verification_status,
    p.status AS payment_status, p.mpesa_receipt_number, p.phone_number AS payer_phone,
    p.completed_at AS payment_completed_at,
    br.boarded_at, br.boarded_by_user_id
  FROM tickets tk
  JOIN bookings b ON b.id = tk.booking_id
  JOIN seats s ON s.id = b.seat_id
  JOIN trips t ON t.id = b.trip_id
  JOIN stages os ON os.id = b.origin_stage_id
  JOIN destinations d ON d.id = b.destination_id
  JOIN vehicles v ON v.id = t.vehicle_id
  JOIN organizations o ON o.id = b.organization_id
  LEFT JOIN payments p ON p.booking_reference = b.booking_reference AND p.status = 'success'
  LEFT JOIN boarding_records br ON br.ticket_id = tk.id
`;

/**
 * Every ticket for a booking reference, scoped to the session that
 * made the booking — same ownership model as bookings themselves
 * (see README: passenger accounts don't exist yet).
 */
async function getTicketsByReference(reference, sessionId) {
  const [rows] = await pool.query(
    `${TICKET_DETAIL_SELECT} WHERE b.booking_reference = ? AND b.session_id = ? ORDER BY s.seat_number ASC`,
    [reference, sessionId]
  );
  return rows;
}

/**
 * Looks up a ticket by its QR token for verification — the entire
 * point of this query is that it does NOT filter by organization, so
 * the caller can distinguish "no such ticket" from "this ticket
 * belongs to a different operator" and log the right scan_result.
 */
async function getTicketByToken(qrToken) {
  const [rows] = await pool.query(`${TICKET_DETAIL_SELECT} WHERE tk.qr_code_token = ?`, [qrToken]);
  return rows[0] || null;
}

async function getTicketById(ticketId) {
  const [rows] = await pool.query(`${TICKET_DETAIL_SELECT} WHERE tk.id = ?`, [ticketId]);
  return rows[0] || null;
}

async function recordVerificationScan({ ticketId, scannedToken, organizationId, userId, result }) {
  await pool.query(
    `INSERT INTO qr_verification_records (ticket_id, scanned_token, organization_id, scanned_by_user_id, scan_result)
     VALUES (?, ?, ?, ?, ?)`,
    [ticketId || null, scannedToken, organizationId, userId, result]
  );
}

/**
 * Marks a ticket boarded. Locks the ticket row and re-checks its
 * status at this exact moment (not the status the verification page
 * showed a moment ago) before writing anything — this, plus the
 * unique key on boarding_records.ticket_id, is what makes boarding
 * the same ticket twice impossible even if two staff scan it at once.
 */
async function markBoarded({ ticketId, organizationId, userId }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT tk.id, tk.status, t.id AS trip_id, b.organization_id
       FROM tickets tk
       JOIN bookings b ON b.id = tk.booking_id
       JOIN trips t ON t.id = b.trip_id
       WHERE tk.id = ? FOR UPDATE`,
      [ticketId]
    );
    const ticket = rows[0];

    if (!ticket || ticket.organization_id !== organizationId) {
      await connection.rollback();
      return { ok: false, reason: 'not_found' };
    }
    if (ticket.status === 'boarded') {
      await connection.rollback();
      return { ok: false, reason: 'already_boarded' };
    }
    if (ticket.status !== 'valid') {
      await connection.rollback();
      return { ok: false, reason: ticket.status };
    }

    await connection.query(`UPDATE tickets SET status = 'boarded' WHERE id = ?`, [ticketId]);
    await connection.query(
      `INSERT INTO boarding_records (ticket_id, trip_id, boarded_by_user_id) VALUES (?, ?, ?)`,
      [ticketId, ticket.trip_id, userId]
    );

    await connection.commit();
    await notifier.onBoarded(ticketId);
    return { ok: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  generateTicketsForReference,
  getTicketsByReference,
  getTicketByToken,
  getTicketById,
  recordVerificationScan,
  markBoarded,
};
