// ==================================================
// StageLink — authentication (login / logout)
// ==================================================
// Scope note: this is the minimum needed to safely gate the operator
// trip management added in this phase. Public passenger registration,
// password reset, and driver/admin-specific flows are still deferred
// to a later phase — see README.
const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();

const { asyncRoute } = require('../middleware/errorHandler');
const usersModel = require('../models/users');

router.get('/login', (req, res) => {
  if (req.currentUser) {
    const destinations = { operator: '/operator', driver: '/driver', admin: '/admin' };
    return res.redirect(destinations[req.currentUser.role] || '/');
  }
  res.render('login', { title: 'Sign in', error: null, email: '' });
});

router.post(
  '/login',
  asyncRoute(async (req, res) => {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    const renderInvalid = () =>
      res.status(401).render('login', {
        title: 'Sign in',
        error: 'That email or password is incorrect.',
        email,
      });

    if (!email || !password) {
      return renderInvalid();
    }

    const user = await usersModel.findActiveUserByEmail(email);
    if (!user) {
      return renderInvalid();
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return renderInvalid();
    }

    // Regenerate the session on login to prevent session fixation.
    req.session.regenerate((err) => {
      if (err) throw err;

      req.session.user = {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        organizationId: user.organization_id,
        organizationName: user.organization_name,
      };

      usersModel.touchLastLogin(user.id).catch(() => {
        // Non-critical — never block login on this write failing.
      });

      const destinations = { operator: '/operator', driver: '/driver', admin: '/admin' };
      res.redirect(destinations[user.role] || '/');
    });
  })
);

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('stagelink.sid');
    res.redirect('/login');
  });
});

module.exports = router;
