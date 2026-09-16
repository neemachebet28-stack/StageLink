// ==================================================
// StageLink — operator group/event transport routes
// ==================================================
// Unlike every other operator route, listing open requests is
// deliberately NOT organization-scoped — any operator may browse and
// quote on any open request (see the note in database.sql). Tenancy
// re-enters at the quotation: an operator can only submit, modify, or
// withdraw their OWN organization's quotation, enforced by
// organization_id on every write.
const express = require('express');
const router = express.Router();

const { asyncRoute } = require('../middleware/errorHandler');
const { requireAuth, requireRole, ROLES } = require('../middleware/auth');
const groupRequestsModel = require('../models/groupRequests');
const groupQuotationsModel = require('../models/groupQuotations');
const notifier = require('../services/notifier');

router.use(requireAuth, requireRole(ROLES.OPERATOR));

// --------------------------------------------------
// GET /operator/group-trips — open requests + my quotations
// --------------------------------------------------
router.get(
  '/group-trips',
  asyncRoute(async (req, res) => {
    const [openRequests, myQuotations] = await Promise.all([
      groupRequestsModel.listOpenRequests(),
      groupQuotationsModel.listQuotationsForOrganization(req.currentUser.organizationId),
    ]);
    res.render('operator/group-trips-index', { title: 'Group Trips', openRequests, myQuotations });
  })
);

// --------------------------------------------------
// GET /operator/group-trips/:requestId — request detail + quote form
// --------------------------------------------------
router.get(
  '/group-trips/:requestId',
  asyncRoute(async (req, res) => {
    const requestId = Number(req.params.requestId);
    const request = await groupRequestsModel.getRequestById(requestId);
    if (!request) return res.status(404).render('errors/404', { title: 'Request not found' });

    const ownQuotation = await groupQuotationsModel.getOwnQuotationForRequest(
      requestId,
      req.currentUser.organizationId
    );

    res.render('operator/group-trip-detail', {
      title: `Request ${request.request_reference}`,
      request,
      ownQuotation,
      error: null,
    });
  })
);

// --------------------------------------------------
// POST /operator/group-trips/:requestId/quotations — submit or modify
// --------------------------------------------------
router.post(
  '/group-trips/:requestId/quotations',
  asyncRoute(async (req, res) => {
    const requestId = Number(req.params.requestId);
    const organizationId = req.currentUser.organizationId;
    const { priceKes, vehicleDetails, notes } = req.body;

    const request = await groupRequestsModel.getRequestById(requestId);
    if (!request) return res.status(404).render('errors/404', { title: 'Request not found' });

    const renderError = async (message) => {
      const ownQuotation = await groupQuotationsModel.getOwnQuotationForRequest(requestId, organizationId);
      res.status(400).render('operator/group-trip-detail', {
        title: `Request ${request.request_reference}`,
        request,
        ownQuotation,
        error: message,
      });
    };

    if (request.status !== 'open') {
      return renderError('This request is no longer open for quotations.');
    }
    const price = Number(priceKes);
    if (!Number.isFinite(price) || price <= 0) {
      return renderError('Enter a valid price.');
    }

    const previous = await groupQuotationsModel.getOwnQuotationForRequest(requestId, organizationId);

    await groupQuotationsModel.submitOrUpdateQuotation({
      requestId,
      organizationId,
      priceKes: price,
      vehicleDetails,
      notes,
    });

    // Real event: the requester hears about a new quote or a changed
    // price. Re-saving an identical price is a no-op (same dedupe key).
    const saved = await groupQuotationsModel.getOwnQuotationForRequest(requestId, organizationId);
    await notifier.onGroupQuotationSubmitted({
      request,
      quotation: saved,
      organizationName: req.currentUser.organizationName,
      isUpdate: Boolean(previous),
    });

    res.redirect('/operator/group-trips');
  })
);

// --------------------------------------------------
// POST /operator/group-trips/:requestId/quotations/withdraw
// --------------------------------------------------
router.post(
  '/group-trips/:requestId/quotations/withdraw',
  asyncRoute(async (req, res) => {
    const organizationId = req.currentUser.organizationId;
    const ownQuotation = await groupQuotationsModel.getOwnQuotationForRequest(
      Number(req.params.requestId),
      organizationId
    );
    if (ownQuotation) {
      const withdrawn = await groupQuotationsModel.withdrawQuotation(ownQuotation.id, organizationId);
      const request = await groupRequestsModel.getRequestById(Number(req.params.requestId));
      if (withdrawn && request) {
        await notifier.onGroupQuotationWithdrawn({
          request,
          quotation: ownQuotation,
          organizationName: req.currentUser.organizationName,
        });
      }
    }
    res.redirect('/operator/group-trips');
  })
);

module.exports = router;
