// ==================================================
// StageLink — operator bookings, passengers, payments, analytics
// ==================================================
const express = require('express');
const router = express.Router();

const { asyncRoute } = require('../middleware/errorHandler');
const { requireAuth, requireRole, ROLES } = require('../middleware/auth');
const operatorBookingsModel = require('../models/operatorBookings');
const operatorPaymentsModel = require('../models/operatorPayments');
const analyticsModel = require('../models/analytics');

router.use(requireAuth, requireRole(ROLES.OPERATOR));

router.get(
  '/bookings',
  asyncRoute(async (req, res) => {
    const status = req.query.status || undefined;
    const bookings = await operatorBookingsModel.listBookingsForOrganization(req.currentUser.organizationId, {
      status,
    });
    res.render('operator/bookings-index', { title: 'Bookings', bookings, status: status || '' });
  })
);

router.get(
  '/passengers',
  asyncRoute(async (req, res) => {
    const passengers = await operatorBookingsModel.listPassengersForOrganization(req.currentUser.organizationId);
    res.render('operator/passengers-index', { title: 'Passengers', passengers });
  })
);

router.get(
  '/payments',
  asyncRoute(async (req, res) => {
    const payments = await operatorPaymentsModel.listPaymentsForOrganization(req.currentUser.organizationId);
    res.render('operator/payments-index', { title: 'Payments', payments });
  })
);

router.get(
  '/analytics',
  asyncRoute(async (req, res) => {
    const organizationId = req.currentUser.organizationId;
    const [metrics, bookingsByDay, revenueByRoute] = await Promise.all([
      analyticsModel.getDashboardMetrics(organizationId),
      analyticsModel.getBookingsByDay(organizationId, 14),
      analyticsModel.getRevenueByRoute(organizationId),
    ]);
    res.render('operator/analytics', { title: 'Analytics', metrics, bookingsByDay, revenueByRoute });
  })
);

module.exports = router;
