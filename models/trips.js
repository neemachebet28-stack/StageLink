// ==================================================
// StageLink — trips data access
// ==================================================
// Occupancy is always a live COUNT(...) over the seats table, never a
// stored or assumed number — see the note in database.sql. Departure
// confirmation is a separate column (confirmed_departure) set only by
// an explicit operator action; nothing here ever infers it from
// occupancy.
const { pool } = require('../config/db');

const TRIP_CARD_SELECT = `
  SELECT
    t.id, t.scheduled_departure, t.estimated_departure, t.confirmed_departure,
    t.departure_policy, t.fare_kes, t.status,
    o.id AS organization_id, o.name AS organization_name, o.verification_status,
    (SELECT COUNT(*) FROM reviews rv WHERE rv.organization_id = o.id AND rv.status = 'published') AS review_count,
    (SELECT AVG(rv.rating) FROM reviews rv WHERE rv.organization_id = o.id AND rv.status = 'published') AS review_average,
    s.id AS origin_stage_id, s.name AS origin_stage_name,
    d.id AS destination_id, d.name AS destination_name,
    v.id AS vehicle_id, v.registration_number, v.vehicle_type,
    dr.id AS driver_id, dr.full_name AS driver_name,
    COALESCE(seat_counts.total_seats, 0) AS total_seats,
    COALESCE(seat_counts.available_seats, 0) AS available_seats
  FROM trips t
  JOIN organizations o ON o.id = t.organization_id
  JOIN stages s ON s.id = t.origin_stage_id
  JOIN destinations d ON d.id = t.destination_id
  JOIN vehicles v ON v.id = t.vehicle_id
  LEFT JOIN drivers dr ON dr.id = t.driver_id
  LEFT JOIN (
    SELECT trip_id,
           COUNT(*) AS total_seats,
           SUM(status = 'available') AS available_seats
    FROM seats
    GROUP BY trip_id
  ) AS seat_counts ON seat_counts.trip_id = t.id
`;

/**
 * Trips passengers can currently consider for a route: not cancelled,
 * not already departed, ordered soonest first. This is the query
 * behind "Stage → Operator → Destination → Available Trips".
 */
async function listAvailableTripsForRoute(routeId) {
  const [rows] = await pool.query(
    `${TRIP_CARD_SELECT}
     WHERE t.route_id = ?
       AND t.status NOT IN ('departed', 'arrived', 'cancelled')
     ORDER BY t.scheduled_departure ASC`,
    [routeId]
  );
  return rows;
}

async function getTripCardById(tripId) {
  const [rows] = await pool.query(`${TRIP_CARD_SELECT} WHERE t.id = ?`, [tripId]);
  return rows[0] || null;
}

/**
 * All trips for an operator's own organization — used by the operator
 * dashboard. Always scoped by organization_id; never returns another
 * tenant's trips.
 */
async function listTripsForOrganization(organizationId) {
  const [rows] = await pool.query(
    `${TRIP_CARD_SELECT}
     WHERE t.organization_id = ?
     ORDER BY t.scheduled_departure ASC`,
    [organizationId]
  );
  return rows;
}

async function getTripForOrganization(tripId, organizationId) {
  const [rows] = await pool.query(
    `${TRIP_CARD_SELECT} WHERE t.id = ? AND t.organization_id = ?`,
    [tripId, organizationId]
  );
  return rows[0] || null;
}

/**
 * Confirms a route belongs to the given organization — used before
 * creating a trip so an operator can never schedule a trip on a route
 * they don't own, even if they craft the request by hand.
 */
async function getOwnedRouteWithOrigin(routeId, organizationId) {
  const [rows] = await pool.query(
    `SELECT r.id, r.origin_stage_id, r.destination_id, r.base_fare_kes
     FROM routes r
     WHERE r.id = ? AND r.organization_id = ? AND r.status = 'active'`,
    [routeId, organizationId]
  );
  return rows[0] || null;
}

async function createTrip({
  organizationId,
  routeId,
  originStageId,
  destinationId,
  vehicleId,
  driverId,
  departurePolicy,
  scheduledDeparture,
  fareKes,
}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO trips
         (organization_id, route_id, origin_stage_id, destination_id, vehicle_id,
          driver_id, departure_policy, scheduled_departure, fare_kes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')`,
      [
        organizationId,
        routeId,
        originStageId,
        destinationId,
        vehicleId,
        driverId || null,
        departurePolicy,
        scheduledDeparture,
        fareKes,
      ]
    );

    const tripId = result.insertId;

    // Generate the trip's seats from the vehicle's seat layout — this
    // is what makes later occupancy queries real data, not a guess.
    await connection.query(
      `INSERT INTO seats (trip_id, seat_number, seat_type, status)
       SELECT ?, sls.seat_number, sls.seat_type, 'available'
       FROM vehicles v
       JOIN seat_layout_seats sls ON sls.seat_layout_id = v.seat_layout_id
       WHERE v.id = ?`,
      [tripId, vehicleId]
    );

    await connection.commit();
    return tripId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Updates a trip's departure/status fields. Scoped to organizationId
 * so an operator can only ever update their own trips. vehicleId and
 * driverId, if provided, must already have been verified (by the
 * caller) as belonging to the same organization.
 */
async function updateTrip(tripId, organizationId, fields) {
  const allowedColumns = {
    vehicleId: 'vehicle_id',
    driverId: 'driver_id',
    departurePolicy: 'departure_policy',
    estimatedDeparture: 'estimated_departure',
    confirmedDeparture: 'confirmed_departure',
    fareKes: 'fare_kes',
    status: 'status',
  };

  const setClauses = [];
  const params = [];

  for (const [key, column] of Object.entries(allowedColumns)) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      setClauses.push(`${column} = ?`);
      params.push(fields[key]);
    }
  }

  if (setClauses.length === 0) return false;

  params.push(tripId, organizationId);

  const [result] = await pool.query(
    `UPDATE trips SET ${setClauses.join(', ')} WHERE id = ? AND organization_id = ?`,
    params
  );

  return result.affectedRows > 0;
}

module.exports = {
  listAvailableTripsForRoute,
  getTripCardById,
  listTripsForOrganization,
  getTripForOrganization,
  getOwnedRouteWithOrigin,
  createTrip,
  updateTrip,
};
