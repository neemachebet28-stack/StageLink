// ==================================================
// StageLink — application entry point
// ==================================================
// Express + EJS configuration, security middleware (headers, CSRF,
// persistent sessions), route wiring, startup safety checks, and the
// background sweeps. See SECURITY_AUDIT.md for why each protection exists.
// ==================================================

require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');

const { pool, verifyConnection } = require('./config/db');
const { MySQLSessionStore } = require('./models/sessionStore');
const { securityHeaders, csrfProtection, csrfRender } = require('./middleware/security');
const { runStartupChecks } = require('./config/startupChecks');
const mpesa = require('./services/mpesa');
const { attachCurrentUser } = require('./middleware/auth');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { formatDateTime, timeAgo } = require('./utils/format');
const { metaFor } = require('./utils/notificationMeta');
const notifier = require('./services/notifier');
const notificationsModel = require('./models/notifications');
const notificationRoutes = require('./routes/notifications');
const reviewRoutes = require('./routes/reviews');
const adminRoutes = require('./routes/admin');
const mainRoutes = require('./routes/main');
const discoverRoutes = require('./routes/discover');
const operatorRoutes = require('./routes/operators');
const destinationRoutes = require('./routes/destinations');
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const operatorDashboardRoutes = require('./routes/operator');
const operatorFleetRoutes = require('./routes/operatorFleet');
const operatorCommerceRoutes = require('./routes/operatorCommerce');
const operatorSettingsRoutes = require('./routes/operatorSettings');
const driverRoutes = require('./routes/driver');
const groupTripsRoutes = require('./routes/groupTrips');
const operatorGroupTripsRoutes = require('./routes/operatorGroupTrips');
const bookingRoutes = require('./routes/booking');
const paymentRoutes = require('./routes/payments');
const ticketRoutes = require('./routes/tickets');
const { expireStaleHoldsGlobal } = require('./models/seatHolds');
const { expireStaleBookings } = require('./models/bookings');
const { expireStaleGroupBookings } = require('./models/groupBookings');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// --------------------------------------------------
// View engine
// --------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --------------------------------------------------
// Core middleware
// --------------------------------------------------
app.disable('x-powered-by'); // don't advertise the framework

// Behind a TLS-terminating proxy (nginx, a load balancer), Express must be
// told how many hops to trust or it can't see HTTPS (secure cookies are
// then never set) or the real client IP (rate limits key on it).
if (process.env.TRUST_PROXY !== undefined && process.env.TRUST_PROXY !== '') {
  const hops = Number(process.env.TRUST_PROXY);
  app.set('trust proxy', Number.isInteger(hops) ? hops : process.env.TRUST_PROXY);
}

app.use(securityHeaders(isProduction));

// Small limits (a booking form is a few hundred bytes), flat key=value
// parsing only: nested/object-style form input has no legitimate use here.
app.use(express.urlencoded({ extended: false, limit: '20kb', parameterLimit: 100 }));
app.use(express.json({ limit: '20kb' }));

// --------------------------------------------------
// Static assets
// --------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

// --------------------------------------------------
// Session infrastructure
// --------------------------------------------------
// MySQL-backed (models/sessionStore.js): sessions survive restarts and
// can't grow process memory without bound. httpOnly + sameSite=lax; the
// cookie is `secure` in production (needs TRUST_PROXY behind a proxy).
const sessionStore = new MySQLSessionStore(pool);

