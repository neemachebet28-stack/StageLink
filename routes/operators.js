// ==================================================
// StageLink — operator discovery routes
// ==================================================
const express = require('express');
const router = express.Router();

const { asyncRoute } = require('../middleware/errorHandler');
const operatorsModel = require('../models/operators');
const reviewsModel = require('../models/reviews');

// --------------------------------------------------
// GET /operators — browse/search operators
// --------------------------------------------------
router.get(
  '/operators',
  asyncRoute(async (req, res) => {
    const search = (req.query.q || '').trim();
    const operators = await operatorsModel.listOperators({ search: search || undefined });

    res.render('passenger/operators', {
      title: 'Operators',
      operators,
      search,
    });
  })
);

// --------------------------------------------------
// GET /operators/:organizationId — operator profile
// --------------------------------------------------
router.get(
  '/operators/:organizationId',
  asyncRoute(async (req, res) => {
    const organizationId = Number(req.params.organizationId);

    const operator = await operatorsModel.getOperatorById(organizationId);
    if (!operator) {
      return res.status(404).render('errors/404', { title: 'Operator not found' });
    }

    const [stages, routes, reviewSummary, reviews] = await Promise.all([
      operatorsModel.listStagesForOperator(organizationId),
      operatorsModel.listRoutesForOperator(organizationId),
      reviewsModel.getPublishedSummaryForOrganization(organizationId),
      reviewsModel.listPublishedForOrganization(organizationId),
    ]);

    res.render('passenger/operator', {
      title: operator.name,
      operator,
      stages,
      routes,
      reviewSummary,
      reviews,
    });
  })
);

module.exports = router;
