// ==================================================
// StageLink — notifier (event → notification)
// ==================================================
// Every notification StageLink sends is composed in this one file, and
// every function here is called from the code path that performs the
// real event (a verified payment callback, a trip status change, a
// hold expiring...) — never speculatively, never from the browser.
//
// Rules this file enforces:
//  * Notifications are written AFTER the underlying event has
//    committed, and a failure here is logged and swallowed — a broken
//    notification must never break a payment, a booking, or a boarding.
//  * Every notification has a deterministic dedupe key, so a replayed
//    callback / re-saved form / repeated sweep can't send a second copy
//    (models/notifications.js relies on the UNIQUE key for this).
//  * Noise is deliberately limited: one notification per checkout (not
//    per seat), and trip-status changes that are internal bookkeeping
//    ('scheduled', 'filling') are not sent to passengers at all.
const { pool } = require('../config/db');
const notificationsModel = require('../models/notifications');
const { formatDateTime } = require('../utils/format');

async function safely(label, fn) {
  try {
    return await fn();
  } catch (error) {
    console.error(`[notifier] ${label} failed:`, error.message);
    return null;
  }
}

function kes(amount) {
  return `KES ${Number(amount).toLocaleString()}`;
}

// ---- recipient helpers -------------------------------------------------

function toSession(sessionId, payload) {
  return notificationsModel.create({
    recipientKey: notificationsModel.sessionKey(sessionId),
    ...payload,
  });
}

function toUser(userId, organizationId, payload) {
  return notificationsModel.create({
    recipientKey: notificationsModel.userKey(userId),
    userId,
    organizationId,
    ...payload,
  });
}

async function operatorUserIds(organizationId) {
  const [rows] = await pool.query(
    `SELECT u.id FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.organization_id = ? AND r.name = 'operator' AND u.status = 'active'`,
    [organizationId]
  );
  return rows.map((r) => r.id);
}

async function toOrganizationOperators(organizationId, payload) {
  const ids = await operatorUserIds(organizationId);
  await Promise.all(ids.map((id) => toUser(id, organizationId, payload)));
}

/** One row per passenger session with a confirmed booking on the trip. */
async function confirmedPassengersForTrip(tripId) {
  const [rows] = await pool.query(
    `SELECT b.session_id, MIN(b.booking_reference) AS booking_reference
     FROM bookings b
     WHERE b.trip_id = ? AND b.status = 'confirmed'
     GROUP BY b.session_id`,
    [tripId]
  );
  return rows;
}

async function tripSummary(tripId) {
  const [rows] = await pool.query(
    `SELECT t.id, t.organization_id, t.scheduled_departure, t.confirmed_departure, t.driver_id,
            os.name AS origin, d.name AS destination, o.name AS organization_name,
            dr.user_id AS driver_user_id
     FROM trips t
     JOIN stages os ON os.id = t.origin_stage_id
     JOIN destinations d ON d.id = t.destination_id
     JOIN organizations o ON o.id = t.organization_id
     LEFT JOIN drivers dr ON dr.id = t.driver_id
     WHERE t.id = ?`,
    [tripId]
  );
  return rows[0] || null;
}

// ---- payments ----------------------------------------------------------

/**
 * Called by models/payments.js processCallback AFTER its transaction
 * commits, and only when the payment actually transitioned (a
 * duplicate callback returns early and never reaches here).
 */
