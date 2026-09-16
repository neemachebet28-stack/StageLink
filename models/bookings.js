// ==================================================
// StageLink — bookings (finalizing holds)
// ==================================================
// createBookingsFromHolds is the only path that ever sets a seat to
// 'booked'. It re-validates everything server-side from inside a
// locked transaction — the trip's status/departure, every hold's
// expiry, and every seat's current status — rather than trusting
// whatever the seat-selection page last showed the browser. A hold
// that expired one second before checkout is rejected here, not
// silently honored.
const { pool } = require('../config/db');

function generateBookingReference() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
  let ref = 'SL-';
  for (let i = 0; i < 8; i += 1) {
    ref += chars[Math.floor(Math.random() * chars.length)];
  }
  return ref;
}

async function createBookingsFromHolds({ tripId, sessionId, passengerName, passengerPhone }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [tripRows] = await connection.query(
      `SELECT id, organization_id, origin_stage_id, destination_id, fare_kes, status, scheduled_departure
       FROM trips WHERE id = ? FOR UPDATE`,
      [tripId]
    );
    const trip = tripRows[0];
    if (!trip || ['departed', 'arrived', 'cancelled'].includes(trip.status)) {
      await connection.rollback();
      return { ok: false, reason: 'trip_unavailable' };
    }
    if (new Date(trip.scheduled_departure) <= new Date()) {
      await connection.rollback();
      return { ok: false, reason: 'trip_departed' };
    }

    const [holdRows] = await connection.query(
      `SELECT sh.id AS hold_id, sh.seat_id, sh.expires_at, sh.status AS hold_status
       FROM seat_holds sh
       WHERE sh.trip_id = ? AND sh.session_id = ? AND sh.status = 'active'
       FOR UPDATE`,
      [tripId, sessionId]
    );

    if (holdRows.length === 0) {
      await connection.rollback();
      return { ok: false, reason: 'no_holds' };
    }

    const expired = holdRows.filter((h) => new Date(h.expires_at) <= new Date());
    if (expired.length > 0) {
      await connection.rollback();
      return { ok: false, reason: 'hold_expired' };
    }

    const seatIds = holdRows.map((h) => h.seat_id);
    const [seatRows] = await connection.query(
      `SELECT id, status FROM seats WHERE id IN (?) FOR UPDATE`,
      [seatIds]
    );
    const notHeld = seatRows.filter((s) => s.status !== 'held');
    if (notHeld.length > 0) {
      // Defensive: should be unreachable given the hold lock above, but
      // never assume — re-verify the seat itself before booking it.
      await connection.rollback();
      return { ok: false, reason: 'seat_no_longer_held' };
    }

    const reference = generateBookingReference();
    const PAYMENT_WINDOW_MINUTES = 15;
    const paymentDueAt = new Date(Date.now() + PAYMENT_WINDOW_MINUTES * 60000);

    for (const hold of holdRows) {
      await connection.query(
        `INSERT INTO bookings
           (booking_reference, organization_id, trip_id, seat_id, origin_stage_id, destination_id,
            session_id, passenger_name, passenger_phone, fare_kes, payment_due_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          reference,
          trip.organization_id,
          tripId,
          hold.seat_id,
          trip.origin_stage_id,
          trip.destination_id,
          sessionId,
          passengerName,
          passengerPhone,
          trip.fare_kes,
          paymentDueAt,
        ]
      );
      await connection.query(`UPDATE seats SET status = 'booked' WHERE id = ?`, [hold.seat_id]);
      await connection.query(`UPDATE seat_holds SET status = 'converted' WHERE id = ?`, [hold.hold_id]);
    }

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
 * Booking rows for a reference, scoped to the session that created
 * them (passenger accounts don't exist yet — see README). Joined with
 * trip/vehicle/route context for the confirmation page.
 */
async function getBookingsByReference(reference, sessionId) {
  const [rows] = await pool.query(
    `SELECT b.*, s.seat_number, s.seat_type,
            t.scheduled_departure, t.estimated_departure, t.confirmed_departure,
            os.name AS origin_stage_name, d.name AS destination_name,
            o.name AS organization_name, o.verification_status,
            v.registration_number
     FROM bookings b
     JOIN seats s ON s.id = b.seat_id
     JOIN trips t ON t.id = b.trip_id
     JOIN stages os ON os.id = b.origin_stage_id
     JOIN destinations d ON d.id = b.destination_id
     JOIN organizations o ON o.id = b.organization_id
     JOIN vehicles v ON v.id = t.vehicle_id
     WHERE b.booking_reference = ? AND b.session_id = ?
     ORDER BY s.seat_number ASC`,
    [reference, sessionId]
  );
  return rows;
}

/**
 * All 'pending' bookings for a reference, scoped to the session that
 * created them. Used by the payment flow to verify ownership and to
 * compute the amount server-side — the caller never accepts an
 * amount from the client.
 */
async function getPendingBookingsForPayment(reference, sessionId) {
  const [rows] = await pool.query(
    `SELECT b.*, s.seat_number
     FROM bookings b
     JOIN seats s ON s.id = b.seat_id
     WHERE b.booking_reference = ? AND b.session_id = ? AND b.status = 'pending'
     ORDER BY s.seat_number ASC`,
    [reference, sessionId]
  );
  return rows;
}

/**
 * Marks a reference's bookings 'confirmed' (called only from the
 * payment callback handler once a payment is verified SUCCESS — see
 * models/payments.js). Takes the transaction connection so this step
 * is part of the same atomic operation as recording the payment.
 */
async function confirmBookingsByReference(connection, reference) {
  await connection.query(
    `UPDATE bookings SET status = 'confirmed' WHERE booking_reference = ? AND status = 'pending'`,
    [reference]
  );
}

/**
 * Frees seats whose booking was never paid within its payment
 * window. Mirrors expireStaleHoldsGlobal in models/seatHolds.js —
 * called on the same kind of interval from server.js so a stale
 * pending booking doesn't hold a seat hostage indefinitely.
 */
async function expireStaleBookings() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [stale] = await connection.query(
      `SELECT id, seat_id FROM bookings WHERE status = 'pending' AND payment_due_at <= NOW() FOR UPDATE`
    );

    if (stale.length > 0) {
      const bookingIds = stale.map((b) => b.id);
      const seatIds = stale.map((b) => b.seat_id);
      await connection.query(`UPDATE bookings SET status = 'expired' WHERE id IN (?)`, [bookingIds]);
      await connection.query(`UPDATE seats SET status = 'available' WHERE id IN (?) AND status = 'booked'`, [
        seatIds,
      ]);
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

/**
 * Marks confirmed bookings on a trip 'completed' once the trip has
 * actually arrived — what makes a booking eligible for a review real
 * rather than assumed.
 */
async function completeBookingsForArrivedTrip(tripId) {
  await pool.query(
    `UPDATE bookings SET status = 'completed' WHERE trip_id = ? AND status = 'confirmed'`,
    [tripId]
  );
}

module.exports = {
  createBookingsFromHolds,
  completeBookingsForArrivedTrip,
  getBookingsByReference,
  getPendingBookingsForPayment,
  confirmBookingsByReference,
  expireStaleBookings,
};
