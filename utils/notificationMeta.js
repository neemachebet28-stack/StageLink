// ==================================================
// StageLink — notification type presentation
// ==================================================
// Tone is never conveyed by colour alone: every type also has a text
// label, shown on the notification itself.
const TYPE_META = {
  booking_confirmation: { label: 'Booking', tone: 'success' },
  payment_success: { label: 'Payment', tone: 'success' },
  payment_failure: { label: 'Payment', tone: 'error' },
  seat_hold_expiry: { label: 'Seat hold', tone: 'warning' },
  upcoming_departure: { label: 'Departure', tone: 'warning' },
  trip_status_change: { label: 'Trip update', tone: 'info' },
  confirmed_departure: { label: 'Departure', tone: 'success' },
  cancellation: { label: 'Cancelled', tone: 'error' },
  group_quotation_update: { label: 'Group trip', tone: 'info' },
  ticket_ready: { label: 'Ticket', tone: 'success' },
  boarding_confirmation: { label: 'Boarding', tone: 'success' },
};

function metaFor(type) {
  return TYPE_META[type] || { label: 'Update', tone: 'info' };
}

module.exports = { TYPE_META, metaFor };
