// ==================================================
// StageLink — identifiers and route-parameter hygiene
// ==================================================
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity

/**
 * Booking/request references. crypto.randomInt, not Math.random():
 * Math.random is a predictable PRNG and must never produce anything a
 * person's access to a record could depend on.
 */
function secureReference(prefix, length = 8) {
  let out = prefix;
  for (let i = 0; i < length; i += 1) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

const NUMERIC_PARAMS = [
  'countyId', 'townId', 'stageId', 'organizationId', 'destinationId', 'routeId', 'tripId',
  'seatId', 'ticketId', 'vehicleId', 'driverId', 'requestId', 'quotationId', 'reviewId',
  'userId', 'linkId', 'id',
];

/**
 * A non-numeric id in a URL is a 404, not a database error. Registered
 * per router because Express applies router.param only to the router
 * it was declared on.
 */
function registerIdParams(router) {
  NUMERIC_PARAMS.forEach((name) => {
    router.param(name, (req, res, next, value) => {
      if (/^\d{1,10}$/.test(value)) return next();
      return res.status(404).render('errors/404', { title: 'Not found' });
    });
  });
}

module.exports = { secureReference, registerIdParams };
