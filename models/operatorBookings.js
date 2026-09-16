// ==================================================
// StageLink — operator bookings & passengers views
// ==================================================
const { pool } = require('../config/db');

async function listBookingsForOrganization(organizationId, { status } = {}) {
  const params = [organizationId];
  let statusClause = '';
  if (status) {
    statusClause = 'AND b.status = ?';
    params.push(status);
  }

  const [rows] = await pool.query(
    `SELECT b.id, b.booking_reference, b.passenger_name, b.passenger_phone, b.fare_kes, b.status,
            b.created_at, s.seat_number,
            os.name AS origin_stage_name, d.name AS destination_name,
            t.scheduled_departure
     FROM bookings b
     JOIN seats s ON s.id = b.seat_id
     JOIN stages os ON os.id = b.origin_stage_id
     JOIN destinations d ON d.id = b.destination_id
     JOIN trips t ON t.id = b.trip_id
     WHERE b.organization_id = ? ${statusClause}
     ORDER BY b.created_at DESC
     LIMIT 200`,
    params
  );
  return rows;
}

/**
 * Passengers derived from booking history, grouped by phone number —
 * there's no separate passenger-account table yet (see README), so
 * "passengers" here means "everyone who has booked with this
 * organization", computed live from real bookings, never a stored or
 * guessed list.
 */
async function listPassengersForOrganization(organizationId) {
  const [rows] = await pool.query(
    `SELECT b.passenger_phone, b.passenger_name,
            COUNT(*) AS booking_count,
            SUM(b.fare_kes) AS total_spent_kes,
            MAX(b.created_at) AS last_booking_at
     FROM bookings b
     WHERE b.organization_id = ?
     GROUP BY b.passenger_phone, b.passenger_name
     ORDER BY last_booking_at DESC
     LIMIT 200`,
    [organizationId]
  );
  return rows;
}

module.exports = { listBookingsForOrganization, listPassengersForOrganization };
