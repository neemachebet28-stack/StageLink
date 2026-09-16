// ==================================================
// StageLink — operator dashboard (trip management)
// ==================================================
// Every route here is mounted at /operator and protected by
// requireAuth + requireRole('operator'). Every query is scoped to
// req.currentUser.organizationId — an operator can only ever see or
// change their own organization's data. This is Phase 3's scope:
// trip creation/management only. Vehicle, driver, and seat-layout
// CRUD stay seeded/demo-only until the full operator dashboard phase.
const express = require('express');
const router = express.Router();

const { asyncRoute } = require('../middleware/errorHandler');
const { requireAuth, requireRole, ROLES } = require('../middleware/auth');
const tripsModel = require('../models/trips');
const bookingsModel = require('../models/bookings');
const vehiclesModel = require('../models/vehicles');
const driversModel = require('../models/drivers');
const routesModel = require('../models/routes');
const ticketsModel = require('../models/tickets');
const analyticsModel = require('../models/analytics');
const notifier = require('../services/notifier');

router.use(requireAuth, requireRole(ROLES.OPERATOR));

const VALID_STATUSES = [
  'scheduled',
  'filling',
  'confirmed',
  'boarding',
  'departed',
  'arrived',
  'cancelled',
];
const VALID_POLICIES = ['fixed', 'flexible_window', 'occupancy_dependent'];

// --------------------------------------------------
// GET /operator — dashboard home
// --------------------------------------------------
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const organizationId = req.currentUser.organizationId;
    const [trips, metrics] = await Promise.all([
      tripsModel.listTripsForOrganization(organizationId),
      analyticsModel.getDashboardMetrics(organizationId),
    ]);
    const upcoming = trips.filter((t) => !['departed', 'arrived', 'cancelled'].includes(t.status));

    res.render('operator/dashboard', {
      title: 'Dashboard',
      trips: upcoming.slice(0, 5),
      metrics,
    });
  })
);

// --------------------------------------------------
// GET /operator/trips — full trip list
// --------------------------------------------------
router.get(
  '/trips',
  asyncRoute(async (req, res) => {
    const trips = await tripsModel.listTripsForOrganization(req.currentUser.organizationId);
    res.render('operator/trips-index', { title: 'Trips', trips });
  })
);

// --------------------------------------------------
// GET /operator/trips/new — create trip form
// --------------------------------------------------
router.get(
  '/trips/new',
  asyncRoute(async (req, res) => {
    const organizationId = req.currentUser.organizationId;

    const [routes, vehicles, drivers] = await Promise.all([
      routesModel.listRoutesForOrganization(organizationId, { activeOnly: true }),
      vehiclesModel.listVehiclesForOrganization(organizationId),
      driversModel.listDriversForOrganization(organizationId),
    ]);

    res.render('operator/trip-form', {
      title: 'New trip',
      mode: 'create',
      trip: null,
      routes,
      vehicles,
      drivers,
      policies: VALID_POLICIES,
      error: null,
    });
  })
);

