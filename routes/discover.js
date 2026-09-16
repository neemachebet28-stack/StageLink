// ==================================================
// StageLink — passenger discovery routes
// ==================================================
// Kenya → County → Town → Stage, plus manual search. Nothing here
// reads from a hard-coded array — every list comes from MySQL via
// the models/ layer.
const express = require('express');
const router = express.Router();

const { asyncRoute } = require('../middleware/errorHandler');
const countiesModel = require('../models/counties');
const townsModel = require('../models/towns');
const stagesModel = require('../models/stages');
const operatorsModel = require('../models/operators');

// --------------------------------------------------
// GET /discover — hub: county grid + manual search + nearby (via JS)
// --------------------------------------------------
router.get(
  '/discover',
  asyncRoute(async (req, res) => {
    const search = (req.query.q || '').trim();

    const counties = await countiesModel.listCounties();
    const searchResults = search ? await stagesModel.searchStages(search) : [];

    res.render('passenger/discover', {
      title: 'Discover stages',
      counties,
      search,
      searchResults,
      pageScripts: ['/js/discover.js'],
    });
  })
);

// --------------------------------------------------
// GET /discover/counties/:countyId — towns within a county
// --------------------------------------------------
router.get(
  '/discover/counties/:countyId',
  asyncRoute(async (req, res) => {
    const countyId = Number(req.params.countyId);
    const search = (req.query.q || '').trim();

    const county = await countiesModel.getCountyById(countyId);
    if (!county) {
      return res.status(404).render('errors/404', { title: 'County not found' });
    }

    const towns = await townsModel.listTownsByCounty(countyId, { search: search || undefined });

    res.render('passenger/county', {
      title: county.name,
      county,
      towns,
      search,
    });
  })
);

// --------------------------------------------------
// GET /discover/towns/:townId — stages within a town
// --------------------------------------------------
router.get(
  '/discover/towns/:townId',
  asyncRoute(async (req, res) => {
    const townId = Number(req.params.townId);

    const town = await townsModel.getTownById(townId);
    if (!town) {
      return res.status(404).render('errors/404', { title: 'Town not found' });
    }

    const stages = await stagesModel.listStagesByTown(townId);

    res.render('passenger/town', {
      title: town.name,
      town,
      stages,
    });
  })
);

// --------------------------------------------------
// GET /stages/:stageId — stage detail: operators, destinations, map
// --------------------------------------------------
router.get(
  '/stages/:stageId',
  asyncRoute(async (req, res) => {
    const stageId = Number(req.params.stageId);

    const stage = await stagesModel.getStageById(stageId);
    if (!stage) {
      return res.status(404).render('errors/404', { title: 'Stage not found' });
    }

    const [operators, routesFromStage] = await Promise.all([
      stagesModel.listOperatorsForStage(stageId),
      stagesModel.listRoutesFromStage(stageId),
    ]);

    res.render('passenger/stage', {
      title: stage.name,
      stage,
      operators,
      routesFromStage,
      pageScripts: ['/js/map.js', '/js/stage-detail.js'],
    });
  })
);

// --------------------------------------------------
// GET /stages/:stageId/operators/:organizationId
// The guided path: Stage → Operator → Destination.
// --------------------------------------------------
router.get(
  '/stages/:stageId/operators/:organizationId',
  asyncRoute(async (req, res) => {
    const stageId = Number(req.params.stageId);
    const organizationId = Number(req.params.organizationId);

    const [stage, operator] = await Promise.all([
      stagesModel.getStageById(stageId),
      operatorsModel.getOperatorById(organizationId),
    ]);

    if (!stage || !operator) {
      return res.status(404).render('errors/404', { title: 'Not found' });
    }

    const destinations = await stagesModel.listRoutesFromStageForOperator(stageId, organizationId);

    res.render('passenger/stage-operator', {
      title: `${operator.name} at ${stage.name}`,
      stage,
      operator,
      destinations,
    });
  })
);

module.exports = router;