function onPaymentResult({ payment, status, mpesaReceiptNumber, resultDesc }) {
  return safely('onPaymentResult', async () => {
    const reference = payment.booking_reference;

    if (status !== 'success') {
      await toSession(payment.session_id, {
        type: 'payment_failure',
        title: status === 'cancelled' ? 'Payment cancelled' : 'Payment failed',
        message: `${resultDesc || 'The payment did not go through.'} Your booking ${reference} is still reserved until it expires — you can try again.`,
        actionUrl: `/bookings/${reference}/pay`,
        actionLabel: 'Try again',
        dedupeKey: `payment:${payment.id}:${status}`,
      });
      return;
    }

    const [individual] = await pool.query(
      `SELECT b.trip_id, s.seat_number, os.name AS origin, d.name AS destination
       FROM bookings b
       JOIN seats s ON s.id = b.seat_id
       JOIN stages os ON os.id = b.origin_stage_id
       JOIN destinations d ON d.id = b.destination_id
       WHERE b.booking_reference = ?
       ORDER BY s.seat_number ASC`,
      [reference]
    );

    if (individual.length > 0) {
      const seats = individual.map((r) => r.seat_number).join(', ');
      const route = `${individual[0].origin} → ${individual[0].destination}`;

      await toSession(payment.session_id, {
        type: 'payment_success',
        title: 'Payment received',
        message: `${kes(payment.amount_kes)} received (M-Pesa ${mpesaReceiptNumber}). Booking ${reference} is confirmed.`,
        actionUrl: `/bookings/${reference}`,
        actionLabel: 'View booking',
        dedupeKey: `payment:${payment.id}:success`,
      });
      await toSession(payment.session_id, {
        type: 'ticket_ready',
        title: 'Your ticket is ready',
        message: `Seat${individual.length === 1 ? '' : 's'} ${seats} on ${route}. Show the QR code when boarding.`,
        actionUrl: `/bookings/${reference}/ticket`,
        actionLabel: 'View ticket',
        dedupeKey: `ticket-ready:${reference}`,
      });
      await toOrganizationOperators(payment.organization_id, {
        type: 'booking_confirmation',
        title: 'New confirmed booking',
        message: `${reference}: seat${individual.length === 1 ? '' : 's'} ${seats} on ${route} (${kes(payment.amount_kes)}).`,
        actionUrl: '/operator/bookings',
        actionLabel: 'View bookings',
        dedupeKey: `booking-confirmed:${reference}`,
      });
      return;
    }

    const [[group]] = await pool.query(
      `SELECT gr.origin_text, gr.destination_text, gb.passenger_count
       FROM group_bookings gb JOIN group_requests gr ON gr.id = gb.group_request_id
       WHERE gb.booking_reference = ?`,
      [reference]
    );
    if (group) {
      await toSession(payment.session_id, {
        type: 'payment_success',
        title: 'Payment received',
        message: `${kes(payment.amount_kes)} received (M-Pesa ${mpesaReceiptNumber}). Group booking ${reference} is confirmed.`,
        actionUrl: `/group-bookings/${reference}`,
        actionLabel: 'View booking',
        dedupeKey: `payment:${payment.id}:success`,
      });
      await toOrganizationOperators(payment.organization_id, {
        type: 'booking_confirmation',
        title: 'Group booking confirmed',
        message: `${reference}: ${group.passenger_count} passengers, ${group.origin_text} → ${group.destination_text} (${kes(payment.amount_kes)}).`,
        actionUrl: '/operator/group-trips',
        actionLabel: 'View group trips',
        dedupeKey: `booking-confirmed:${reference}`,
      });
    }
  });
}

// ---- seat holds --------------------------------------------------------

/**
 * @param {{session_id: string, trip_id: number, id: number}[]} holds
 * One notification per (session, trip) — a passenger who held four
 * seats gets one message, not four.
 */
function onHoldsExpired(holds) {
  return safely('onHoldsExpired', async () => {
    const groups = new Map();
    holds.forEach((h) => {
      const key = `${h.session_id}|${h.trip_id}`;
      const existing = groups.get(key);
      if (!existing) groups.set(key, { ...h, count: 1, maxId: h.id });
      else {
        existing.count += 1;
        existing.maxId = Math.max(existing.maxId, h.id);
      }
    });

    for (const group of groups.values()) {
      const trip = await tripSummary(group.trip_id);
      if (!trip) continue;
      await toSession(group.session_id, {
        type: 'seat_hold_expiry',
        title: 'Seat hold expired',
        message: `Your held seat${group.count === 1 ? ' was' : 's were'} released on ${trip.origin} → ${trip.destination} because the hold timed out.`,
        actionUrl: `/trips/${group.trip_id}`,
        actionLabel: 'Select seats again',
        dedupeKey: `hold-expired:${group.trip_id}:${group.maxId}`,
      });
    }
  });
}

// ---- trips -------------------------------------------------------------

function normalizeDateTime(value) {
  if (!value) return null;
  return String(value).replace('T', ' ').slice(0, 16);
}

/**
 * @param {object} args
 * @param {number} args.tripId
 * @param {{status: string, estimated_departure: string|null}} args.before
 * @param {{status: string, estimated_departure: string|null}} args.after
 * @param {'operator'|'driver'} args.actor  who made the change
 */
