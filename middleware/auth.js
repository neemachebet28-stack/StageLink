// ==================================================
// StageLink — role & authorization architecture
// ==================================================
// Phase 1 scope: establish the shared vocabulary and middleware shape
// that every later phase will use to enforce access control. No
// route in this phase actually requires login yet — registration and
// login are implemented in the next phase. These functions are wired
// into app.locals now so views can already reason about "the current
// user" without every later phase having to re-plumb it.
//
// IMPORTANT: authorization must always be enforced here, server-side.
// Hiding a button in a template is never sufficient on its own.
// ==================================================

const ROLES = Object.freeze({
  PASSENGER: 'passenger',
  OPERATOR: 'operator',
  DRIVER: 'driver',
  ADMIN: 'admin',
});

/**
 * Populates res.locals.currentUser for every request so templates can
 * read `currentUser` without each route setting it up manually.
 * Reads from the session once login exists (next phase); for now it
 * is always null, which is the correct "signed out" state.
 */
function attachCurrentUser(req, res, next) {
  req.currentUser = (req.session && req.session.user) || null;
  res.locals.currentUser = req.currentUser;
  next();
}

/**
 * Route guard: rejects unauthenticated requests.
 * Not yet applied to any route in Phase 1 — reserved for Phase 2
 * once login exists — but implemented now so the shape of
 * req.session.user is settled before routes depend on it.
 */
function requireAuth(req, res, next) {
  if (!req.currentUser) {
    return res.status(401).render('errors/401', {
      title: 'Sign in required',
    });
  }
  next();
}

/**
 * Route guard factory: rejects users whose role is not in the
 * allowed list. Always used after requireAuth. Organization-level
 * (tenant) isolation is a separate, additional check applied at the
 * data-access layer in later phases — this only checks role.
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.currentUser) {
      return res.status(401).render('errors/401', {
        title: 'Sign in required',
      });
    }
    if (!allowedRoles.includes(req.currentUser.role)) {
      return res.status(403).render('errors/403', {
        title: 'Access denied',
      });
    }
    next();
  };
}

module.exports = { ROLES, attachCurrentUser, requireAuth, requireRole };
