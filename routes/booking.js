// ==================================================
// StageLink — passenger booking flow
// ==================================================
// Trip → Vehicle → Seat Selection → Temporary Hold → Booking Summary.
//
// No passenger login exists yet (see README), so a hold/booking is
// tied to the browser's session ID rather than a user account. The
// seat map page touches req.session on load so the session cookie is
// already set before the first hold request — without that, an
// anonymous session with nothing saved to it doesn't get a stable ID
// across requests.
const express = require('express');
const router = express.Router();

const { asyncRoute } = require('../middleware/errorHandler');
const tripsModel = require('../models/trips');
const seatsModel = require('../models/seats');
const seatHoldsModel = require('../models/seatHolds');
const bookingsModel = require('../models/bookings');
const reviewsModel = require('../models/reviews');

const HOLD_FAILURE_MESSAGES = {
  not_found: 'That seat could not be found on this trip.',
  trip_unavailable: 'This trip is no longer accepting bookings.',
  trip_departed: 'This trip has already departed.',
  seat_disabled: 'That seat is not available for booking.',
  seat_taken: 'That seat was just taken. Please choose another.',
};

// --------------------------------------------------
// GET /trips/:tripId — Trip → Vehicle → Seat Selection
// --------------------------------------------------
router.get(
  '/trips/:tripId',
  asyncRoute(async (req, res) => {
    const tripId = Number(req.params.tripId);

    // Ensure this browser has a stable session id before any hold
    // request comes in.
    req.session.seenSeatMap = true;

    const trip = await tripsModel.getTripCardById(tripId);
    if (!trip) {
      return res.status(404).render('errors/404', { title: 'Trip not found' });
    }

    const seats = await seatsModel.listSeatsForTrip(tripId, req.sessionID);

    const seatsByRow = new Map();
    seats.forEach((seat) => {
      if (!seatsByRow.has(seat.seat_row)) seatsByRow.set(seat.seat_row, []);
      seatsByRow.get(seat.seat_row).push(seat);
    });

    const isBookable =
      !['departed', 'arrived', 'cancelled'].includes(trip.status) &&
      new Date(trip.scheduled_departure) > new Date();

    res.render('passenger/trip', {
      title: `${trip.origin_stage_name} to ${trip.destination_name}`,
      trip,
      seatRows: Array.from(seatsByRow.entries()).map(([rowNumber, rowSeats]) => ({ rowNumber, rowSeats })),
      isBookable,
      pageScripts: ['/js/seat-selection.js'],
    });
  })
);

// --------------------------------------------------
// POST /trips/:tripId/seats/:seatId/hold — JSON API
// --------------------------------------------------
router.post(
  '/trips/:tripId/seats/:seatId/hold',
  asyncRoute(async (req, res) => {
    req.session.seenSeatMap = true;

    const tripId = Number(req.params.tripId);
    const seatId = Number(req.params.seatId);

    const result = await seatHoldsModel.holdSeat({ tripId, seatId, sessionId: req.sessionID });

    if (!result.ok) {
      return res.status(409).json({
        success: false,
        reason: result.reason,
        message: HOLD_FAILURE_MESSAGES[result.reason] || 'That seat could not be held.',
      });
    }

    res.json({
      success: true,
      holdId: result.holdId,
      expiresAt: result.expiresAt,
      ttlMinutes: seatHoldsModel.DEFAULT_TTL_MINUTES,
    });
  })
);

// --------------------------------------------------
// POST /trips/:tripId/seats/:seatId/release — JSON API
// --------------------------------------------------
router.post(
  '/trips/:tripId/seats/:seatId/release',
  asyncRoute(async (req, res) => {
    const seatId = Number(req.params.seatId);
    const result = await seatHoldsModel.releaseHold({ seatId, sessionId: req.sessionID });

    if (!result.ok) {
      return res.status(409).json({ success: false, reason: result.reason });
    }
    res.json({ success: true });
  })
);

// --------------------------------------------------
// GET /trips/:tripId/booking-summary
// --------------------------------------------------
router.get(
  '/trips/:tripId/booking-summary',
  asyncRoute(async (req, res) => {
    const tripId = Number(req.params.tripId);

    const trip = await tripsModel.getTripCardById(tripId);
    if (!trip) {
      return res.status(404).render('errors/404', { title: 'Trip not found' });
    }

    const holds = await seatHoldsModel.listActiveHoldsForSession(tripId, req.sessionID);

    res.render('passenger/booking-summary', {
      title: 'Booking summary',
      trip,
      holds,
      error: null,
      passengerName: '',
      passengerPhone: '',
      pageScripts: ['/js/booking-summary.js'],
    });
  })
);

// --------------------------------------------------
// POST /trips/:tripId/bookings — finalize
// --------------------------------------------------
router.post(
  '/trips/:tripId/bookings',
  asyncRoute(async (req, res) => {
    const tripId = Number(req.params.tripId);
    const passengerName = (req.body.passengerName || '').trim();
    const passengerPhone = (req.body.passengerPhone || '').trim();

    const trip = await tripsModel.getTripCardById(tripId);
    if (!trip) {
      return res.status(404).render('errors/404', { title: 'Trip not found' });
    }

    const renderError = async (message) => {
      const holds = await seatHoldsModel.listActiveHoldsForSession(tripId, req.sessionID);
      res.status(400).render('passenger/booking-summary', {
        title: 'Booking summary',
        trip,
        holds,
        error: message,
        passengerName,
        passengerPhone,
        pageScripts: ['/js/booking-summary.js'],
      });
    };

    if (!passengerName || !passengerPhone) {
      return renderError('Please provide your name and phone number.');
    }

    const result = await bookingsModel.createBookingsFromHolds({
      tripId,
      sessionId: req.sessionID,
      passengerName,
      passengerPhone,
    });

    if (!result.ok) {
      const messages = {
        trip_unavailable: 'This trip is no longer accepting bookings.',
        trip_departed: 'This trip has already departed.',
        no_holds: 'Your seat hold expired or was released. Please select your seat again.',
        hold_expired: 'Your seat hold expired. Please select your seat again.',
        seat_no_longer_held: 'One of your seats is no longer held. Please select your seat again.',
      };
      return renderError(messages[result.reason] || 'Something went wrong creating your booking.');
    }

    res.redirect(`/bookings/${result.reference}`);
  })
);

// --------------------------------------------------
// GET /bookings/:reference — confirmation
// --------------------------------------------------
router.get(
  '/bookings/:reference',
  asyncRoute(async (req, res) => {
    const bookings = await bookingsModel.getBookingsByReference(req.params.reference, req.sessionID);

    if (bookings.length === 0) {
      return res.status(404).render('errors/404', { title: 'Booking not found' });
    }

    const operatorSummary = await reviewsModel.getPublishedSummaryForOrganization(bookings[0].organization_id);

    res.render('passenger/booking-confirmation', {
      title: 'Booking confirmed',
      reference: req.params.reference,
      bookings,
      operatorSummary,
    });
  })
);

module.exports = router;
