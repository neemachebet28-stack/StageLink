// ==================================================
// StageLink — seats data access (per-trip seat map)
// ==================================================
const { pool } = require('../config/db');

/**
 * Every seat for a trip, grouped implicitly by seat_row (the caller
 * groups for display), plus whether the given session currently holds
 * it — so the seat map can show "your held seat" distinctly from
 * "held by someone else" without exposing whose session that is.
 */
async function listSeatsForTrip(tripId, sessionId) {
  const [rows] = await pool.query(
    `SELECT s.id, s.seat_number, s.seat_type, s.status,
            sls.seat_row,
            (sh.session_id = ? AND sh.status = 'active' AND sh.expires_at > NOW()) AS held_by_you,
            sh.expires_at AS your_hold_expires_at
     FROM seats s
     JOIN trips t ON t.id = s.trip_id
     JOIN vehicles v ON v.id = t.vehicle_id
     JOIN seat_layout_seats sls ON sls.seat_layout_id = v.seat_layout_id AND sls.seat_number = s.seat_number
     LEFT JOIN seat_holds sh ON sh.seat_id = s.id AND sh.status = 'active' AND sh.expires_at > NOW()
     WHERE s.trip_id = ?
     ORDER BY sls.seat_row ASC, s.seat_number ASC`,
    [sessionId, tripId]
  );
  return rows;
}

async function getSeatForTrip(seatId, tripId) {
  const [rows] = await pool.query('SELECT * FROM seats WHERE id = ? AND trip_id = ?', [seatId, tripId]);
  return rows[0] || null;
}

module.exports = { listSeatsForTrip, getSeatForTrip };
