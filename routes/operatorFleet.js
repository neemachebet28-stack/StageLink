// ==================================================
// StageLink — operator fleet & network management
// ==================================================
// Vehicles, drivers, seat layouts, service-area stages, and routes.
// Every query is scoped to req.currentUser.organizationId — an
// operator can only ever see or change their own organization's
// records, enforced here (not just by a filtered dropdown) on every
// single-record lookup before any update.
const express = require('express');
const router = express.Router();

const { asyncRoute } = require('../middleware/errorHandler');
const { requireAuth, requireRole, ROLES } = require('../middleware/auth');
const vehiclesModel = require('../models/vehicles');
const driversModel = require('../models/drivers');
const seatLayoutsModel = require('../models/seatLayouts');
const operatorStagesModel = require('../models/operatorStages');
const routesModel = require('../models/routes');
const destinationsModel = require('../models/destinations');

router.use(requireAuth, requireRole(ROLES.OPERATOR));

// ==================================================
// Vehicles
// ==================================================
router.get(
  '/vehicles',
  asyncRoute(async (req, res) => {
    const vehicles = await vehiclesModel.listVehiclesForOrganization(req.currentUser.organizationId);
    res.render('operator/vehicles-index', { title: 'Vehicles', vehicles });
  })
);

router.get(
  '/vehicles/new',
  asyncRoute(async (req, res) => {
    const layouts = await seatLayoutsModel.listLayoutsForOrganization(req.currentUser.organizationId);
    res.render('operator/vehicle-form', { title: 'New vehicle', mode: 'create', vehicle: null, layouts, error: null });
  })
);

router.post(
  '/vehicles',
  asyncRoute(async (req, res) => {
    const organizationId = req.currentUser.organizationId;
    const { registrationNumber, seatLayoutId, vehicleType, makeModel } = req.body;

    if (!registrationNumber || !seatLayoutId) {
      const layouts = await seatLayoutsModel.listLayoutsForOrganization(organizationId);
      return res.status(400).render('operator/vehicle-form', {
        title: 'New vehicle',
        mode: 'create',
        vehicle: req.body,
        layouts,
        error: 'Registration number and seat layout are required.',
      });
    }

    const layout = await seatLayoutsModel.getLayoutForOrganization(Number(seatLayoutId), organizationId);
    if (!layout) {
      const layouts = await seatLayoutsModel.listLayoutsForOrganization(organizationId);
      return res.status(400).render('operator/vehicle-form', {
        title: 'New vehicle',
        mode: 'create',
        vehicle: req.body,
        layouts,
        error: "That seat layout doesn't belong to your organization.",
      });
    }

    try {
      await vehiclesModel.createVehicle({
        organizationId,
        seatLayoutId: layout.id,
        registrationNumber,
        vehicleType,
        makeModel,
      });
      res.redirect('/operator/vehicles');
    } catch (error) {
      const layouts = await seatLayoutsModel.listLayoutsForOrganization(organizationId);
      const message =
        error.code === 'ER_DUP_ENTRY'
          ? 'A vehicle with that registration number already exists on the platform.'
          : 'Could not create that vehicle.';
      res.status(400).render('operator/vehicle-form', {
        title: 'New vehicle',
        mode: 'create',
        vehicle: req.body,
        layouts,
        error: message,
      });
    }
  })
);

router.get(
  '/vehicles/:vehicleId/edit',
  asyncRoute(async (req, res) => {
    const organizationId = req.currentUser.organizationId;
    const vehicle = await vehiclesModel.getVehicleForOrganization(Number(req.params.vehicleId), organizationId);
    if (!vehicle) return res.status(404).render('errors/404', { title: 'Vehicle not found' });

    const layouts = await seatLayoutsModel.listLayoutsForOrganization(organizationId);
    res.render('operator/vehicle-form', { title: 'Edit vehicle', mode: 'edit', vehicle, layouts, error: null });
  })
);

