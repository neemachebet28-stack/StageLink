// ==================================================
// StageLink — operator analytics
// ==================================================
// Every number here is a live aggregate over this organization's own
// rows — nothing is stored, cached, or invented. If a metric would
// require a feature that doesn't exist yet (e.g. group trips), it's
// left out entirely rather than shown as a fake zero — see README.
const { pool } = require('../config/db');

async function getDashboardMetrics(organizationId) {
  const [[todaysTrips]] = await pool.query(
    `SELECT COUNT(*) AS count FROM trips WHERE organization_id = ? AND DATE(scheduled_departure) = CURDATE()`,
    [organizationId]
  );
  const [[todaysBookings]] = await pool.query(
    `SELECT COUNT(*) AS count FROM bookings WHERE organization_id = ? AND DATE(created_at) = CURDATE()`,
    [organizationId]
  );
  const [[activeTrips]] = await pool.query(
    `SELECT COUNT(*) AS count FROM trips
     WHERE organization_id = ? AND status NOT IN ('departed', 'arrived', 'cancelled')`,
    [organizationId]
  );
  const [[seatsSold]] = await pool.query(
    `SELECT COUNT(*) AS count FROM bookings WHERE organization_id = ? AND status = 'confirmed'`,
    [organizationId]
  );
  const [[revenue]] = await pool.query(
    `SELECT COALESCE(SUM(amount_kes), 0) AS total
     FROM payments WHERE organization_id = ? AND status = 'success'`,
    [organizationId]
  );
  const [[pendingPayments]] = await pool.query(
    `SELECT COUNT(*) AS count FROM payments WHERE organization_id = ? AND status IN ('pending', 'processing')`,
    [organizationId]
  );

  return {
    todaysTrips: todaysTrips.count,
    todaysBookings: todaysBookings.count,
    activeTrips: activeTrips.count,
    seatsSold: seatsSold.count,
    revenueKes: Number(revenue.total),
    pendingPayments: pendingPayments.count,
  };
}

async function getBookingsByDay(organizationId, days = 14) {
  const [rows] = await pool.query(
    `SELECT DATE(created_at) AS day, COUNT(*) AS bookings, COALESCE(SUM(fare_kes), 0) AS revenue_kes
     FROM bookings
     WHERE organization_id = ? AND status = 'confirmed' AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(created_at)
     ORDER BY day DESC`,
    [organizationId, days]
  );
  return rows;
}

async function getRevenueByRoute(organizationId) {
  const [rows] = await pool.query(
    `SELECT r.name AS route_name, os.name AS origin_stage_name, d.name AS destination_name,
            COUNT(b.id) AS bookings, COALESCE(SUM(b.fare_kes), 0) AS revenue_kes
     FROM bookings b
     JOIN trips t ON t.id = b.trip_id
     JOIN routes r ON r.id = t.route_id
     JOIN stages os ON os.id = b.origin_stage_id
     JOIN destinations d ON d.id = b.destination_id
     WHERE b.organization_id = ? AND b.status = 'confirmed'
     GROUP BY r.id, r.name, os.name, d.name
     ORDER BY revenue_kes DESC`,
    [organizationId]
  );
  return rows;
}

module.exports = { getDashboardMetrics, getBookingsByDay, getRevenueByRoute };
