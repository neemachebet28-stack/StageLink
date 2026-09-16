// ==================================================
// StageLink — payments (M-Pesa state machine)
// ==================================================
// initiatePayment() is the only way a payment attempt gets created,
// and it only ever computes the amount from the bookings' own
// fare_kes — never from anything the client sends. processCallback()
// is the ONLY place a payment (and therefore a booking) is ever
// marked successful, and it is idempotent: a checkout_request_id
// already in a terminal state (success/failed/cancelled) is
// recognized and left alone rather than reprocessed, so a duplicate
// or retried callback from Daraja can never double-apply a payment.
const { pool } = require('../config/db');
const bookingsModel = require('./bookings');
const ticketsModel = require('./tickets');
const groupBookingsModel = require('./groupBookings');
const notifier = require('../services/notifier');
const mpesa = require('../services/mpesa');

const IN_PROGRESS_WINDOW_MINUTES = 3;

async function getLatestPaymentForReference(reference) {
  const [rows] = await pool.query(
    `SELECT * FROM payments WHERE booking_reference = ? ORDER BY id DESC LIMIT 1`,
    [reference]
  );
  return rows[0] || null;
}

/**
 * Kicks off a payment attempt for a booking reference — individual
 * seat bookings (Phase 4/5) and group charter bookings (Phase 9)
 * share this one function rather than a parallel/shortened path for
 * group charters. Every guard here runs server-side against the
 * database, never against anything the client asserts:
 *  - ownership: the booking(s) must belong to this session
 *  - not already paid: an existing 'success' payment blocks a new one
 *  - not a duplicate in flight: a recent pending/processing payment
 *    blocks a second STK push rather than spamming the phone
 *  - not expired: the booking's own payment_due_at must not have passed
 *  - amount: always computed from the actual pending booking row(s),
 *    never from anything the client sends
 */
async function initiatePayment({ bookingReference, sessionId, phoneNumber }) {
  // Ownership check against ALL rows for this reference regardless of
  // status, so "not yours" and "already paid" can be told apart from
  // a plain 404 further down. Try individual bookings first, then
  // fall back to a group booking — a reference belongs to exactly one
  // of the two.
  let owned = await bookingsModel.getBookingsByReference(bookingReference, sessionId);
  let isGroup = false;

  if (owned.length === 0) {
    const groupBooking = await groupBookingsModel.getGroupBookingByReference(bookingReference, sessionId);
    if (groupBooking) {
      owned = [groupBooking];
      isGroup = true;
    }
  }

  if (owned.length === 0) {
    return { ok: false, reason: 'not_found' };
  }

  const existing = await getLatestPaymentForReference(bookingReference);
  if (existing && existing.status === 'success') {
    return { ok: false, reason: 'already_paid' };
  }

  const bookings = isGroup
    ? owned.filter((b) => b.status === 'pending')
    : await bookingsModel.getPendingBookingsForPayment(bookingReference, sessionId);

  if (bookings.length === 0) {
    // Owned, not already paid, but nothing pending — must have expired.
    return { ok: false, reason: 'booking_expired' };
  }

  const now = new Date();
  const anyExpired = bookings.some((b) => new Date(b.payment_due_at) <= now);
  if (anyExpired) {
    return { ok: false, reason: 'booking_expired' };
  }

  if (existing && (existing.status === 'pending' || existing.status === 'processing')) {
    const ageMinutes = (now - new Date(existing.created_at)) / 60000;
    if (ageMinutes < IN_PROGRESS_WINDOW_MINUTES) {
      return { ok: false, reason: 'payment_in_progress' };
    }
  }

  const amountKes = isGroup
    ? Number(bookings[0].agreed_price_kes)
    : bookings.reduce((sum, b) => sum + Number(b.fare_kes), 0);
  const organizationId = bookings[0].organization_id;

  const [result] = await pool.query(
    `INSERT INTO payments (booking_reference, organization_id, session_id, phone_number, amount_kes, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    [bookingReference, organizationId, sessionId, phoneNumber, amountKes]
  );
  const paymentId = result.insertId;

  const stkParams = {
    phoneNumber,
    amount: amountKes,
    accountReference: bookingReference,
    transactionDesc: `StageLink booking ${bookingReference}`,
  };

  try {
    let stkResult;
    if (mpesa.isConfigured) {
      stkResult = await mpesa.realInitiateStkPush(stkParams);
    } else {
      stkResult = await mpesa.sandboxInitiateStkPush(stkParams, processCallback);
    }

    await pool.query(
      `UPDATE payments
       SET merchant_request_id = ?, checkout_request_id = ?, status = 'processing', initiated_at = NOW()
       WHERE id = ?`,
      [stkResult.merchantRequestId, stkResult.checkoutRequestId, paymentId]
    );

    return {
      ok: true,
      paymentId,
      checkoutRequestId: stkResult.checkoutRequestId,
      amountKes,
      sandbox: !mpesa.isConfigured,
    };
  } catch (error) {
    await pool.query(
      `UPDATE payments SET status = 'failed', result_desc = ?, completed_at = NOW() WHERE id = ?`,
      [error.message.slice(0, 255), paymentId]
    );
    return { ok: false, reason: 'mpesa_error', message: error.message };
  }
}

/**
 * Processes a Daraja callback (real webhook or sandbox simulation —
 * same function either way, see services/mpesa.js). Locks the
 * payment row, and if it's already in a terminal state, returns
 * without touching anything: this is what makes a duplicate or
 * retried callback safe to receive twice.
 */
async function processCallback({ checkoutRequestId, resultCode, resultDesc, mpesaReceiptNumber }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT * FROM payments WHERE checkout_request_id = ? FOR UPDATE`,
      [checkoutRequestId]
    );
    const payment = rows[0];

    if (!payment) {
      await connection.rollback();
      return { ok: false, reason: 'unknown_checkout_request_id' };
    }

    if (['success', 'failed', 'cancelled'].includes(payment.status)) {
      // Already processed — duplicate/retried callback, ignored.
      await connection.rollback();
      return { ok: true, alreadyProcessed: true };
    }

    const newStatus = resultCode === 0 ? 'success' : resultCode === 1032 ? 'cancelled' : 'failed';

    await connection.query(
      `UPDATE payments
       SET status = ?, result_code = ?, result_desc = ?, mpesa_receipt_number = ?, completed_at = NOW()
       WHERE id = ?`,
      [newStatus, resultCode, resultDesc, mpesaReceiptNumber || null, payment.id]
    );

    if (newStatus === 'success') {
      // Both calls are safe to run unconditionally: each is a no-op
      // UPDATE (0 rows matched) if this reference belongs to the
      // other kind of booking — see the module note above.
      await bookingsModel.confirmBookingsByReference(connection, payment.booking_reference);
      // Booking → Ticket → QR code, strictly inside this same verified-
      // payment transaction — see the note in database.sql. Only ever
      // produces tickets for individual seat bookings; group charters
      // don't have per-seat tickets.
      await ticketsModel.generateTicketsForReference(connection, payment.booking_reference);
      await groupBookingsModel.confirmGroupBookingByReference(connection, payment.booking_reference);
    }

    await connection.commit();

    // After commit, and only on a real transition (a duplicate callback
    // returned earlier as alreadyProcessed and never reaches this line).
    await notifier.onPaymentResult({
      payment,
      status: newStatus,
      mpesaReceiptNumber,
      resultDesc,
    });

    return { ok: true, status: newStatus };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { initiatePayment, processCallback, getLatestPaymentForReference };
