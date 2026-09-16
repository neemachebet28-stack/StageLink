// ==================================================
// StageLink — driver/boarding staff portal
// ==================================================
// Every function here is scoped to a specific driverId (the drivers
// row linked to the logged-in user via drivers.user_id) — not just
// organization_id. A driver only ever sees trips assigned to THEM,
// not every trip their organization runs; that's a tighter boundary
// than the operator dashboard's, matching real boarding-staff duties.
const { pool } = require('../config/db');
const ticketsModel = require('./tickets');

const DRIVER_PERMITTED_STATUSES = ['boarding', 'departed', 'arrived'];

/**
 * The drivers row for a logged-in user, or null if this account isn't
 * linked to one — used to reject access cleanly rather than crash.
 */
async function getDriverProfileForUser(userId) {
  const [rows] = await pool.query(
    `SELECT d.*, o.name AS organization_name
     FROM drivers d
     JOIN organizations o ON o.id = d.organization_id
     WHERE d.user_id = ? AND d.status = 'active'`,
    [userId]
  );
  return rows[0] || null;
}

async function listAssignedTrips(driverId) {
  const [rows] = await pool.query(
    `SELECT t.id, t.scheduled_departure, t.estimated_departure, t.status,
            os.name AS origin_stage_name, d.name AS destination_name,
            v.registration_number,
            COALESCE(sc.total_seats, 0) AS total_seats,
            COALESCE(sc.available_seats, 0) AS available_seats
     FROM trips t
     JOIN stages os ON os.id = t.origin_stage_id
     JOIN destinations d ON d.id = t.destination_id
     JOIN vehicles v ON v.id = t.vehicle_id
     LEFT JOIN (
       SELECT trip_id, COUNT(*) AS total_seats, SUM(status = 'available') AS available_seats
       FROM seats GROUP BY trip_id
     ) AS sc ON sc.trip_id = t.id
     WHERE t.driver_id = ?
     ORDER BY t.scheduled_departure ASC`,
    [driverId]
  );
  return rows;
}

async function getAssignedTrip(tripId, driverId) {
  const [rows] = await pool.query(
    `SELECT t.*, os.name AS origin_stage_name, d.name AS destination_name,
            v.registration_number, v.vehicle_type, o.name AS organization_name
     FROM trips t
     JOIN stages os ON os.id = t.origin_stage_id
     JOIN destinations d ON d.id = t.destination_id
     JOIN vehicles v ON v.id = t.vehicle_id
     JOIN organizations o ON o.id = t.organization_id
     WHERE t.id = ? AND t.driver_id = ?`,
    [tripId, driverId]
  );
  return rows[0] || null;
}

async function listSeatsForAssignedTrip(tripId) {
  const [rows] = await pool.query(
    `SELECT s.seat_number, s.seat_type, s.status,
            b.passenger_name, b.passenger_phone, b.booking_reference
     FROM seats s
     LEFT JOIN bookings b ON b.seat_id = s.id AND b.status IN ('confirmed', 'completed')
     WHERE s.trip_id = ?
     ORDER BY s.seat_number ASC`,
    [tripId]
  );
  return rows;
}

async function listPassengersForAssignedTrip(tripId) {
  const [rows] = await pool.query(
    `SELECT b.passenger_name, b.passenger_phone, b.status AS booking_status,
            s.seat_number, tk.status AS ticket_status, tk.ticket_number
     FROM bookings b
     JOIN seats s ON s.id = b.seat_id
     LEFT JOIN tickets tk ON tk.booking_id = b.id
     WHERE b.trip_id = ? AND b.status IN ('confirmed', 'completed')
     ORDER BY s.seat_number ASC`,
    [tripId]
  );
  return rows;
}

/**
 * Restricted status transitions available to a driver — deliberately
 * a subset of the full trip-status enum. Scheduling, confirming, and
 * cancelling a trip stay operator/admin decisions; a driver in the
 * field can only move it forward through boarding → departed →
 * arrived. Enforced here server-side, not just by which options a
 * <select> happens to show.
 */
async function updateTripStatusByDriver(tripId, driverId, status) {
  if (!DRIVER_PERMITTED_STATUSES.includes(status)) {
    return { ok: false, reason: 'status_not_permitted' };
  }

  const [result] = await pool.query(
    `UPDATE trips SET status = ? WHERE id = ? AND driver_id = ?`,
    [status, tripId, driverId]
  );
  return { ok: result.affectedRows > 0 };
}

/**
 * QR verification scoped to a specific assigned trip — a driver can
 * only verify/board tickets for the trip they're currently viewing,
 * not any ticket in their organization. Reuses models/tickets.js for
 * the actual ticket lookup and audit logging.
 */
async function verifyTicketForTrip({ token, tripId, driverId, organizationId, userId }) {
  const trip = await getAssignedTrip(tripId, driverId);
  if (!trip) return { ok: false, reason: 'trip_not_assigned' };

  const ticket = await ticketsModel.getTicketByToken(token);

  let scanResult;
  if (!ticket) {
    scanResult = 'invalid';
  } else if (ticket.trip_id !== tripId) {
    scanResult = 'wrong_trip';
  } else if (ticket.ticket_status === 'boarded') {
    scanResult = 'already_boarded';
  } else if (ticket.ticket_status === 'cancelled' || ticket.trip_status === 'cancelled') {
    scanResult = 'cancelled';
  } else if (['departed', 'arrived'].includes(ticket.trip_status)) {
    scanResult = 'expired';
  } else {
    scanResult = 'valid';
  }

  await ticketsModel.recordVerificationScan({
    ticketId: ticket ? ticket.ticket_id : null,
    scannedToken: token,
    organizationId,
    userId,
    result: scanResult === 'wrong_trip' ? 'wrong_operator' : scanResult,
  });

  const showTicket = ticket && scanResult !== 'wrong_trip' ? ticket : null;
  const displayResult = scanResult === 'wrong_trip' ? 'invalid' : scanResult;

  return { ok: true, ticket: showTicket, scanResult: displayResult };
}

async function boardTicketForTrip({ ticketId, tripId, driverId, organizationId, userId }) {
  const trip = await getAssignedTrip(tripId, driverId);
  if (!trip) return { ok: false, reason: 'trip_not_assigned' };

  const ticket = await ticketsModel.getTicketById(ticketId);
  if (!ticket || ticket.trip_id !== tripId) {
    return { ok: false, reason: 'not_found' };
  }

  return ticketsModel.markBoarded({ ticketId, organizationId, userId });
}

module.exports = {
  DRIVER_PERMITTED_STATUSES,
  getDriverProfileForUser,
  listAssignedTrips,
  getAssignedTrip,
  listSeatsForAssignedTrip,
  listPassengersForAssignedTrip,
  updateTripStatusByDriver,
  verifyTicketForTrip,
  boardTicketForTrip,
};
