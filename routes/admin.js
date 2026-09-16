// ==================================================
// StageLink — admin platform routes
// ==================================================
// Every route is protected by requireAuth + requireRole('admin').
// Read routes are deliberately cross-tenant (that's the point of an
// admin view). The handful of write actions — verification status,
// account suspension, review moderation — are each recorded to
// audit_logs immediately after they succeed.
const express = require('express');
const router = express.Router();

const { asyncRoute } = require('../middleware/errorHandler');
const { requireAuth, requireRole, ROLES } = require('../middleware/auth');
const admin = require('../models/admin');
const auditLog = require('../models/auditLog');
const reviewsModel = require('../models/reviews');
const notificationsModel = require('../models/notifications');
const mpesa = require('../services/mpesa');

router.use(requireAuth, requireRole(ROLES.ADMIN));

/** Renders one of the generic, read-only list pages. */
function listRoute(path, { heading, subheading, load, columns, rowLink }) {
  router.get(
    path,
    asyncRoute(async (req, res) => {
      const rows = await load();
      res.render('admin/generic-list', { title: heading, heading, subheading, rows, columns, rowLink });
    })
  );
}

function badRequest(res, title) {
  return res.status(400).render('errors/403', { title });
}

// ---- dashboard -----------------------------------------------------
router.get(
  '/',
  asyncRoute(async (req, res) => {
    res.render('admin/dashboard', { title: 'Dashboard', metrics: await admin.getDashboardMetrics() });
  })
);

// ---- users ---------------------------------------------------------
listRoute('/users', {
  heading: 'Users',
  subheading: 'Every account on the platform.',
  load: admin.listUsers,
  rowLink: (r) => `/admin/users/${r.id}`,
  columns: [
    { label: 'Name', key: 'full_name' },
    { label: 'Email', key: 'email' },
    { label: 'Role', key: 'role' },
    { label: 'Organization', key: 'organization_name' },
    { label: 'Status', key: 'status', type: 'badge' },
    { label: 'Joined', key: 'created_at', type: 'datetime' },
  ],
});

router.get(
  '/users/:userId',
  asyncRoute(async (req, res) => {
    const user = await admin.getUserById(Number(req.params.userId));
    if (!user) return res.status(404).render('errors/404', { title: 'User not found' });
    res.render('admin/user-detail', { title: user.full_name, user, isSelf: user.id === req.currentUser.id });
  })
);

router.post(
  '/users/:userId/status',
  asyncRoute(async (req, res) => {
    const userId = Number(req.params.userId);
    const { status } = req.body;
    if (!['active', 'suspended'].includes(status)) return badRequest(res, 'Invalid status');

    // An admin suspending their own account would lock the platform out.
    if (userId === req.currentUser.id) return badRequest(res, 'You cannot change your own account status');

    const before = await admin.getUserById(userId);
    if (!before) return res.status(404).render('errors/404', { title: 'User not found' });

    await admin.setUserStatus(userId, status);
    await auditLog.record({
      actorUserId: req.currentUser.id,
      action: 'user.status.update',
      targetType: 'user',
      targetId: userId,
      details: { from: before.status, to: status, email: before.email },
    });
    res.redirect(`/admin/users/${userId}`);
  })
);

// ---- operators -----------------------------------------------------
listRoute('/operators', {
  heading: 'Operators',
  subheading: 'Every transport operator on the platform.',
  load: admin.listOperators,
  rowLink: (r) => `/admin/operators/${r.id}`,
  columns: [
    { label: 'Name', key: 'name' },
    { label: 'Verification', key: 'verification_status', type: 'badge' },
    { label: 'Status', key: 'status', type: 'badge' },
    { label: 'Users', key: 'user_count' },
    { label: 'Vehicles', key: 'vehicle_count' },
    { label: 'Trips', key: 'trip_count' },
  ],
});

router.get(
  '/operators/:organizationId',
  asyncRoute(async (req, res) => {
    const organization = await admin.getOperatorById(Number(req.params.organizationId));
    if (!organization) return res.status(404).render('errors/404', { title: 'Operator not found' });
    const reviewSummary = await reviewsModel.getPublishedSummaryForOrganization(organization.id);
    res.render('admin/operator-detail', { title: organization.name, organization, reviewSummary });
  })
);