function onTripUpdated({ tripId, before, after, actor }) {
  return safely('onTripUpdated', async () => {
    const trip = await tripSummary(tripId);
    if (!trip) return;
    const route = `${trip.origin} → ${trip.destination}`;
    const passengers = await confirmedPassengersForTrip(tripId);

    const notifyPassengers = ({ linkTo = 'ticket', ...payload }, keySuffix) =>
      Promise.all(
        passengers.map((p) =>
          toSession(p.session_id, {
            ...payload,
            actionUrl:
              linkTo === 'booking'
                ? `/bookings/${p.booking_reference}`
                : `/bookings/${p.booking_reference}/ticket`,
            actionLabel: linkTo === 'booking' ? 'View booking' : 'View ticket',
            dedupeKey: `trip:${tripId}:${keySuffix}`,
          })
        )
      );

    if (before.status !== after.status) {
      const status = after.status;

      if (status === 'confirmed') {
        const when = formatDateTime(trip.confirmed_departure || trip.scheduled_departure);
        await notifyPassengers(
          {
            type: 'confirmed_departure',
            title: 'Departure confirmed',
            message: `${trip.organization_name} has confirmed departure for ${route}: ${when}.`,
          },
          'confirmed'
        );
      } else if (status === 'cancelled') {
        await notifyPassengers(
          {
            type: 'cancellation',
            title: 'Trip cancelled',
            message: `${route} (${formatDateTime(trip.scheduled_departure)}) was cancelled by ${trip.organization_name}. Please contact them about your booking.`,
            linkTo: 'booking',
          },
          'cancelled'
        );
        if (trip.driver_user_id) {
          await toUser(trip.driver_user_id, trip.organization_id, {
            type: 'cancellation',
            title: 'Trip cancelled',
            message: `${route} (${formatDateTime(trip.scheduled_departure)}) has been cancelled.`,
            actionUrl: '/driver',
            actionLabel: 'My trips',
            dedupeKey: `trip:${tripId}:cancelled`,
          });
        }
      } else if (['boarding', 'departed', 'arrived'].includes(status)) {
        const label = { boarding: 'is now boarding', departed: 'has departed', arrived: 'has arrived' }[status];
        await notifyPassengers(
          {
            type: 'trip_status_change',
            title: `Trip ${status}`,
            message: `Your trip ${route} ${label}.`,
          },
          `status:${status}`
        );
        // Operators are told when a driver moves the trip along; not
        // when they made the change themselves.
        if (actor === 'driver') {
          await toOrganizationOperators(trip.organization_id, {
            type: 'trip_status_change',
            title: `Trip ${status}`,
            message: `The driver marked ${route} (${formatDateTime(trip.scheduled_departure)}) as ${status}.`,
            actionUrl: '/operator/trips',
            actionLabel: 'View trips',
            dedupeKey: `trip:${tripId}:status:${status}`,
          });
        }
      }
      // 'scheduled' / 'filling' are internal bookkeeping — deliberately silent.
    }

    const beforeEta = normalizeDateTime(before.estimated_departure);
    const afterEta = normalizeDateTime(after.estimated_departure);
    if (afterEta && afterEta !== beforeEta) {
      await notifyPassengers(
        {
          type: 'trip_status_change',
          title: 'Estimated departure updated',
          message: `${route}: the estimated departure is now ${formatDateTime(afterEta)}.`,
        },
        `eta:${afterEta}`
      );
    }
  });
}

/**
 * Time-based, but still driven by real data: a confirmed passenger (or
 * the assigned driver) is told once when their trip is under an hour
 * away. The dedupe key makes re-running this sweep every minute free.
 */
function runUpcomingDepartureSweep() {
  return safely('runUpcomingDepartureSweep', async () => {
    const [passengers] = await pool.query(
      `SELECT b.session_id, MIN(b.booking_reference) AS booking_reference, t.id AS trip_id,
              t.scheduled_departure, os.name AS origin, d.name AS destination
       FROM bookings b
       JOIN trips t ON t.id = b.trip_id
       JOIN stages os ON os.id = t.origin_stage_id
       JOIN destinations d ON d.id = t.destination_id
       WHERE b.status = 'confirmed'
         AND t.status IN ('scheduled', 'filling', 'confirmed', 'boarding')
         AND t.scheduled_departure > NOW()
         AND t.scheduled_departure <= DATE_ADD(NOW(), INTERVAL 60 MINUTE)
       GROUP BY b.session_id, t.id, t.scheduled_departure, os.name, d.name`
    );

    for (const p of passengers) {
      await toSession(p.session_id, {
        type: 'upcoming_departure',
        title: 'Departing soon',
        message: `${p.origin} → ${p.destination} is scheduled for ${formatDateTime(p.scheduled_departure)}. Head to the stage.`,
        actionUrl: `/bookings/${p.booking_reference}/ticket`,
        actionLabel: 'View ticket',
        dedupeKey: `upcoming:${p.trip_id}`,
      });
    }

    const [drivers] = await pool.query(
      `SELECT dr.user_id, dr.organization_id, t.id AS trip_id, t.scheduled_departure,
              os.name AS origin, d.name AS destination
       FROM trips t
       JOIN drivers dr ON dr.id = t.driver_id
       JOIN stages os ON os.id = t.origin_stage_id
       JOIN destinations d ON d.id = t.destination_id
       WHERE dr.user_id IS NOT NULL
         AND t.status IN ('scheduled', 'filling', 'confirmed', 'boarding')
         AND t.scheduled_departure > NOW()
         AND t.scheduled_departure <= DATE_ADD(NOW(), INTERVAL 60 MINUTE)`
    );

    for (const d of drivers) {
      await toUser(d.user_id, d.organization_id, {
        type: 'upcoming_departure',
        title: 'Departing soon',
        message: `${d.origin} → ${d.destination} is scheduled for ${formatDateTime(d.scheduled_departure)}.`,
        actionUrl: `/driver/trips/${d.trip_id}`,
        actionLabel: 'Open trip',
        dedupeKey: `upcoming:${d.trip_id}`,
      });
    }
  });
}