app.use(
  session({
    name: 'stagelink.sid',
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

// Makes req.currentUser / res.locals.currentUser available everywhere,
// including inside every EJS view, ahead of routes being defined.
app.use(attachCurrentUser);

// Values every view can rely on without each route passing them.
app.use((req, res, next) => {
  res.locals.appName = process.env.APP_NAME || 'StageLink';
  res.locals.currentPath = req.path;
  res.locals.formatDateTime = formatDateTime;
  res.locals.timeAgo = timeAgo;
  res.locals.notificationMeta = metaFor;
  next();
});

// CSRF: inject tokens into rendered forms, then require them on every
// unsafe request (see middleware/security.js).
app.use(csrfRender);
app.use(csrfProtection);

// --------------------------------------------------
// Routes
// --------------------------------------------------
app.use('/', mainRoutes);
app.use('/', authRoutes);
app.use('/', discoverRoutes);
app.use('/', operatorRoutes);
app.use('/', destinationRoutes);
app.use('/', apiRoutes);
app.use('/', bookingRoutes);
app.use('/', paymentRoutes);
app.use('/', ticketRoutes);
app.use('/operator', operatorDashboardRoutes);
app.use('/operator', operatorFleetRoutes);
app.use('/operator', operatorCommerceRoutes);
app.use('/operator', operatorSettingsRoutes);
app.use('/driver', driverRoutes);
app.use('/', groupTripsRoutes);
app.use('/', notificationRoutes);
app.use('/', reviewRoutes);
app.use('/operator', operatorGroupTripsRoutes);
app.use('/admin', adminRoutes);

// --------------------------------------------------
// Error handling (must be registered last)
// --------------------------------------------------
app.use(notFoundHandler);
app.use(errorHandler);

// --------------------------------------------------
// Startup
// --------------------------------------------------
async function start() {
  const dbStatus = await verifyConnection();

  const { problems, warnings } = await runStartupChecks({ pool, isProduction, mpesa });
  warnings.forEach((w) => console.warn(`[startup] WARNING: ${w}`));
  if (problems.length > 0) {
    problems.forEach((p) => console.error(`[startup] FATAL: ${p}`));
    console.error('[startup] Refusing to start with an unsafe configuration.');
    process.exit(1);
  }

  if (dbStatus.connected) {
    console.log('[startup] MySQL connection verified.');
  } else {
    console.error(
      '[startup] Could not connect to MySQL. The server will still start ' +
        'so static pages remain reachable, but any database-backed feature ' +
        'will fail until the connection is fixed. Cause:',
      dbStatus.error && dbStatus.error.message
    );
  }

  app.listen(PORT, () => {
    console.log(`[startup] StageLink running on http://localhost:${PORT}`);
  });

  // Automatic seat-hold expiry: frees seats whose hold has passed its
  // TTL even if nobody is actively browsing that trip. Correctness
  // never depends on this timing — see the note in models/seatHolds.js
  // — this just keeps seats looking available promptly for everyone else.
  const EXPIRY_SWEEP_INTERVAL_MS = 30 * 1000;
  setInterval(() => {
    expireStaleHoldsGlobal().catch((error) => {
      console.error('[seat-hold-sweep] failed:', error.message);
    });
  }, EXPIRY_SWEEP_INTERVAL_MS);

  // Same pattern as the seat-hold sweep, one level up: a booking that
  // never gets paid within its payment_due_at window releases its
  // seat back to available rather than holding it hostage forever.
  setInterval(() => {
    expireStaleBookings().catch((error) => {
      console.error('[booking-expiry-sweep] failed:', error.message);
    });
  }, EXPIRY_SWEEP_INTERVAL_MS);

  setInterval(() => {
    expireStaleGroupBookings().catch((error) => {
      console.error('[group-booking-expiry-sweep] failed:', error.message);
    });
  }, EXPIRY_SWEEP_INTERVAL_MS);

  // Expired sessions are pruned every 15 minutes.
  setInterval(() => {
    sessionStore.pruneExpired().catch((error) => {
      console.error('[session-prune] failed:', error.message);
    });
  }, 15 * 60 * 1000);

  // Notifications: "departing soon" is time-based but driven by real
  // trip data, and idempotent (dedupe key) so running every minute is
  // free. Old notifications are pruned hourly (30-day retention).
  setInterval(() => {
    notifier.runUpcomingDepartureSweep();
  }, 60 * 1000);
  setInterval(() => {
    notificationsModel.pruneOld().catch((error) => {
      console.error('[notification-prune] failed:', error.message);
    });
  }, 60 * 60 * 1000);
}

start();

module.exports = app;
