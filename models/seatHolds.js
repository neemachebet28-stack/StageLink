// ==================================================
// StageLink — seat holds (transactional locking)
// ==================================================
// Every function that touches a seat's availability locks the seat
// row with SELECT ... FOR UPDATE inside a transaction before reading
// or changing its status. This is what makes double-booking and
// booking-an-unavailable-seat impossible under concurrency, not just
// unlikely — two simultaneous requests for the same seat serialize on
// this lock, and the loser sees a real, current 'seat_taken' result
// instead of racing against stale data.
//
// A hold is also self-healing: if a seat's status says 'held' but the
// hold behind it has actually passed its expiry, holdSeat() treats it
// as available right there rather than waiting for the periodic sweep
// (expireStaleHoldsGlobal, called from server.js on an interval) to
// catch up. The sweep exists so seats free up even when nobody is
// actively requesting them; the in-transaction check exists so
// correctness never depends on the sweep's timing.
const { pool } = require('../config/db');
const notifier = require('../services/notifier');

const DEFAULT_TTL_MINUTES = 5;

async function holdSeat({ tripId, seatId, sessionId, ttlMinutes = DEFAULT_TTL_MINUTES }) {
  const connection = await pool.getConnection();
  let healedHold = null;
  try {
    await connection.beginTransaction();

    const [seatRows] = await connection.query(
      'SELECT * FROM seats WHERE id = ? AND trip_id = ? FOR UPDATE',
      [seatId, tripId]
    );
    const seat = seatRows[0];
    if (!seat) {
      await connection.rollback();
      return { ok: false, reason: 'not_found' };
    }

    const [tripRows] = await connection.query(
      'SELECT status, scheduled_departure FROM trips WHERE id = ? FOR UPDATE',
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

    if (seat.status === 'disabled') {
      await connection.rollback();
      return { ok: false, reason: 'seat_disabled' };
    }
    if (seat.status === 'booked' || seat.status === 'reserved') {
      await connection.rollback();
      return { ok: false, reason: 'seat_taken' };
    }

    if (seat.status === 'held') {
      const [holdRows] = await connection.query(
        `SELECT * FROM seat_holds WHERE seat_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [seatId]
      );
      const existingHold = holdRows[0];
      const stillActive = existingHold && new Date(existingHold.expires_at) > new Date();

      if (stillActive && existingHold.session_id === sessionId) {
        // Same session re-selecting their own held seat — refresh the timer.
        const expiresAt = new Date(Date.now() + ttlMinutes * 60000);
        await connection.query('UPDATE seat_holds SET expires_at = ? WHERE id = ?', [expiresAt, existingHold.id]);
        await connection.commit();
        return { ok: true, holdId: existingHold.id, expiresAt };
      }

      if (stillActive) {
        await connection.rollback();
        return { ok: false, reason: 'seat_taken' };
      }

      // The hold on record has actually expired — self-heal before proceeding.
      await connection.query(`UPDATE seat_holds SET status = 'expired' WHERE id = ?`, [existingHold.id]);
      healedHold = existingHold;
    }

    const expiresAt = new Date(Date.now() + ttlMinutes * 60000);
    const [result] = await connection.query(
      `INSERT INTO seat_holds (trip_id, seat_id, session_id, expires_at, status) VALUES (?, ?, ?, ?, 'active')`,
      [tripId, seatId, sessionId, expiresAt]
    );
    await connection.query(`UPDATE seats SET status = 'held' WHERE id = ?`, [seatId]);

    await connection.commit();

    // Someone else's expired hold was released right here rather than by
    // the sweep — tell them, unless it was this same session re-holding.
    if (healedHold && healedHold.session_id !== sessionId) {
      await notifier.onHoldsExpired([healedHold]);
    }
    return { ok: true, holdId: result.insertId, expiresAt };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function releaseHold({ seatId, sessionId }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [holdRows] = await connection.query(
      `SELECT * FROM seat_holds WHERE seat_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [seatId]
    );
    const hold = holdRows[0];
    if (!hold || hold.session_id !== sessionId) {
      await connection.rollback();
      return { ok: false, reason: 'not_your_hold' };
    }

    await connection.query(`UPDATE seat_holds SET status = 'released' WHERE id = ?`, [hold.id]);
    await connection.query(`UPDATE seats SET status = 'available' WHERE id = ?`, [seatId]);

    await connection.commit();
    return { ok: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Sweeps every trip for holds past their expiry and frees the
 * matching seats. Called on an interval from server.js so seats free
 * up even when nobody is actively browsing that trip — see the module
 * note above for why correctness doesn't depend on this timing.
 */
async function expireStaleHoldsGlobal() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [stale] = await connection.query(
      `SELECT id, seat_id, trip_id, session_id FROM seat_holds WHERE status = 'active' AND expires_at <= NOW() FOR UPDATE`
    );

    if (stale.length > 0) {
      const holdIds = stale.map((h) => h.id);
      const seatIds = stale.map((h) => h.seat_id);
      await connection.query(`UPDATE seat_holds SET status = 'expired' WHERE id IN (?)`, [holdIds]);
      await connection.query(`UPDATE seats SET status = 'available' WHERE id IN (?) AND status = 'held'`, [seatIds]);
    }

    await connection.commit();

    if (stale.length > 0) {
      await notifier.onHoldsExpired(stale);
    }
    return stale.length;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function listActiveHoldsForSession(tripId, sessionId) {
  const [rows] = await pool.query(
    `SELECT sh.id AS hold_id, sh.expires_at, s.id AS seat_id, s.seat_number, s.seat_type
     FROM seat_holds sh
     JOIN seats s ON s.id = sh.seat_id
     WHERE sh.trip_id = ? AND sh.session_id = ? AND sh.status = 'active' AND sh.expires_at > NOW()
     ORDER BY s.seat_number ASC`,
    [tripId, sessionId]
  );
  return rows;
}

module.exports = {
  holdSeat,
  releaseHold,
  expireStaleHoldsGlobal,
  listActiveHoldsForSession,
  DEFAULT_TTL_MINUTES,
};
