// ==================================================
// StageLink — application error handling
// ==================================================
// Two pieces:
//   notFoundHandler — reached when no route matched at all (404).
//   errorHandler    — reached when any route/middleware calls next(err),
//                      or throws inside an async handler wrapped by
//                      asyncRoute below.
//
// Users only ever see a clean, understandable message. Full technical
// detail (stack trace, SQL error, etc.) is logged server-side only,
// per the spec's "technical details logged internally, not dumped to
// users" requirement.
// ==================================================

function notFoundHandler(req, res) {
  res.status(404).render('errors/404', {
    title: 'Page not found',
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || 500;

  console.error(`[error] ${req.method} ${req.originalUrl} ->`, err);

  res.status(status).render('errors/500', {
    title: 'Something went wrong',
    // Only ever show a generic message in the view — never err.message
    // or err.stack, which could leak internal details to the user.
  });
}

/**
 * Wraps an async route handler so a rejected promise is forwarded to
 * errorHandler instead of crashing the process or hanging the request.
 * Usage: router.get('/path', asyncRoute(async (req, res) => { ... }))
 */
function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

module.exports = { notFoundHandler, errorHandler, asyncRoute };
