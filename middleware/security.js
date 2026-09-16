// ==================================================
// StageLink — security headers, CSRF protection
// ==================================================
const crypto = require('crypto');
const securityEvents = require('../models/securityEvents');
const { wantsJson } = require('./rateLimit');

// --------------------------------------------------
// Headers
// --------------------------------------------------
// script-src 'self' (no inline script, no eval) is the XSS backstop:
// even if an escaping mistake ever lets markup through, injected script
// can't run. Views therefore contain no inline handlers — behaviour
// lives in /public/js. style-src keeps 'unsafe-inline' only because
// views use style="" attributes; style injection is far lower impact
// than script injection.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// Pages that show personal data or act on an account must never be
// served from a shared device's cache or back-button history.
const NO_STORE_PREFIXES = ['/operator', '/admin', '/driver', '/bookings', '/notifications', '/login', '/group-bookings', '/group-trips', '/api/notifications'];

function securityHeaders(isProduction) {
  return (req, res, next) => {
    res.set('Content-Security-Policy', CSP);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
    res.set('Cross-Origin-Opener-Policy', 'same-origin');
    if (isProduction) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (NO_STORE_PREFIXES.some((p) => req.path.startsWith(p))) {
      res.set('Cache-Control', 'no-store');
    }
    next();
  };
}

// --------------------------------------------------
// CSRF
// --------------------------------------------------
// Synchronizer token stored in the session. Every HTML response that
// contains a POST form gets the token injected into the form and as a
// <meta> tag (for fetch calls); every unsafe request must echo it.
// Plus an Origin/Sec-Fetch-Site check as a second, independent layer.
// /mpesa/callback is exempt: it is server-to-server (no browser, no
// session) and is protected by its own secret/IP/amount checks.
const EXEMPT_PREFIXES = ['/mpesa/callback'];

function ensureToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  return req.session.csrfToken;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function reject(req, res, reason) {
  securityEvents.record({
    type: 'csrf.rejected',
    userId: req.currentUser ? req.currentUser.id : null,
    ip: req.ip,
    details: `${reason}: ${req.method} ${req.path}`,
  });
  if (wantsJson(req)) {
    return res.status(403).json({ success: false, message: 'Your session expired. Please refresh the page and try again.' });
  }
  return res.status(403).render('errors/403', { title: 'Request blocked' });
}

function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (EXEMPT_PREFIXES.some((p) => req.path.startsWith(p))) return next();

  const origin = req.get('origin');
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch (e) {
      return reject(req, res, 'bad origin');
    }
    if (host !== req.get('host')) return reject(req, res, 'cross-origin');
  }
  if (req.get('sec-fetch-site') === 'cross-site') return reject(req, res, 'sec-fetch-site');

  const supplied = (req.body && req.body._csrf) || req.get('x-csrf-token');
  const expected = req.session && req.session.csrfToken;
  if (!expected || typeof supplied !== 'string' || !safeEqual(supplied, expected)) {
    return reject(req, res, 'missing or invalid token');
  }
  return next();
}

/** Wraps res.render so the token is injected wherever a form/fetch needs it. */
function csrfRender(req, res, next) {
  const originalRender = res.render.bind(res);
  res.render = function render(view, options, callback) {
    let opts = options;
    let cb = callback;
    if (typeof opts === 'function') {
      cb = opts;
      opts = {};
    }
    originalRender(view, opts || {}, (err, html) => {
      if (err) return cb ? cb(err) : req.next(err);
      let out = html;
      if (req.session && (out.includes('<form') || out.includes('data-csrf'))) {
        const token = ensureToken(req);
        out = out.replace(
          /(<form\b[^>]*\bmethod\s*=\s*["']post["'][^>]*>)/gi,
          `$1<input type="hidden" name="_csrf" value="${token}">`
        );
        out = out.replace('</head>', `<meta name="csrf-token" content="${token}">\n</head>`);
      }
      return cb ? cb(null, out) : res.send(out);
    });
  };
  next();
}

module.exports = { securityHeaders, csrfProtection, csrfRender };
