// ==================================================
// StageLink — input validation helpers
// ==================================================
// Every helper treats anything that isn't a plain string/number as
// invalid. That matters: a repeated or bracketed form field
// (email=a&email=b, password[]=x) arrives as an array, and code that
// calls .trim() on it throws — a 500 an attacker can trigger at will.
function text(value, max = 255) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function positiveInt(value, { min = 1, max = 2147483647 } = {}) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value).trim();
  if (!/^\d{1,10}$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
}

/** Non-negative amount with at most 2 decimals, bounded. */
function money(value, { min = 0, max = 10000000 } = {}) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value).trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
}

/** Returns the phone with spaces/dashes removed, or null if it isn't plausible. */
function phone(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim().replace(/[\s-]/g, '');
  return /^\+?\d{9,15}$/.test(s) ? s : null;
}

function email(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

/** YYYY-MM-DD that is a real calendar date. */
function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
}

/** datetime-local / MySQL style, returned as 'YYYY-MM-DD HH:MM:SS'. */
function dateTime(value) {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m || !dateOnly(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59) return null;
  return `${m[1]} ${m[2]}:${m[3]}:${m[4] || '00'}`;
}

/** Only http(s) URLs — blocks javascript:/data: values being stored and later rendered. */
function httpUrl(value, max = 500) {
  if (typeof value !== 'string' || value.length > max) return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch (e) {
    return null;
  }
}

function maskPhone(value) {
  if (!value || value.length < 6) return value;
  return value.slice(0, 5) + '****' + value.slice(-2);
}

module.exports = { text, positiveInt, money, phone, email, dateOnly, dateTime, httpUrl, maskPhone };
