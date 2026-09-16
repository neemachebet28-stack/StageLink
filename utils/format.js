// ==================================================
// StageLink — shared formatting helpers
// ==================================================
// Attached to res.locals (see server.js) so every EJS view can call
// these directly without each route passing them in.

/**
 * Formats a DATETIME value (mysql2 with dateStrings:true returns
 * "YYYY-MM-DD HH:MM:SS") as a short, human-readable time — e.g.
 * "Today, 14:30" or "Fri, 14:30". Returns null for a null input so
 * views can decide how to render "not available" themselves.
 */
function formatDateTime(value) {
  if (!value) return null;

  const date = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return null;

  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  const time = date.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false });

  if (isToday) return `Today, ${time}`;
  if (isTomorrow) return `Tomorrow, ${time}`;

  const day = date.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day}, ${time}`;
}

/**
 * "5 min ago" style relative time for notification timestamps. The
 * absolute time is always available too (rendered as a title
 * attribute), so relative wording never hides the real timestamp.
 */
function timeAgo(value) {
  if (!value) return '';
  const date = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return '';

  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return formatDateTime(value);
}

module.exports = { formatDateTime, timeAgo };
