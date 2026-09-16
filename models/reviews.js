// ==================================================
// StageLink — reviews
// ==================================================
// A review can only ever be created for a booking this session owns
// AND whose status is already 'completed' — never accepted from a
// client-asserted "yes I completed this trip". A booking only reaches
// that state via the arrival step in routes/operator.js / driver.js
// (see models/bookings.js:completeBookingsForArrivedTrip).
//
// Averages and counts are always computed from published rows — the UI
// never shows a rating that isn't backed by real reviews.
const { pool } = require('../config/db');

async function getReviewableBooking(bookingReference, sessionId) {
  const [rows] = await pool.query(
    `SELECT b.*, s.seat_number, os.name AS origin_stage_name, d.name AS destination_name,
            o.name AS organization_name,
            (SELECT id FROM reviews r WHERE r.booking_id = b.id) AS existing_review_id
     FROM bookings b
     JOIN seats s ON s.id = b.seat_id
     JOIN stages os ON os.id = b.origin_stage_id
     JOIN destinations d ON d.id = b.destination_id
     JOIN organizations o ON o.id = b.organization_id
     WHERE b.booking_reference = ? AND b.session_id = ? AND b.status = 'completed'
     LIMIT 1`,
    [bookingReference, sessionId]
  );
  return rows[0] || null;
}

/**
 * Inserts the review for one booking. The UNIQUE key on booking_id
 * makes a double-submit (or two browser tabs) a harmless no-op rather
 * than a second review: returns false if one already existed.
 */
async function createReview({ bookingId, tripId, organizationId, sessionId, rating, comment }) {
  const [result] = await pool.query(
    `INSERT IGNORE INTO reviews (booking_id, trip_id, organization_id, session_id, rating, comment, status)
     VALUES (?, ?, ?, ?, ?, ?, 'published')`,
    [bookingId, tripId, organizationId, sessionId, rating, comment || null]
  );
  return result.affectedRows > 0;
}

/**
 * Published reviews for an operator's public profile — passenger
 * phone is never included, only the name they gave at booking time.
 */
async function listPublishedForOrganization(organizationId, { limit = 20 } = {}) {
  const [rows] = await pool.query(
    `SELECT r.id, r.rating, r.comment, r.created_at, b.passenger_name
     FROM reviews r
     JOIN bookings b ON b.id = r.booking_id
     WHERE r.organization_id = ? AND r.status = 'published'
     ORDER BY r.created_at DESC
     LIMIT ?`,
    [organizationId, limit]
  );
  return rows;
}

async function getPublishedSummaryForOrganization(organizationId) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS count, AVG(rating) AS average
     FROM reviews WHERE organization_id = ? AND status = 'published'`,
    [organizationId]
  );
  return { count: row.count, average: row.average ? Number(row.average) : null };
}

/**
 * A visitor flagging a review for moderator attention. Only a
 * currently-published review can be flagged this way — already
 * hidden/flagged ones are left alone (idempotent no-op), and a report
 * never takes a review down by itself; an admin decides that.
 */
async function reportReview(reviewId) {
  const [result] = await pool.query(
    `UPDATE reviews SET status = 'flagged' WHERE id = ? AND status = 'published'`,
    [reviewId]
  );
  return result.affectedRows > 0;
}

// ---- admin moderation ----------------------------------------------

async function listForAdmin({ status } = {}) {
  const params = [];
  let where = '';
  if (status) {
    where = 'WHERE r.status = ?';
    params.push(status);
  }
  const [rows] = await pool.query(
    `SELECT r.*, o.name AS organization_name, b.passenger_name,
            os.name AS origin_stage_name, d.name AS destination_name
     FROM reviews r
     JOIN organizations o ON o.id = r.organization_id
     JOIN bookings b ON b.id = r.booking_id
     JOIN stages os ON os.id = b.origin_stage_id
     JOIN destinations d ON d.id = b.destination_id
     ${where}
     ORDER BY r.created_at DESC`,
    params
  );
  return rows;
}

async function getById(reviewId) {
  const [rows] = await pool.query('SELECT * FROM reviews WHERE id = ?', [reviewId]);
  return rows[0] || null;
}

async function setStatus(reviewId, status) {
  const [result] = await pool.query('UPDATE reviews SET status = ? WHERE id = ?', [status, reviewId]);
  return result.affectedRows > 0;
}

module.exports = {
  getReviewableBooking,
  createReview,
  listPublishedForOrganization,
  getPublishedSummaryForOrganization,
  reportReview,
  listForAdmin,
  getById,
  setStatus,
};