// ---- boarding ----------------------------------------------------------

function onBoarded(ticketId) {
  return safely('onBoarded', async () => {
    const [[row]] = await pool.query(
      `SELECT b.session_id, b.booking_reference, s.seat_number, os.name AS origin, d.name AS destination
       FROM tickets tk
       JOIN bookings b ON b.id = tk.booking_id
       JOIN seats s ON s.id = b.seat_id
       JOIN stages os ON os.id = b.origin_stage_id
       JOIN destinations d ON d.id = b.destination_id
       WHERE tk.id = ?`,
      [ticketId]
    );
    if (!row) return;
    await toSession(row.session_id, {
      type: 'boarding_confirmation',
      title: "You're boarded",
      message: `Seat ${row.seat_number} on ${row.origin} → ${row.destination} was checked in. Have a safe trip!`,
      actionUrl: `/bookings/${row.booking_reference}/ticket`,
      actionLabel: 'View ticket',
      dedupeKey: `boarded:${ticketId}`,
    });
  });
}

// ---- group quotations --------------------------------------------------

function onGroupQuotationSubmitted({ request, quotation, organizationName, isUpdate }) {
  return safely('onGroupQuotationSubmitted', () =>
    toSession(request.session_id, {
      type: 'group_quotation_update',
      title: isUpdate ? 'Quotation updated' : 'New quotation',
      message: `${organizationName} ${isUpdate ? 'updated their quotation to' : 'quoted'} ${kes(quotation.price_kes)} for your request ${request.request_reference}.`,
      actionUrl: `/group-trips/${request.request_reference}`,
      actionLabel: 'Compare quotations',
      dedupeKey: `gq:${quotation.id}:${Number(quotation.price_kes)}`,
    })
  );
}

function onGroupQuotationWithdrawn({ request, quotation, organizationName }) {
  return safely('onGroupQuotationWithdrawn', () =>
    toSession(request.session_id, {
      type: 'group_quotation_update',
      title: 'Quotation withdrawn',
      message: `${organizationName} withdrew their quotation for request ${request.request_reference}.`,
      actionUrl: `/group-trips/${request.request_reference}`,
      actionLabel: 'View request',
      dedupeKey: `gq:${quotation.id}:withdrawn`,
    })
  );
}

function onGroupQuotationDeclined({ request, quotation }) {
  return safely('onGroupQuotationDeclined', () =>
    toOrganizationOperators(quotation.organization_id, {
      type: 'group_quotation_update',
      title: 'Quotation declined',
      message: `Your quotation on request ${request.request_reference} was declined by the requester.`,
      actionUrl: `/operator/group-trips/${request.id}`,
      actionLabel: 'View request',
      dedupeKey: `gq:${quotation.id}:rejected`,
    })
  );
}

/** Winner is told it was accepted; every other pending bidder is told it wasn't selected. */
function onGroupQuotationAccepted({ requestId, acceptedQuotationId }) {
  return safely('onGroupQuotationAccepted', async () => {
    const [rows] = await pool.query(
      `SELECT gq.id, gq.organization_id, gq.status, gr.request_reference, gr.id AS request_id
       FROM group_quotations gq JOIN group_requests gr ON gr.id = gq.group_request_id
       WHERE gq.group_request_id = ? AND gq.status IN ('accepted', 'rejected')`,
      [requestId]
    );

    for (const q of rows) {
      const won = q.id === acceptedQuotationId;
      await toOrganizationOperators(q.organization_id, {
        type: 'group_quotation_update',
        title: won ? 'Quotation accepted' : 'Quotation not selected',
        message: won
          ? `Your quotation on request ${q.request_reference} was accepted. The requester now has 15 minutes to pay.`
          : `Another operator was selected for request ${q.request_reference}.`,
        actionUrl: `/operator/group-trips/${q.request_id}`,
        actionLabel: 'View request',
        dedupeKey: `gq:${q.id}:${won ? 'accepted' : 'rejected'}`,
      });
    }
  });
}

module.exports = {
  onPaymentResult,
  onHoldsExpired,
  onTripUpdated,
  runUpcomingDepartureSweep,
  onBoarded,
  onGroupQuotationSubmitted,
  onGroupQuotationWithdrawn,
  onGroupQuotationDeclined,
  onGroupQuotationAccepted,
};
