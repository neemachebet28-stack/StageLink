// ==================================================
// StageLink — passenger review submission and reporting
// ==================================================
const express = require('express');
const router = express.Router();

const { asyncRoute } = require('../middleware/errorHandler');
const reviewsModel = require('../models/reviews');

router.get(
  '/bookings/:reference/review',
  asyncRoute(async (req, res) => {
    const booking = await reviewsModel.getReviewableBooking(req.params.reference, req.sessionID);
    if (!booking) return res.status(404).render('errors/404', { title: 'Booking not found' });
    if (booking.existing_review_id) {
      return res.redirect(`/bookings/${req.params.reference}`);
    }
    res.render('passenger/review-form', { title: 'Leave a review', booking, error: null, reference: req.params.reference });
  })
);

router.post(
  '/bookings/:reference/review',
  asyncRoute(async (req, res) => {
    // Eligibility is re-derived from the database every time: the booking
    // must belong to this session and already be 'completed'.
    const booking = await reviewsModel.getReviewableBooking(req.params.reference, req.sessionID);
    if (!booking) return res.status(404).render('errors/404', { title: 'Booking not found' });
    if (booking.existing_review_id) {
      return res.redirect(`/bookings/${req.params.reference}`);
    }

    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).render('passenger/review-form', {
        title: 'Leave a review',
        booking,
        error: 'Choose a rating from 1 to 5.',
        reference: req.params.reference,
      });
    }

    await reviewsModel.createReview({
      bookingId: booking.id,
      tripId: booking.trip_id,
      organizationId: booking.organization_id,
      sessionId: req.sessionID,
      rating,
      comment: (req.body.comment || '').trim().slice(0, 1000),
    });

    res.redirect(`/bookings/${req.params.reference}`);
  })
);

// Deliberately unauthenticated, like the public reviews it flags, and
// deliberately minimal: it only ever moves a review from 'published'
// to 'flagged' for a moderator to look at. It never hides content by
// itself — an admin makes that call (routes/admin.js).
router.post(
  '/reviews/:reviewId/report',
  asyncRoute(async (req, res) => {
    await reviewsModel.reportReview(Number(req.params.reviewId));
    // Same-site paths only — never redirect to an attacker-supplied URL.
    const returnTo = req.body.returnTo;
    const safe = typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//');
    res.redirect(safe ? returnTo : '/');
  })
);

module.exports = router;
