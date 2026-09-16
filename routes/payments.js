// ==================================================
// StageLink — payment routes
// ==================================================
// Individual seat bookings and group charter bookings (Phase 9) share
// this one set of routes — resolveOwned() below is the only place
// that branches on which kind a reference is; everything downstream
// (payment initiation, status polling, the callback) is identical
// either way, via models/payments.js.
const express = require('express');
const router = express.Router();

const { asyncRoute } = require('../middleware/errorHandler');
const bookingsModel = require('../models/bookings');
const groupBookingsModel = require('../models/groupBookings');
const reviewsModel = require('../models/reviews');
const paymentsModel = require('../models/payments');
const mpesa = require('../services/mpesa');

const INITIATE_FAILURE_MESSAGES = {
  not_found: "We couldn't find a pending booking for that reference on this device.",
  booking_expired: 'This booking has expired. Please select your seat again.',
  already_paid: 'This booking has already been paid for.',
  payment_in_progress: 'A payment request was already sent to your phone. Check it before trying again.',
  mpesa_error: 'M-Pesa could not be reached. Please try again in a moment.',
};

/**
 * Resolves a reference to whichever kind of booking it belongs to,
 * scoped to this session regardless of status (so an already-paid or
 * expired booking still resolves — callers decide what to show).
 * Returns null if this session doesn't own anything under that
 * reference at all.
 */
async function resolveOwned(reference, sessionId) {
  const individual = await bookingsModel.getBookingsByReference(reference, sessionId);
  if (individual.length > 0) {
    return {
      isGroup: false,
      amountKes: individual.reduce((sum, b) => sum + Number(b.fare_kes), 0),
      itemLabel: `${individual.length} seat${individual.length === 1 ? '' : 's'}`,
      status: individual[0].status,
      organizationId: individual[0].organization_id,
      organizationName: individual[0].organization_name,
      verificationStatus: individual[0].verification_status,
    };
  }

  const group = await groupBookingsModel.getGroupBookingByReference(reference, sessionId);
  if (group) {
    return {
      isGroup: true,
      amountKes: Number(group.agreed_price_kes),
      itemLabel: `Group charter — ${group.passenger_count} passengers`,
      status: group.status,
      organizationId: group.organization_id,
      organizationName: group.organization_name,
      verificationStatus: group.verification_status,
    };
  }

  return null;
}

/** The operator being paid, with real verification + review data, for the trust block. */
async function operatorTrust(owned) {
  return {
    name: owned.organizationName,
    verificationStatus: owned.verificationStatus,
    summary: await reviewsModel.getPublishedSummaryForOrganization(owned.organizationId),
  };
}

// --------------------------------------------------
// GET /bookings/:reference/pay — payment initiation form
// --------------------------------------------------
router.get(
  '/bookings/:reference/pay',
  asyncRoute(async (req, res) => {
    const reference = req.params.reference;
    const owned = await resolveOwned(reference, req.sessionID);
    if (!owned) {
      return res.status(404).render('errors/404', { title: 'Booking not found' });
    }

    const latestPayment = await paymentsModel.getLatestPaymentForReference(reference);

    res.render('passenger/payment', {
      title: 'Pay for your booking',
      reference,
      itemLabel: owned.itemLabel,
      amountKes: owned.amountKes,
      operator: await operatorTrust(owned),
      latestPayment,
      sandbox: !mpesa.isConfigured,
      error: null,
      pageScripts: ['/js/payment-status.js'],
    });
  })
);

// --------------------------------------------------
// POST /bookings/:reference/pay — initiate STK push
// --------------------------------------------------
router.post(
  '/bookings/:reference/pay',
  asyncRoute(async (req, res) => {
    const reference = req.params.reference;
    const phoneNumber = (req.body.phoneNumber || '').trim();

    const renderError = async (message) => {
      const owned = await resolveOwned(reference, req.sessionID);
      if (!owned) {
        return res.status(404).render('errors/404', { title: 'Booking not found' });
      }
      const latestPayment = await paymentsModel.getLatestPaymentForReference(reference);
      res.status(400).render('passenger/payment', {
        title: 'Pay for your booking',
        reference,
        itemLabel: owned.itemLabel,
        amountKes: owned.amountKes,
        operator: await operatorTrust(owned),
        latestPayment,
        sandbox: !mpesa.isConfigured,
        error: message,
        pageScripts: ['/js/payment-status.js'],
      });
    };

    if (!/^2547\d{8}$/.test(phoneNumber) && !/^2541\d{8}$/.test(phoneNumber)) {
      return renderError('Enter a valid M-Pesa number in the format 2547XXXXXXXX.');
    }

    const result = await paymentsModel.initiatePayment({
      bookingReference: reference,
      sessionId: req.sessionID,
      phoneNumber,
    });

    if (!result.ok) {
      return renderError(result.message || INITIATE_FAILURE_MESSAGES[result.reason] || 'Payment could not be started.');
    }

    res.redirect(`/bookings/${reference}/pay`);
  })
);

// --------------------------------------------------
// GET /bookings/:reference/payment-status — JSON poll
// --------------------------------------------------
router.get(
  '/bookings/:reference/payment-status',
  asyncRoute(async (req, res) => {
    const reference = req.params.reference;
    const owned = await resolveOwned(reference, req.sessionID);
    if (!owned) {
      return res.status(404).json({ error: 'not_found' });
    }

    const payment = await paymentsModel.getLatestPaymentForReference(reference);

    res.json({
      bookingStatus: owned.status,
      paymentStatus: payment ? payment.status : null,
      mpesaReceiptNumber: payment ? payment.mpesa_receipt_number : null,
      resultDesc: payment ? payment.result_desc : null,
    });
  })
);

// --------------------------------------------------
// POST /mpesa/callback — Daraja webhook (public, no session)
// --------------------------------------------------
// Safaricom's servers call this directly, not the browser — it
// cannot require a session cookie. Correctness instead comes from
// checkout_request_id being unpredictable and from processCallback's
// idempotent, transaction-locked handling. See services/mpesa.js for
// exactly where the real MPESA_CALLBACK_URL must point.
router.post(
  '/mpesa/callback',
  asyncRoute(async (req, res) => {
    const body = req.body && req.body.Body && req.body.Body.stkCallback;

    if (!body || typeof body.CheckoutRequestID !== 'string') {
      // Malformed payload — acknowledge so Daraja doesn't retry
      // forever, but do nothing with it.
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const resultCode = body.ResultCode;
    const resultDesc = body.ResultDesc;
    let mpesaReceiptNumber = null;

    if (Array.isArray(body.CallbackMetadata && body.CallbackMetadata.Item)) {
      const receiptItem = body.CallbackMetadata.Item.find((item) => item.Name === 'MpesaReceiptNumber');
      mpesaReceiptNumber = receiptItem ? receiptItem.Value : null;
    }

    await paymentsModel.processCallback({
      checkoutRequestId: body.CheckoutRequestID,
      resultCode,
      resultDesc,
      mpesaReceiptNumber,
    });

    // Daraja expects a 200 with this shape regardless of outcome —
    // errors here are logged, not surfaced to Safaricom's retry logic.
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  })
);

module.exports = router;