// --------------------------------------------------
// POST /operator/trips — create trip
// --------------------------------------------------
router.post(
  '/trips',
  asyncRoute(async (req, res) => {
    const organizationId = req.currentUser.organizationId;
    const { routeId, vehicleId, driverId, departurePolicy, scheduledDeparture, fareKes } = req.body;

    const renderError = async (message) => {
      const [routes, vehicles, drivers] = await Promise.all([
        routesModel.listRoutesForOrganization(organizationId, { activeOnly: true }),
        vehiclesModel.listVehiclesForOrganization(organizationId),
        driversModel.listDriversForOrganization(organizationId),
      ]);

      res.status(400).render('operator/trip-form', {
        title: 'New trip',
        mode: 'create',
        trip: req.body,
        routes,
        vehicles,
        drivers,
        policies: VALID_POLICIES,
        error: message,
      });
    };

    if (!routeId || !vehicleId || !departurePolicy || !scheduledDeparture || !fareKes) {
      return renderError('Please fill in every required field.');
    }
    if (!VALID_POLICIES.includes(departurePolicy)) {
      return renderError('Invalid departure policy.');
    }

    // Tenant isolation: the route and vehicle (and driver, if given)
    // must belong to this operator's own organization. This is a
    // real server-side check, not just a filtered dropdown.
    const route = await tripsModel.getOwnedRouteWithOrigin(Number(routeId), organizationId);
    if (!route) {
      return renderError("That route doesn't belong to your organization.");
    }

    const vehicle = await vehiclesModel.getVehicleForOrganization(Number(vehicleId), organizationId);
    if (!vehicle) {
      return renderError("That vehicle doesn't belong to your organization.");
    }

    let ownedDriverId = null;
    if (driverId) {
      const driver = await driversModel.getDriverForOrganization(Number(driverId), organizationId);
      if (!driver) {
        return renderError("That driver doesn't belong to your organization.");
      }
      ownedDriverId = driver.id;
    }

    const tripId = await tripsModel.createTrip({
      organizationId,
      routeId: route.id,
      originStageId: route.origin_stage_id,
      destinationId: route.destination_id,
      vehicleId: vehicle.id,
      driverId: ownedDriverId,
      departurePolicy,
      scheduledDeparture,
      fareKes: Number(fareKes),
    });

    res.redirect(`/operator/trips/${tripId}/edit`);
  })
);

// --------------------------------------------------
// GET /operator/trips/:tripId/edit — edit trip
// --------------------------------------------------
router.get(
  '/trips/:tripId/edit',
  asyncRoute(async (req, res) => {
    const organizationId = req.currentUser.organizationId;
    const tripId = Number(req.params.tripId);

    const trip = await tripsModel.getTripForOrganization(tripId, organizationId);
    if (!trip) {
      return res.status(404).render('errors/404', { title: 'Trip not found' });
    }

    const [vehicles, drivers] = await Promise.all([
      vehiclesModel.listVehiclesForOrganization(organizationId),
      driversModel.listDriversForOrganization(organizationId),
    ]);

    res.render('operator/trip-edit', {
      title: `Edit trip — ${trip.origin_stage_name} to ${trip.destination_name}`,
      trip,
      vehicles,
      drivers,
      statuses: VALID_STATUSES,
      error: null,
    });
  })
);

// --------------------------------------------------
// POST /operator/trips/:tripId — update trip
// --------------------------------------------------
router.post(
  '/trips/:tripId',
  asyncRoute(async (req, res) => {
    const organizationId = req.currentUser.organizationId;
    const tripId = Number(req.params.tripId);

    const existing = await tripsModel.getTripForOrganization(tripId, organizationId);
    if (!existing) {
      return res.status(404).render('errors/404', { title: 'Trip not found' });
    }

    const { status, estimatedDeparture, confirmedDeparture, vehicleId, driverId, fareKes } = req.body;

    const renderError = async (message) => {
      const [vehicles, drivers] = await Promise.all([
        vehiclesModel.listVehiclesForOrganization(organizationId),
        driversModel.listDriversForOrganization(organizationId),
      ]);
      res.status(400).render('operator/trip-edit', {
        title: `Edit trip — ${existing.origin_stage_name} to ${existing.destination_name}`,
        trip: { ...existing, status, estimated_departure: estimatedDeparture, confirmed_departure: confirmedDeparture, fare_kes: fareKes },
        vehicles,
        drivers,
        statuses: VALID_STATUSES,
        error: message,
      });
    };

    if (!VALID_STATUSES.includes(status)) {
      return renderError('Invalid status.');
    }

    // The platform never infers a confirmed departure from occupancy —
    // if the operator is marking the trip confirmed or further along,
    // they must supply the confirmation timestamp themselves.
    const advancedStatuses = ['confirmed', 'boarding', 'departed', 'arrived'];
    if (advancedStatuses.includes(status) && !confirmedDeparture && !existing.confirmed_departure) {
      return renderError('Confirming this status requires a confirmed departure time.');
    }

    const vehicle = await vehiclesModel.getVehicleForOrganization(Number(vehicleId), organizationId);
    if (!vehicle) {
      return renderError("That vehicle doesn't belong to your organization.");
    }

    let ownedDriverId = null;
    if (driverId) {
      const driver = await driversModel.getDriverForOrganization(Number(driverId), organizationId);
      if (!driver) {
        return renderError("That driver doesn't belong to your organization.");
      }
      ownedDriverId = driver.id;
    }

    await tripsModel.updateTrip(tripId, organizationId, {
      status,
      estimatedDeparture: estimatedDeparture || null,
      confirmedDeparture: confirmedDeparture || existing.confirmed_departure || null,
      vehicleId: vehicle.id,
      driverId: ownedDriverId,
      fareKes: Number(fareKes),
    });
    if (status === 'arrived') {
      await bookingsModel.completeBookingsForArrivedTrip(tripId);
    }

    // Real event: tell affected passengers about the change (only the
    // meaningful ones — see services/notifier.js).
    await notifier.onTripUpdated({
      tripId,
      before: { status: existing.status, estimated_departure: existing.estimated_departure },
      after: { status, estimated_departure: estimatedDeparture || null },
      actor: 'operator',
    });

    res.redirect('/operator/trips');
  })
);

