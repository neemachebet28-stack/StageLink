// ==================================================
// StageLink — admin platform data access
// ==================================================
// Every query here is deliberately cross-tenant — that's the entire
// point of an admin view — but the only write paths are
// updateOrganizationVerification, setOrganizationStatus and
// setUserStatus, each audit-logged by its caller in routes/admin.js.
// Dashboard numbers are always a live COUNT/SUM over real rows, never
// a stored or invented figure.
const { pool } = require('../config/db');

async function getDashboardMetrics() {
  const [[users]] = await pool.query(`SELECT COUNT(*) AS count FROM users WHERE status = 'active'`);
  const [[operators]] = await pool.query(
    `SELECT COUNT(*) AS count,
            SUM(verification_status = 'verified') AS verified,
            SUM(verification_status = 'pending') AS pending
     FROM organizations WHERE status = 'active'`
  );
  const [[trips]] = await pool.query(
    `SELECT COUNT(*) AS count FROM trips WHERE status NOT IN ('departed', 'arrived', 'cancelled')`
  );
  const [[bookings]] = await pool.query(`SELECT COUNT(*) AS count FROM bookings WHERE status IN ('confirmed', 'completed')`);
  const [[revenue]] = await pool.query(
    `SELECT COALESCE(SUM(amount_kes), 0) AS total FROM payments WHERE status = 'success'`
  );
  const [[groupRequests]] = await pool.query(`SELECT COUNT(*) AS count FROM group_requests WHERE status = 'open'`);
  const [[reviews]] = await pool.query(`SELECT COUNT(*) AS count FROM reviews WHERE status = 'flagged'`);

  return {
    activeUsers: users.count,
    operatorCount: operators.count,
    verifiedOperators: Number(operators.verified || 0),
    pendingOperators: Number(operators.pending || 0),
    activeTrips: trips.count,
    confirmedBookings: bookings.count,
    platformRevenueKes: Number(revenue.total),
    openGroupRequests: groupRequests.count,
    flaggedReviews: reviews.count,
  };
}

// ---- users ---------------------------------------------------------
async function listUsers() {
  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.status, u.last_login_at, u.created_at,
            r.name AS role, o.name AS organization_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN organizations o ON o.id = u.organization_id
     ORDER BY u.created_at DESC`
  );
  return rows;
}

async function getUserById(userId) {
  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.status, u.last_login_at, u.created_at,
            r.name AS role, o.name AS organization_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN organizations o ON o.id = u.organization_id
     WHERE u.id = ?`,
    [userId]
  );
  return rows[0] || null;
}

async function setUserStatus(userId, status) {
  const [result] = await pool.query('UPDATE users SET status = ? WHERE id = ?', [status, userId]);
  return result.affectedRows > 0;
}

// ---- operators -----------------------------------------------------
async function listOperators() {
  const [rows] = await pool.query(
    `SELECT o.*,
            (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id AND u.status = 'active') AS user_count,
            (SELECT COUNT(*) FROM vehicles v WHERE v.organization_id = o.id) AS vehicle_count,
            (SELECT COUNT(*) FROM trips t WHERE t.organization_id = o.id) AS trip_count
     FROM organizations o
     ORDER BY o.created_at DESC`
  );
  return rows;
}

async function getOperatorById(organizationId) {
  const [rows] = await pool.query('SELECT * FROM organizations WHERE id = ?', [organizationId]);
  return rows[0] || null;
}

async function updateOrganizationVerification(organizationId, verificationStatus) {
  const [result] = await pool.query('UPDATE organizations SET verification_status = ? WHERE id = ?', [
    verificationStatus,
    organizationId,
  ]);
  return result.affectedRows > 0;
}

async function setOrganizationStatus(organizationId, status) {
  const [result] = await pool.query('UPDATE organizations SET status = ? WHERE id = ?', [status, organizationId]);
  return result.affectedRows > 0;
}

// ---- transport network (read-only cross-tenant oversight) ----------
async function listCountiesWithCounts() {
  const [rows] = await pool.query(
    `SELECT c.*, COUNT(DISTINCT t.id) AS town_count
     FROM counties c LEFT JOIN towns t ON t.county_id = c.id
     GROUP BY c.id ORDER BY c.name ASC`
  );
  return rows;
}

async function listTownsWithCounts() {
  const [rows] = await pool.query(
    `SELECT t.*, c.name AS county_name, COUNT(s.id) AS stage_count
     FROM towns t JOIN counties c ON c.id = t.county_id
     LEFT JOIN stages s ON s.town_id = t.id
     GROUP BY t.id, c.name ORDER BY c.name ASC, t.name ASC`
  );
  return rows;
}