router.post(
  '/operators/:organizationId/verification',
  asyncRoute(async (req, res) => {
    const organizationId = Number(req.params.organizationId);
    const { verificationStatus } = req.body;
    if (!['unverified', 'pending', 'verified', 'rejected'].includes(verificationStatus)) {
      return badRequest(res, 'Invalid verification status');
    }

    const before = await admin.getOperatorById(organizationId);
    if (!before) return res.status(404).render('errors/404', { title: 'Operator not found' });

    await admin.updateOrganizationVerification(organizationId, verificationStatus);
    await auditLog.record({
      actorUserId: req.currentUser.id,
      action: 'organization.verification_status.update',
      targetType: 'organization',
      targetId: organizationId,
      details: { from: before.verification_status, to: verificationStatus, name: before.name },
    });
    res.redirect(`/admin/operators/${organizationId}`);
  })
);

router.post(
  '/operators/:organizationId/status',
  asyncRoute(async (req, res) => {
    const organizationId = Number(req.params.organizationId);
    const { status } = req.body;
    if (!['active', 'suspended', 'archived'].includes(status)) return badRequest(res, 'Invalid status');

    const before = await admin.getOperatorById(organizationId);
    if (!before) return res.status(404).render('errors/404', { title: 'Operator not found' });

    await admin.setOrganizationStatus(organizationId, status);
    await auditLog.record({
      actorUserId: req.currentUser.id,
      action: 'organization.status.update',
      targetType: 'organization',
      targetId: organizationId,
      details: { from: before.status, to: status, name: before.name },
    });
    res.redirect(`/admin/operators/${organizationId}`);
  })
);

// ---- transport network (read-only cross-tenant oversight) ----------
listRoute('/counties', {
  heading: 'Counties',
  load: admin.listCountiesWithCounts,
  columns: [
    { label: 'Name', key: 'name' },
    { label: 'Code', key: 'code' },
    { label: 'Towns', key: 'town_count' },
  ],
});

listRoute('/towns', {
  heading: 'Towns',
  load: admin.listTownsWithCounts,
  columns: [
    { label: 'Name', key: 'name' },
    { label: 'County', key: 'county_name' },
    { label: 'Stages', key: 'stage_count' },
  ],
});

listRoute('/stages', {
  heading: 'Stages',
  load: admin.listStagesForAdmin,
  columns: [
    { label: 'Name', key: 'name' },
    { label: 'Town', key: 'town_name' },
    { label: 'County', key: 'county_name' },
    { label: 'Status', key: 'status', type: 'badge' },
    { label: 'Operators', key: 'operator_count' },
  ],
});

listRoute('/routes', {
  heading: 'Routes',
  load: admin.listRoutesForAdmin,
  columns: [
    { label: 'Operator', key: 'organization_name' },
    { label: 'Origin', key: 'origin_stage_name' },
    { label: 'Destination', key: 'destination_name' },
    { label: 'Fare', key: 'base_fare_kes', type: 'kes' },
    { label: 'Status', key: 'status', type: 'badge' },
  ],
});

// ---- fleet ---------------------------------------------------------
listRoute('/vehicles', {
  heading: 'Vehicles',
  load: admin.listVehiclesForAdmin,
  columns: [
    { label: 'Registration', key: 'registration_number' },
    { label: 'Operator', key: 'organization_name' },
    { label: 'Seat layout', key: 'seat_layout_name' },
    { label: 'Seats', key: 'total_seats' },
    { label: 'Status', key: 'status', type: 'badge' },
  ],
});

listRoute('/drivers', {
  heading: 'Drivers',
  load: admin.listDriversForAdmin,
  columns: [
    { label: 'Name', key: 'full_name' },
    { label: 'Operator', key: 'organization_name' },
    { label: 'Phone', key: 'phone' },
    { label: 'Login', key: 'login_email' },
    { label: 'Status', key: 'status', type: 'badge' },
  ],
});

// ---- trips & bookings ------------------------------------------------
listRoute('/trips', {
  heading: 'Trips',
  subheading: 'Most recent 300 across every operator.',
  load: admin.listTripsForAdmin,
  columns: [
    { label: 'Operator', key: 'organization_name' },
    { label: 'Origin', key: 'origin_stage_name' },
    { label: 'Destination', key: 'destination_name' },
    { label: 'Vehicle', key: 'registration_number' },
    { label: 'Departure', key: 'scheduled_departure', type: 'datetime' },
    { label: 'Status', key: 'status', type: 'badge' },
  ],
});