// --------------------------------------------------
// GET /operator/verify — scan/verification screen
// --------------------------------------------------
router.get('/verify', (req, res) => {
  res.render('operator/verify', {
    title: 'Verify ticket',
    ticket: null,
    scanResult: null,
    error: null,
    pageScripts: ['/js/qr-scanner.js'],
  });
});

// --------------------------------------------------
// POST /operator/verify — look up a scanned/entered QR token
// --------------------------------------------------
// "Verify ticket" is a read-only lookup + audit log entry — it never
// changes the ticket's status itself. Only POST /verify/:id/board does
// that, and only after re-checking the ticket's status at that exact
// moment (see models/tickets.js markBoarded).
router.post(
  '/verify',
  asyncRoute(async (req, res) => {
    const token = (req.body.token || '').trim();
    const organizationId = req.currentUser.organizationId;

    if (!token) {
      return res.render('operator/verify', {
        title: 'Verify ticket',
        ticket: null,
        scanResult: null,
        error: 'Enter or scan a ticket code.',
        pageScripts: ['/js/qr-scanner.js'],
      });
    }

    const ticket = await ticketsModel.getTicketByToken(token);

    let scanResult;
    if (!ticket) {
      scanResult = 'invalid';
    } else if (ticket.organization_id !== organizationId) {
      scanResult = 'wrong_operator';
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
      userId: req.currentUser.id,
      result: scanResult,
    });

    // A ticket that belongs to another operator is shown to this
    // staff member exactly like an unknown one — never reveal that it
    // belongs to someone else.
    const showTicket = ticket && scanResult !== 'wrong_operator' ? ticket : null;
    const displayResult = scanResult === 'wrong_operator' ? 'invalid' : scanResult;

    res.render('operator/verify', {
      title: 'Verify ticket',
      ticket: showTicket,
      scanResult: displayResult,
      error: null,
      pageScripts: ['/js/qr-scanner.js'],
    });
  })
);

// --------------------------------------------------
// POST /operator/verify/:ticketId/board — mark passenger BOARDED
// --------------------------------------------------
router.post(
  '/verify/:ticketId/board',
  asyncRoute(async (req, res) => {
    const ticketId = Number(req.params.ticketId);
    const organizationId = req.currentUser.organizationId;

    const result = await ticketsModel.markBoarded({ ticketId, organizationId, userId: req.currentUser.id });

    // Re-fetch the ticket's current state so the page reflects reality
    // regardless of whether boarding just succeeded or was rejected
    // (e.g. someone else boarded it a second earlier).
    const current = await ticketsModel.getTicketById(ticketId);

    res.render('operator/verify', {
      title: 'Verify ticket',
      ticket: current,
      scanResult: result.ok ? 'boarded' : result.reason,
      error: result.ok ? null : 'Could not mark this ticket boarded.',
      pageScripts: ['/js/qr-scanner.js'],
    });
  })
);

module.exports = router;
