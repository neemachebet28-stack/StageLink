// ==================================================
// StageLink — rate limiting
// ==================================================
// In-memory, per-process sliding windows. Right for a single Node
// process; behind several processes/instances this needs a shared
// store (e.g. Redis) — noted in SECURITY_AUDIT.md. Keys that fall
// outside the window are swept every minute so the maps can't grow
// without bound.
const securityEvents = require('../models/securityEvents');

function wantsJson(req) {
  return (
    req.path.startsWith('/api/') ||
    req.xhr ||
    (req.get('accept') || '').includes('application/json')
  );
}

function sweep(map, windowMs) {
  const now = Date.now();
  for (const [key, entry] of map) {
    if (now - entry.start > windowMs) map.delete(key);
  }
}

/** Middleware limiter: at most `max` requests per `windowMs` per key. */
function createLimiter({ name, windowMs, max, key, message = 'Too many requests. Please slow down and try again shortly.' }) {
  const hits = new Map();
  setInterval(() => sweep(hits, windowMs), 60 * 1000).unref();

  return function limiter(req, res, next) {
    const k = key(req);
    if (!k) return next();

    const now = Date.now();
    let entry = hits.get(k);
    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, count: 0 };
      hits.set(k, entry);
    }
    entry.count += 1;
    if (entry.count <= max) return next();

    const retryAfter = Math.max(1, Math.ceil((entry.start + windowMs - now) / 1000));
    res.set('Retry-After', String(retryAfter));
    securityEvents.record({
      type: 'ratelimit.exceeded',
      userId: req.currentUser ? req.currentUser.id : null,
      ip: req.ip,
      details: `${name} ${req.method} ${req.path}`,
    });
    if (wantsJson(req)) return res.status(429).json({ success: false, message });
    return res.status(429).render('errors/429', { title: 'Too many requests', message, retryAfter });
  };
}

/** Failure counter (for login): record failures, block once a key hits `max`. */
function createCounter({ windowMs, max }) {
  const fails = new Map();
  setInterval(() => sweep(fails, windowMs), 60 * 1000).unref();

  return {
    isBlocked(key) {
      const entry = fails.get(key);
      if (!entry) return false;
      if (Date.now() - entry.start > windowMs) {
        fails.delete(key);
        return false;
      }
      return entry.count >= max;
    },
    fail(key) {
      const now = Date.now();
      const entry = fails.get(key);
      if (!entry || now - entry.start > windowMs) fails.set(key, { start: now, count: 1 });
      else entry.count += 1;
    },
    clear(key) {
      fails.delete(key);
    },
  };
}

module.exports = { createLimiter, createCounter, wantsJson };
