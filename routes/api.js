// ==================================================
// StageLink — JSON API (discovery)
// ==================================================
// Small, focused endpoints consumed by client-side JS (public/js/discover.js).
// These are not a general-purpose API yet — just what the passenger
// discovery UI needs to stay backed by real MySQL data.
const express = require('express');
const router = express.Router();

const { asyncRoute } = require('../middleware/errorHandler');
const stagesModel = require('../models/stages');

// --------------------------------------------------
// GET /api/stages/nearby?lat=&lng=&radius_km=
// --------------------------------------------------
router.get(
  '/api/stages/nearby',
  asyncRoute(async (req, res) => {
    const latitude = Number(req.query.lat);
    const longitude = Number(req.query.lng);
    const radiusKm = req.query.radius_km ? Number(req.query.radius_km) : 15;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ error: 'lat and lng query parameters are required numbers.' });
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({ error: 'lat/lng out of range.' });
    }

    const stages = await stagesModel.findNearbyStages(latitude, longitude, {
      radiusKm: Number.isFinite(radiusKm) ? radiusKm : 15,
    });

    res.json({ stages });
  })
);

// --------------------------------------------------
// GET /api/search?q=
// --------------------------------------------------
router.get(
  '/api/search',
  asyncRoute(async (req, res) => {
    const search = (req.query.q || '').trim();

    if (search.length < 2) {
      return res.json({ stages: [] });
    }

    const stages = await stagesModel.searchStages(search, { limit: 8 });
    res.json({ stages });
  })
);

module.exports = router;