listRoute('/bookings', {
  heading: 'Bookings',
  subheading: 'Most recent 300 across every operator.',
  load: admin.listBookingsForAdmin,
  columns: [
    { label: 'Reference', key: 'booking_reference' },
    { label: 'Passenger', key: 'passenger_name' },
    { label: 'Operator', key: 'organization_name' },
    { label: 'Origin', key: 'origin_stage_name' },
    { label: 'Fare', key: 'fare_kes', type: 'kes' },
    { label: 'Status', key: 'status', type: 'badge' },
  ],
});

// Payments are sensitive: phone numbers are masked (models/admin.js)
// and no raw provider metadata is selected.
listRoute('/payments', {
  heading: 'Payments',
  subheading: 'Most recent 300 across every operator. Phone numbers are masked.',
  load: admin.listPaymentsForAdmin,
  columns: [
    { label: 'Reference', key: 'booking_reference' },
    { label: 'Operator', key: 'organization_name' },
    { label: 'Phone', key: 'phone_number' },
    { label: 'Amount', key: 'amount_kes', type: 'kes' },
    { label: 'Receipt', key: 'mpesa_receipt_number' },
    { label: 'Status', key: 'status', type: 'badge' },
  ],
});

listRoute('/group-requests', {
  heading: 'Group Requests',
  load: admin.listGroupRequestsForAdmin,
  columns: [
    { label: 'Reference', key: 'request_reference' },
    { label: 'Origin', key: 'origin_text' },
    { label: 'Destination', key: 'destination_text' },
    { label: 'Passengers', key: 'passenger_count' },
    { label: 'Quotations', key: 'quotation_count' },
    { label: 'Status', key: 'status', type: 'badge' },
  ],
});

// ---- subscriptions: honest — no billing model exists (database.sql) --
router.get('/subscriptions', (req, res) => {
  res.render('admin/coming-soon', {
    title: 'Subscriptions',
    heading: 'Subscriptions',
    body: 'Operator billing/subscription plans are not built yet — the master spec never details pricing tiers or a billing flow, so there is nothing real to manage here yet. This is a planned feature, not a bug.',
  });
});

// ---- reviews (moderation) ---------------------------------------------
router.get(
  '/reviews',
  asyncRoute(async (req, res) => {
    const status = ['published', 'hidden', 'flagged'].includes(req.query.status) ? req.query.status : undefined;
    const reviews = await reviewsModel.listForAdmin({ status });
    res.render('admin/reviews-index', { title: 'Reviews', reviews, status: status || '' });
  })
);

router.post(
  '/reviews/:reviewId/status',
  asyncRoute(async (req, res) => {
    const reviewId = Number(req.params.reviewId);
    const { status } = req.body;
    if (!['published', 'hidden', 'flagged'].includes(status)) return badRequest(res, 'Invalid status');

    const before = await reviewsModel.getById(reviewId);
    if (!before) return res.status(404).render('errors/404', { title: 'Review not found' });

    await reviewsModel.setStatus(reviewId, status);
    await auditLog.record({
      actorUserId: req.currentUser.id,
      action: 'review.status.update',
      targetType: 'review',
      targetId: reviewId,
      details: { from: before.status, to: status, organization_id: before.organization_id },
    });
    res.redirect('/admin/reviews');
  })
);

// ---- notifications: the same reusable component every shell uses ------
router.get(
  '/notifications',
  asyncRoute(async (req, res) => {
    const keys = notificationsModel.recipientKeysForRequest(req);
    const notifications = await notificationsModel.listForKeys(keys);
    res.render('admin/notifications', { title: 'Notifications', notifications, returnTo: '/admin/notifications' });
  })
);

// ---- audit logs ---------------------------------------------------------
router.get(
  '/audit-logs',
  asyncRoute(async (req, res) => {
    res.render('admin/audit-logs', { title: 'Audit Logs', logs: await auditLog.list({ limit: 200 }) });
  })
);

// ---- settings: only the operational configuration that really exists ----
router.get('/settings', (req, res) => {
  res.render('admin/settings', {
    title: 'Settings',
    appName: process.env.APP_NAME || 'StageLink',
    environment: process.env.NODE_ENV || 'development',
    mpesaSandbox: !mpesa.isConfigured,
  });
});

module.exports = router;