async function listStagesForAdmin() {
  const [rows] = await pool.query(
    `SELECT s.*, t.name AS town_name, c.name AS county_name,
            (SELECT COUNT(*) FROM operator_stages os WHERE os.stage_id = s.id) AS operator_count
     FROM stages s JOIN towns t ON t.id = s.town_id JOIN counties c ON c.id = t.county_id
     ORDER BY c.name ASC, t.name ASC, s.name ASC`
  );
  return rows;
}

async function listRoutesForAdmin() {
  const [rows] = await pool.query(
    `SELECT r.*, o.name AS organization_name, s.name AS origin_stage_name, d.name AS destination_name
     FROM routes r
     JOIN organizations o ON o.id = r.organization_id
     JOIN stages s ON s.id = r.origin_stage_id
     JOIN destinations d ON d.id = r.destination_id
     ORDER BY r.created_at DESC`
  );
  return rows;
}

// ---- fleet ---------------------------------------------------------
async function listVehiclesForAdmin() {
  const [rows] = await pool.query(
    `SELECT v.*, o.name AS organization_name, vsl.name AS seat_layout_name, vsl.total_seats
     FROM vehicles v
     JOIN organizations o ON o.id = v.organization_id
     JOIN vehicle_seat_layouts vsl ON vsl.id = v.seat_layout_id
     ORDER BY v.created_at DESC`
  );
  return rows;
}

async function listDriversForAdmin() {
  const [rows] = await pool.query(
    `SELECT d.id, d.full_name, d.phone, d.status, o.name AS organization_name, u.email AS login_email
     FROM drivers d
     JOIN organizations o ON o.id = d.organization_id
     LEFT JOIN users u ON u.id = d.user_id
     ORDER BY d.created_at DESC`
  );
  return rows;
}

// ---- trips & bookings ----------------------------------------------
async function listTripsForAdmin() {
  const [rows] = await pool.query(
    `SELECT t.id, t.status, t.scheduled_departure, o.name AS organization_name,
            os.name AS origin_stage_name, d.name AS destination_name, v.registration_number
     FROM trips t
     JOIN organizations o ON o.id = t.organization_id
     JOIN stages os ON os.id = t.origin_stage_id
     JOIN destinations d ON d.id = t.destination_id
     JOIN vehicles v ON v.id = t.vehicle_id
     ORDER BY t.scheduled_departure DESC
     LIMIT 300`
  );
  return rows;
}

async function listBookingsForAdmin() {
  const [rows] = await pool.query(
    `SELECT b.id, b.booking_reference, b.passenger_name, b.status, b.fare_kes, b.created_at,
            o.name AS organization_name, os.name AS origin_stage_name, d.name AS destination_name
     FROM bookings b
     JOIN organizations o ON o.id = b.organization_id
     JOIN stages os ON os.id = b.origin_stage_id
     JOIN destinations d ON d.id = b.destination_id
     ORDER BY b.created_at DESC
     LIMIT 300`
  );
  return rows;
}

// ---- payments: sensitive. Phone numbers are masked, and only what's
// needed for oversight is selected (the receipt number is just a
// reference code; no raw provider metadata is exposed).
function maskPhone(phone) {
  if (!phone || phone.length < 6) return phone;
  return phone.slice(0, 5) + '****' + phone.slice(-2);
}

async function listPaymentsForAdmin() {
  const [rows] = await pool.query(
    `SELECT p.id, p.booking_reference, p.phone_number, p.amount_kes, p.status,
            p.mpesa_receipt_number, p.created_at, o.name AS organization_name
     FROM payments p
     JOIN organizations o ON o.id = p.organization_id
     ORDER BY p.created_at DESC
     LIMIT 300`
  );
  return rows.map((r) => ({ ...r, phone_number: maskPhone(r.phone_number) }));
}

// ---- group requests --------------------------------------------------
async function listGroupRequestsForAdmin() {
  const [rows] = await pool.query(
    `SELECT gr.id, gr.request_reference, gr.origin_text, gr.destination_text, gr.passenger_count, gr.status,
            (SELECT COUNT(*) FROM group_quotations gq WHERE gq.group_request_id = gr.id) AS quotation_count
     FROM group_requests gr
     ORDER BY gr.created_at DESC`
  );
  return rows;
}

module.exports = {
  getDashboardMetrics,
  listUsers,
  getUserById,
  setUserStatus,
  listOperators,
  getOperatorById,
  updateOrganizationVerification,
  setOrganizationStatus,
  listCountiesWithCounts,
  listTownsWithCounts,
  listStagesForAdmin,
  listRoutesForAdmin,
  listVehiclesForAdmin,
  listDriversForAdmin,
  listTripsForAdmin,
  listBookingsForAdmin,
  listPaymentsForAdmin,
  listGroupRequestsForAdmin,
};
