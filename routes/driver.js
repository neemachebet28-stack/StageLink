// ==================================================
// StageLink — driver/boarding staff portal
// ==================================================
// Mounted at /driver. Protected by requireAuth + requireRole('driver')
// PLUS a driver-profile check: a 'driver'-role user with no linked
// drivers row (drivers.user_id) is rejected rather than let through
// with a broken/empty view. Every subsequent query is scoped to that
// specific driverId — not organization_id — so a driver only ever
// sees trips assigned to them, nothing else in their organization,
// and nothing from any other organization.
const express = require('express');
const router = express.Router();

const { asyncRoute } = require('../middleware/errorHandler');
const { requireAuth, requireRole, ROLES } = require('../middleware/auth');
const driverPortal = require('../models/driverPortal');
const bookingsModel = require('../models/bookings');
const ticketsModel = require('../models/tickets');
const notifier = require('../services/notifier');
const notificationsModel = require('../models/notifications');

router.use(requireAuth, requireRole(ROLES.DRIVER));

router.use(
  asyncRoute(async (req, res, next) => {
    const profile = await driverPortal.getDriverProfileForUser(req.currentUser.id);
    if (!profile) {
      return res.status(403).render('errors/403', {
        title: 'Driver profile not found',
      });
    }
    req.driverProfile = profile;
    next();
  })
);

// --------------------------------------------------
// GET /driver — assigned trips (home)
// --------------------------------------------------
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const trips = await driverPortal.listAssignedTrips(req.driverProfile.id);
    res.render('driver/trips-index', { title: 'My trips', trips });
  })
);

// --------------------------------------------------
// GET /driver/notifications
// --------------------------------------------------
router.get(
  '/notifications',
  asyncRoute(async (req, res) => {
    const keys = notificationsModel.recipientKeysForRequest(req);
    const notifications = await notificationsModel.listForKeys(keys);
    res.render('driver/notifications', { title: 'Notifications', notifications, returnTo: '/driver/notifications' });
  })
);

// --------------------------------------------------
// GET /driver/trips/:tripId — trip detail, passengers, seats
// --------------------------------------------------
router.get(
  '/trips/:tripId',
  asyncRoute(async (req, res) => {
    const tripId = Number(req.params.tripId);
    const trip = await driverPortal.getAssignedTrip(tripId, req.driverProfile.id);
    if (!trip) return res.status(404).render('errors/404', { title: 'Trip not found' });

    const [passengers, seats] = await Promise.all([
      driverPortal.listPassengersForAssignedTrip(tripId),
      driverPortal.listSeatsForAssignedTrip(tripId),
    ]);

    res.render('driver/trip-detail', {
      title: `${trip.origin_stage_name} to ${trip.destination_name}`,
      trip,
      passengers,
      seats,
      permittedStatuses: driverPortal.DRIVER_PERMITTED_STATUSES,
      error: null,
    });
  })
);

// --------------------------------------------------
// POST /driver/trips/:tripId/status — permitted status update
// --------------------------------------------------
router.post(
  '/trips/:tripId/status',
  asyncRoute(async (req, res) => {
    const tripId = Number(req.params.tripId);
    const trip = await driverPortal.getAssignedTrip(tripId, req.driverProfile.id);
    if (!trip) return res.status(404).render('errors/404', { title: 'Trip not found' });

    const result = await driverPortal.updateTripStatusByDriver(tripId, req.driverProfile.id, req.body.status);
    if (result.ok && req.body.status === 'arrived') {
      await bookingsModel.completeBookingsForArrivedTrip(tripId);
    }

    if (!result.ok) {
      const [passengers, seats] = await Promise.all([
        driverPortal.listPassengersForAssignedTrip(tripId),
        driverPortal.listSeatsForAssignedTrip(tripId),
      ]);
      return res.status(400).render('driver/trip-detail', {
        title: `${trip.origin_stage_name} to ${trip.destination_name}`,
        trip,
        passengers,
        seats,
        permittedStatuses: driverPortal.DRIVER_PERMITTED_STATUSES,
        error: "That status update isn't permitted for drivers.",
      });
    }

    await notifier.onTripUpdated({
      tripId,
      before: { status: trip.status, estimated_departure: trip.estimated_departure },
      after: { status: req.body.status, estimated_departure: trip.estimated_departure },
      actor: 'driver',
    });

    res.redirect(`/driver/trips/${tripId}`);
  })
);

// --------------------------------------------------
// GET /driver/trips/:tripId/verify — scan screen
// --------------------------------------------------
router.get(
  '/trips/:tripId/verify',
  asyncRoute(async (req, res) => {
    const tripId = Number(req.params.tripId);
    const trip = await driverPortal.getAssignedTrip(tripId, req.driverProfile.id);
    if (!trip) return res.status(404).render('errors/404', { title: 'Trip not found' });

    res.render('driver/verify', {
      title: 'Verify ticket',
      trip,
      ticket: null,
      scanResult: null,
      error: null,
      pageScripts: ['/js/qr-scanner.js'],
    });
  })
);

// --------------------------------------------------
// POST /driver/trips/:tripId/verify — process scan
// --------------------------------------------------
router.post(
  '/trips/:tripId/verify',
  asyncRoute(async (req, res) => {
    const tripId = Number(req.params.tripId);
    const trip = await driverPortal.getAssignedTrip(tripId, req.driverProfile.id);
    if (!trip) return res.status(404).render('errors/404', { title: 'Trip not found' });

    const token = (req.body.token || '').trim();
    if (!token) {
      return res.render('driver/verify', {
        title: 'Verify ticket',
        trip,
        ticket: null,
        scanResult: null,
        error: 'Enter or scan a ticket code.',
        pageScripts: ['/js/qr-scanner.js'],
      });
    }

    const result = await driverPortal.verifyTicketForTrip({
      token,
      tripId,
      driverId: req.driverProfile.id,
      organizationId: req.driverProfile.organization_id,
      userId: req.currentUser.id,
    });

    if (!result.ok) {
      return res.status(404).render('errors/404', { title: 'Trip not found' });
    }

    res.render('driver/verify', {
      title: 'Verify ticket',
      trip,
      ticket: result.ticket,
      scanResult: result.scanResult,
      error: null,
      pageScripts: ['/js/qr-scanner.js'],
    });
  })
);

// --------------------------------------------------
// POST /driver/trips/:tripId/verify/:ticketId/board
// --------------------------------------------------
router.post(
  '/trips/:tripId/verify/:ticketId/board',
  asyncRoute(async (req, res) => {
    const tripId = Number(req.params.tripId);
    const ticketId = Number(req.params.ticketId);
    const trip = await driverPortal.getAssignedTrip(tripId, req.driverProfile.id);
    if (!trip) return res.status(404).render('errors/404', { title: 'Trip not found' });

    const result = await driverPortal.boardTicketForTrip({
      ticketId,
      tripId,
      driverId: req.driverProfile.id,
      organizationId: req.driverProfile.organization_id,
      userId: req.currentUser.id,
    });

    const current = await ticketsModel.getTicketById(ticketId);

    res.render('driver/verify', {
      title: 'Verify ticket',
      trip,
      ticket: current,
      scanResult: result.ok ? 'boarded' : result.reason,
      error: result.ok ? null : 'Could not mark this ticket boarded.',
      pageScripts: ['/js/qr-scanner.js'],
    });
  })
);

module.exports = router;
