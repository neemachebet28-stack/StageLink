// ==================================================
// StageLink — operator settings + not-yet-built nav sections
// ==================================================
// Settings only — Group Trips (Phase 9) and Notifications (Phase 10)
// now have their own real implementations.
const express = require('express');
const router = express.Router();

const { asyncRoute } = require('../middleware/errorHandler');
const { requireAuth, requireRole, ROLES } = require('../middleware/auth');
const organizationModel = require('../models/organization');
const notificationsModel = require('../models/notifications');

router.use(requireAuth, requireRole(ROLES.OPERATOR));

router.get(
  '/settings',
  asyncRoute(async (req, res) => {
    const organization = await organizationModel.getOrganization(req.currentUser.organizationId);
    res.render('operator/settings', { title: 'Settings', organization, error: null, success: false });
  })
);

router.post(
  '/settings',
  asyncRoute(async (req, res) => {
    const organizationId = req.currentUser.organizationId;
    const { name, description, contactEmail, contactPhone, logoUrl } = req.body;

    if (!name) {
      const organization = await organizationModel.getOrganization(organizationId);
      return res.status(400).render('operator/settings', {
        title: 'Settings',
        organization: { ...organization, ...req.body },
        error: 'Organization name is required.',
        success: false,
      });
    }

    await organizationModel.updateOrganizationProfile(organizationId, {
      name,
      description,
      contactEmail,
      contactPhone,
      logoUrl,
    });

    const organization = await organizationModel.getOrganization(organizationId);
    res.render('operator/settings', { title: 'Settings', organization, error: null, success: true });
  })
);

router.get(
  '/notifications',
  asyncRoute(async (req, res) => {
    const keys = notificationsModel.recipientKeysForRequest(req);
    const notifications = await notificationsModel.listForKeys(keys);
    res.render('operator/notifications', {
      title: 'Notifications',
      notifications,
      returnTo: '/operator/notifications',
    });
  })
);

module.exports = router;
