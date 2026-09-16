// ==================================================
// StageLink — group bookings (quotation → booking → payment)
// ==================================================
// acceptQuotation is the one place "quotation → booking" happens, and
// it's fully transactional: the request and quotation rows are locked
// before anything is written, so two simultaneous accept attempts (or
// an accept racing a withdraw) can't both succeed. The booking this
// creates starts 'pending', with the same payment_due_at expiry
// pattern as an individual seat booking — group charters go through
// the identical payment gate, not a shortcut. See models/payments.js
// for how the same initiatePayment/processCallback functions serve
// both individual and group bookings via booking_reference.
const { pool } = require('../config/db');
const groupRequestsModel = require('./groupRequests');

const PAYMENT_WINDOW_MINUTES = 15;

function generateBookingReference() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let ref = 'GB-';
  for (let i = 0; i < 8; i += 1) ref += chars[Math.floor(Math.random() * chars.length)];
  return ref;
}

async function acceptQuotation({ requestReference, quotationId, sessionId }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [requestRows] = await connection.query(
      `SELECT * FROM group_requests WHERE request_reference = ? AND session_id = ? FOR UPDATE`,
      [requestReference, sessionId]
    );
    const request = requestRows[0];
    if (!request) {
      await connection.rollback();
      return { ok: false, reason: 'not_found' };
    }
    if (request.status !== 'open') {
      await connection.rollback();
      return { ok: false, reason: 'request_not_open' };
    }

    const [quotationRows] = await connection.query(
      `SELECT * FROM group_quotations WHERE id = ? AND group_request_id = ? AND status = 'pending' FOR UPDATE`,
      [quotationId, request.id]
    );
    const quotation = quotationRows[0];
    if (!quotation) {
      await connection.rollback();
      return { ok: false, reason: 'quotation_not_available' };
    }

    await connection.query(`UPDATE group_quotations SET status = 'accepted' WHERE id = ?`, [quotation.id]);
    await connection.query(
      `UPDATE group_quotations SET status = 'rejected' WHERE group_request_id = ? AND id != ? AND status = 'pending'`,
      [request.id, quotation.id]
    );
    await groupRequestsModel.markRequestAccepted(connection, request.id);

    const reference = generateBookingReference();
    const paymentDueAt = new Date(Date.now() + PAYMENT_WINDOW_MINUTES * 60000);

    await connection.query(
      `INSERT INTO group_bookings
         (booking_reference, group_request_id, group_quotation_id, organization_id, session_id,
          passenger_name, passenger_phone, passenger_count, agreed_price_kes, payment_due_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        reference,
        request.id,
        quotation.id,
        quotation.organization_id,
        sessionId,
        request.passenger_name,
        request.passenger_phone,
        request.passenger_count,
        quotation.price_kes,
        paymentDueAt,
      ]
    );

    await connection.commit();
    return { ok: true, reference };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Ownership lookup by reference — same role as
 * bookingsModel.getBookingsByReference for individual bookings.
 */
async function getGroupBookingByReference(reference, sessionId) {
  const [rows] = await pool.query(
    `SELECT gb.*, gr.origin_text, gr.destination_text, gr.travel_date, gr.departure_time,
            o.name AS organization_name, o.verification_status
     FROM group_bookings gb
     JOIN group_requests gr ON gr.id = gb.group_request_id
     JOIN organizations o ON o.id = gb.organization_id
     WHERE gb.booking_reference = ? AND gb.session_id = ?`,
    [reference, sessionId]
  );
  return rows[0] || null;
}

async function getPendingGroupBookingForPayment(reference, sessionId) {
  const booking = await getGroupBookingByReference(reference, sessionId);
  return booking && booking.status === 'pending' ? booking : null;
}

/**
 * Called from models/payments.js's processCallback alongside (not
 * instead of) the individual-booking confirmation — this UPDATE is a
 * harmless no-op if the reference belongs to an individual booking
 * instead, since booking_reference won't match any row here.
 */
async function confirmGroupBookingByReference(connection, reference) {
  const [rows] = await connection.query(
    `SELECT id, group_request_id FROM group_bookings WHERE booking_reference = ? AND status = 'pending'`,
    [reference]
  );
  if (rows.length === 0) return;

  await connection.query(`UPDATE group_bookings SET status = 'confirmed' WHERE booking_reference = ?`, [reference]);
  await groupRequestsModel.markRequestCompleted(connection, rows[0].group_request_id);
}

/**
 * Same sweep pattern as expireStaleHoldsGlobal / expireStaleBookings —
 * a group booking never paid within its window releases the
 * quotation's hold on the request rather than blocking it forever.
 */
async function expireStaleGroupBookings() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [stale] = await connection.query(
      `SELECT id, group_request_id FROM group_bookings WHERE status = 'pending' AND payment_due_at <= NOW() FOR UPDATE`
    );

    if (stale.length > 0) {
      const ids = stale.map((b) => b.id);
      const requestIds = stale.map((b) => b.group_request_id);
      await connection.query(`UPDATE group_bookings SET status = 'expired' WHERE id IN (?)`, [ids]);
      await connection.query(
        `UPDATE group_requests SET status = 'open' WHERE id IN (?) AND status = 'accepted'`,
        [requestIds]
      );
    }

    await connection.commit();
    return stale.length;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  acceptQuotation,
  getGroupBookingByReference,
  getPendingGroupBookingForPayment,
  confirmGroupBookingByReference,
  expireStaleGroupBookings,
};
