// ==================================================
// StageLink — passenger group/event transport routes
// ==================================================
// Ownership follows the same session_id pattern as bookings and seat
// holds — no passenger login exists yet (see README).
const express = require('express');
const router = express.Router();

const { asyncRoute } = require('../middleware/errorHandler');
const groupRequestsModel = require('../models/groupRequests');
const groupQuotationsModel = require('../models/groupQuotations');
const groupBookingsModel = require('../models/groupBookings');
const countiesModel = require('../models/counties');
const notifier = require('../services/notifier');

const ACCEPT_FAILURE_MESSAGES = {
  not_found: "We couldn't find that request on this device.",
  request_not_open: 'This request is no longer open — a quotation may already have been accepted.',
  quotation_not_available: 'That quotation is no longer available.',
};

// --------------------------------------------------
// GET /group-trips — request form
// --------------------------------------------------
router.get(
  '/group-trips',
  asyncRoute(async (req, res) => {
    const counties = await countiesModel.listCounties();
    res.render('passenger/group-request-form', { title: 'Group & event transport', counties, error: null, formValues: {} });
  })
);

// --------------------------------------------------
// POST /group-trips — create request
// --------------------------------------------------
router.post(
  '/group-trips',
  asyncRoute(async (req, res) => {
    const body = req.body;
    const passengerCount = Number(body.passengerCount);

    const renderError = async (message) => {
      const counties = await countiesModel.listCounties();
      res.status(400).render('passenger/group-request-form', {
        title: 'Group & event transport',
        counties,
        error: message,
        formValues: body,
      });
    };

    if (!body.passengerName || !body.passengerPhone) {
      return renderError('Please provide your name and phone number.');
    }
    if (!Number.isInteger(passengerCount) || passengerCount < 1) {
      return renderError('Enter a valid number of passengers.');
    }
    if (!body.originText || !body.destinationText) {
      return renderError('Please describe both the origin and destination.');
    }
    if (!body.travelDate) {
      return renderError('Please choose a travel date.');
    }

    req.session.groupTripsUser = true; // ensure a stable session cookie, same pattern as booking flows

    const reference = await groupRequestsModel.createRequest({
      sessionId: req.sessionID,
      passengerName: body.passengerName,
      passengerPhone: body.passengerPhone,
      passengerEmail: body.passengerEmail,
      passengerCount,
      originText: body.originText,
      originCountyId: body.originCountyId || null,
      destinationText: body.destinationText,
      destinationCountyId: body.destinationCountyId || null,
      travelDate: body.travelDate,
      departureTime: body.departureTime || null,
      returnDate: body.returnDate || null,
      returnTime: body.returnTime || null,
      vehicleRequirements: body.vehicleRequirements,
      budgetKes: body.budgetKes || null,
      notes: body.notes,
    });

    res.redirect(`/group-trips/${reference}`);
  })
);

// --------------------------------------------------
// GET /group-trips/:reference — view request + compare quotations
// --------------------------------------------------
router.get(
  '/group-trips/:reference',
  asyncRoute(async (req, res) => {
    const request = await groupRequestsModel.getRequestByReferenceForSession(req.params.reference, req.sessionID);
    if (!request) {
      return res.status(404).render('errors/404', { title: 'Request not found' });
    }

    const quotations = await groupQuotationsModel.listQuotationsForRequest(request.id);

    res.render('passenger/group-request-detail', {
      title: `Request ${request.request_reference}`,
      request,
      quotations,
      error: null,
    });
  })
);

// --------------------------------------------------
// POST /group-trips/:reference/quotations/:quotationId/accept
// --------------------------------------------------
router.post(
  '/group-trips/:reference/quotations/:quotationId/accept',
  asyncRoute(async (req, res) => {
    const result = await groupBookingsModel.acceptQuotation({
      requestReference: req.params.reference,
      quotationId: Number(req.params.quotationId),
      sessionId: req.sessionID,
    });

    if (!result.ok) {
      const request = await groupRequestsModel.getRequestByReferenceForSession(req.params.reference, req.sessionID);
      if (!request) return res.status(404).render('errors/404', { title: 'Request not found' });
      const quotations = await groupQuotationsModel.listQuotationsForRequest(request.id);
      return res.status(400).render('passenger/group-request-detail', {
        title: `Request ${request.request_reference}`,
        request,
        quotations,
        error: ACCEPT_FAILURE_MESSAGES[result.reason] || 'Could not accept that quotation.',
      });
    }

    const request = await groupRequestsModel.getRequestByReferenceForSession(req.params.reference, req.sessionID);
    await notifier.onGroupQuotationAccepted({
      requestId: request.id,
      acceptedQuotationId: Number(req.params.quotationId),
    });

    res.redirect(`/bookings/${result.reference}/pay`);
  })
);

// --------------------------------------------------
// POST /group-trips/:reference/quotations/:quotationId/reject
// --------------------------------------------------
router.post(
  '/group-trips/:reference/quotations/:quotationId/reject',
  asyncRoute(async (req, res) => {
    const request = await groupRequestsModel.getRequestByReferenceForSession(req.params.reference, req.sessionID);
    if (!request) return res.status(404).render('errors/404', { title: 'Request not found' });

    const quotationId = Number(req.params.quotationId);
    const quotation = await groupQuotationsModel.getQuotationById(quotationId);
    const declined = await groupQuotationsModel.rejectQuotationAsPassenger(quotationId, request.id);
    if (declined && quotation) {
      await notifier.onGroupQuotationDeclined({ request, quotation });
    }
    res.redirect(`/group-trips/${req.params.reference}`);
  })
);

// --------------------------------------------------
// GET /group-bookings/:reference — group booking status/confirmation
// --------------------------------------------------
router.get(
  '/group-bookings/:reference',
  asyncRoute(async (req, res) => {
    const booking = await groupBookingsModel.getGroupBookingByReference(req.params.reference, req.sessionID);
    if (!booking) return res.status(404).render('errors/404', { title: 'Booking not found' });

    res.render('passenger/group-booking-confirmation', {
      title: 'Group booking',
      booking,
      reference: req.params.reference,
    });
  })
);

module.exports = router;