router.post(
  '/vehicles/:vehicleId',
  asyncRoute(async (req, res) => {
    const organizationId = req.currentUser.organizationId;
    const vehicleId = Number(req.params.vehicleId);
    const { seatLayoutId, vehicleType, makeModel, status } = req.body;

    const existing = await vehiclesModel.getVehicleForOrganization(vehicleId, organizationId);
    if (!existing) return res.status(404).render('errors/404', { title: 'Vehicle not found' });

    const layout = await seatLayoutsModel.getLayoutForOrganization(Number(seatLayoutId), organizationId);
    if (!layout) {
      const layouts = await seatLayoutsModel.listLayoutsForOrganization(organizationId);
      return res.status(400).render('operator/vehicle-form', {
        title: 'Edit vehicle',
        mode: 'edit',
        vehicle: { ...existing, ...req.body },
        layouts,
        error: "That seat layout doesn't belong to your organization.",
      });
    }

    await vehiclesModel.updateVehicle(vehicleId, organizationId, {
      seatLayoutId: layout.id,
      vehicleType,
      makeModel,
      status,
    });
    res.redirect('/operator/vehicles');
  })
);

// ==================================================
// Drivers
// ==================================================
router.get(
  '/drivers',
  asyncRoute(async (req, res) => {
    const drivers = await driversModel.listDriversForOrganization(req.currentUser.organizationId);
    res.render('operator/drivers-index', { title: 'Drivers', drivers });
  })
);

router.get('/drivers/new', (req, res) => {
  res.render('operator/driver-form', { title: 'New driver', mode: 'create', driver: null, error: null });
});

router.post(
  '/drivers',
  asyncRoute(async (req, res) => {
    const { fullName, phone, licenseNumber } = req.body;
    if (!fullName) {
      return res.status(400).render('operator/driver-form', {
        title: 'New driver',
        mode: 'create',
        driver: req.body,
        error: 'Full name is required.',
      });
    }
    await driversModel.createDriver({ organizationId: req.currentUser.organizationId, fullName, phone, licenseNumber });
    res.redirect('/operator/drivers');
  })
);

router.get(
  '/drivers/:driverId/edit',
  asyncRoute(async (req, res) => {
    const driver = await driversModel.getDriverForOrganization(
      Number(req.params.driverId),
      req.currentUser.organizationId
    );
    if (!driver) return res.status(404).render('errors/404', { title: 'Driver not found' });
    res.render('operator/driver-form', { title: 'Edit driver', mode: 'edit', driver, error: null });
  })
);

router.post(
  '/drivers/:driverId',
  asyncRoute(async (req, res) => {
    const organizationId = req.currentUser.organizationId;
    const driverId = Number(req.params.driverId);
    const existing = await driversModel.getDriverForOrganization(driverId, organizationId);
    if (!existing) return res.status(404).render('errors/404', { title: 'Driver not found' });

    const { fullName, phone, licenseNumber, status } = req.body;
    await driversModel.updateDriver(driverId, organizationId, { fullName, phone, licenseNumber, status });
    res.redirect('/operator/drivers');
  })
);

// ==================================================
// Seat layouts
// ==================================================
router.get(
  '/seat-layouts',
  asyncRoute(async (req, res) => {
    const layouts = await seatLayoutsModel.listLayoutsForOrganization(req.currentUser.organizationId);
    res.render('operator/seat-layouts-index', { title: 'Seat layouts', layouts });
  })
);

router.get('/seat-layouts/new', (req, res) => {
  res.render('operator/seat-layout-form', { title: 'New seat layout', error: null, formValues: {} });
});

router.post(
  '/seat-layouts',
  asyncRoute(async (req, res) => {
    const { name, totalSeats } = req.body;
    const seats = Number(totalSeats);

    if (!name || !Number.isInteger(seats) || seats < 1 || seats > 60) {
      return res.status(400).render('operator/seat-layout-form', {
        title: 'New seat layout',
        error: 'Enter a name and a seat count between 1 and 60.',
        formValues: req.body,
      });
    }

    try {
      await seatLayoutsModel.createLayoutWithSeats(req.currentUser.organizationId, name, seats);
      res.redirect('/operator/seat-layouts');
    } catch (error) {
      const message = error.code === 'ER_DUP_ENTRY' ? 'You already have a layout with that name.' : 'Could not create that layout.';
      res.status(400).render('operator/seat-layout-form', {
        title: 'New seat layout',
        error: message,
        formValues: req.body,
      });
    }
  })
);

// ==================================================
// Stages (service area)
// ==================================================
router.get(
  '/stages',
  asyncRoute(async (req, res) => {
    const stages = await operatorStagesModel.listStagesForOrganization(req.currentUser.organizationId);
    res.render('operator/stages-index', { title: 'Stages', stages });
  })
);

