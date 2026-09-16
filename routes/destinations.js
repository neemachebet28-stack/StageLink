// ==================================================
// StageLink — destination & route detail routes
// ==================================================
const express = require('express');
const router = express.Router();

const { asyncRoute } = require('../middleware/errorHandler');
const destinationsModel = require('../models/destinations');
const routesModel = require('../models/routes');
const tripsModel = require('../models/trips');

// --------------------------------------------------
// GET /destinations — browse/search destinations
// --------------------------------------------------
router.get(
  '/destinations',
  asyncRoute(async (req, res) => {
    const search = (req.query.q || '').trim();
    const destinations = await destinationsModel.listDestinations({ search: search || undefined });

    res.render('passenger/destinations', {
      title: 'Destinations',
      destinations,
      search,
    });
  })
);

// --------------------------------------------------
// GET /destinations/:destinationId — routes that reach this destination
// --------------------------------------------------
router.get(
  '/destinations/:destinationId',
  asyncRoute(async (req, res) => {
    const destinationId = Number(req.params.destinationId);

    const destination = await destinationsModel.getDestinationById(destinationId);
    if (!destination) {
      return res.status(404).render('errors/404', { title: 'Destination not found' });
    }

    const routes = await destinationsModel.listRoutesToDestination(destinationId);

    res.render('passenger/destination', {
      title: destination.name,
      destination,
      routes,
    });
  })
);

// --------------------------------------------------
// GET /routes/:routeId — single route detail
// --------------------------------------------------
router.get(
  '/routes/:routeId',
  asyncRoute(async (req, res) => {
    const routeId = Number(req.params.routeId);

    const route = await routesModel.getRouteById(routeId);
    if (!route) {
      return res.status(404).render('errors/404', { title: 'Route not found' });
    }

    const trips = await tripsModel.listAvailableTripsForRoute(routeId);

    res.render('passenger/route', {
      title: route.name || `${route.origin_stage_name} to ${route.destination_name}`,
      route,
      trips,
    });
  })
);

module.exports = router;
