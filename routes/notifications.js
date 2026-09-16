// ==================================================
// StageLink — notification centre routes
// ==================================================
// Available to any visitor: a passenger reads notifications addressed
// to their browser session, a signed-in operator/driver additionally
// reads those addressed to their user account. Every query is scoped
// to the caller's own recipient keys (models/notifications.js), so an
// id belonging to someone else behaves exactly like a missing one.
const express = require('express');
const router = express.Router();

const { asyncRoute } = require('../middleware/errorHandler');
const notificationsModel = require('../models/notifications');

/** Only same-site paths are allowed as a post-action redirect target. */
function safeInternalPath(value, fallback) {
  if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')) return value;
  return fallback;
}

router.get(
  '/notifications',
  asyncRoute(async (req, res) => {
    const keys = notificationsModel.recipientKeysForRequest(req);
    const notifications = await notificationsModel.listForKeys(keys);
    res.render('passenger/notifications', {
      title: 'Notifications',
      notifications,
      returnTo: '/notifications',
    });
  })
);

router.get(
  '/api/notifications/unread-count',
  asyncRoute(async (req, res) => {
    const keys = notificationsModel.recipientKeysForRequest(req);
    res.set('Cache-Control', 'no-store');
    res.json({ count: await notificationsModel.countUnread(keys) });
  })
);

router.post(
  '/notifications/read-all',
  asyncRoute(async (req, res) => {
    const keys = notificationsModel.recipientKeysForRequest(req);
    const updated = await notificationsModel.markAllRead(keys);
    if (req.accepts(['html', 'json']) === 'json' || req.xhr) {
      return res.json({ success: true, updated });
    }
    res.redirect(safeInternalPath(req.body.returnTo, '/notifications'));
  })
);

router.post(
  '/notifications/:id/read',
  asyncRoute(async (req, res) => {
    const keys = notificationsModel.recipientKeysForRequest(req);
    const notification = await notificationsModel.getForKeys(Number(req.params.id), keys);
    if (!notification) return res.status(404).json({ success: false });

    await notificationsModel.markRead(notification.id, keys);
    if (req.accepts(['html', 'json']) === 'json' || req.xhr) {
      return res.json({ success: true });
    }
    res.redirect(safeInternalPath(req.body.returnTo, '/notifications'));
  })
);

// One tap: mark read, then go to the notification's action.
router.get(
  '/notifications/:id/open',
  asyncRoute(async (req, res) => {
    const keys = notificationsModel.recipientKeysForRequest(req);
    const notification = await notificationsModel.getForKeys(Number(req.params.id), keys);
    if (!notification) return res.status(404).render('errors/404', { title: 'Notification not found' });

    await notificationsModel.markRead(notification.id, keys);
    res.redirect(safeInternalPath(notification.action_url, '/notifications'));
  })
);

module.exports = router;