router.get(
  '/stages/new',
  asyncRoute(async (req, res) => {
    const available = await operatorStagesModel.listAvailableStagesToAdd(req.currentUser.organizationId);
    res.render('operator/stage-form', { title: 'Add a stage', available, error: null });
  })
);

router.post(
  '/stages',
  asyncRoute(async (req, res) => {
    const stageId = Number(req.body.stageId);
    if (!stageId) {
      const available = await operatorStagesModel.listAvailableStagesToAdd(req.currentUser.organizationId);
      return res.status(400).render('operator/stage-form', {
        title: 'Add a stage',
        available,
        error: 'Select a stage to add.',
      });
    }
    await operatorStagesModel.addStageToOrganization(req.currentUser.organizationId, stageId);
    res.redirect('/operator/stages');
  })
);

router.post(
  '/stages/:linkId/remove',
  asyncRoute(async (req, res) => {
    await operatorStagesModel.removeStageFromOrganization(req.currentUser.organizationId, Number(req.params.linkId));
    res.redirect('/operator/stages');
  })
);

// ==================================================
// Routes
// ==================================================
router.get(
  '/routes',
  asyncRoute(async (req, res) => {
    const routes = await routesModel.listRoutesForOrganization(req.currentUser.organizationId);
    res.render('operator/routes-index', { title: 'Routes', routes });
  })
);

router.get(
  '/routes/new',
  asyncRoute(async (req, res) => {
    const stages = await operatorStagesModel.listStagesForOrganization(req.currentUser.organizationId);
    const destinations = await destinationsModel.listDestinations({});
    res.render('operator/route-form', { title: 'New route', mode: 'create', route: null, stages, destinations, error: null });
  })
);

router.post(
  '/routes',
  asyncRoute(async (req, res) => {
    const organizationId = req.currentUser.organizationId;
    const { originStageId, destinationId, name, distanceKm, durationMinutes, baseFareKes } = req.body;

    const renderError = async (message) => {
      const stages = await operatorStagesModel.listStagesForOrganization(organizationId);
      const destinations = await destinationsModel.listDestinations({});
      res.status(400).render('operator/route-form', {
        title: 'New route',
        mode: 'create',
        route: req.body,
        stages,
        destinations,
        error: message,
      });
    };

    if (!originStageId || !destinationId) {
      return renderError('Origin stage and destination are required.');
    }

    // Origin must be a stage this operator actually serves — not any
    // stage in the platform-wide directory.
    const servedStages = await operatorStagesModel.listStagesForOrganization(organizationId);
    const ownsOrigin = servedStages.some((s) => s.stage_id === Number(originStageId));
    if (!ownsOrigin) {
      return renderError('Pick an origin stage from your own service area.');
    }

    await routesModel.createRoute({
      organizationId,
      originStageId: Number(originStageId),
      destinationId: Number(destinationId),
      name,
      distanceKm: distanceKm || null,
      durationMinutes: durationMinutes || null,
      baseFareKes: baseFareKes || null,
    });
    res.redirect('/operator/routes');
  })
);

router.get(
  '/routes/:routeId/edit',
  asyncRoute(async (req, res) => {
    const organizationId = req.currentUser.organizationId;
    const route = await routesModel.getRouteForOrganization(Number(req.params.routeId), organizationId);
    if (!route) return res.status(404).render('errors/404', { title: 'Route not found' });
    res.render('operator/route-edit', { title: 'Edit route', route, error: null });
  })
);

router.post(
  '/routes/:routeId',
  asyncRoute(async (req, res) => {
    const organizationId = req.currentUser.organizationId;
    const routeId = Number(req.params.routeId);
    const existing = await routesModel.getRouteForOrganization(routeId, organizationId);
    if (!existing) return res.status(404).render('errors/404', { title: 'Route not found' });

    const { name, distanceKm, durationMinutes, baseFareKes, status } = req.body;
    await routesModel.updateRoute(routeId, organizationId, {
      name,
      distanceKm: distanceKm || null,
      durationMinutes: durationMinutes || null,
      baseFareKes: baseFareKes || null,
      status,
    });
    res.redirect('/operator/routes');
  })
);

module.exports = router;
