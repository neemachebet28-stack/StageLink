// ==================================================
// StageLink — M-Pesa Daraja integration
// ==================================================
// ============================================================
// WHERE REAL CREDENTIALS GO
// ============================================================
// This module talks to Safaricom's Daraja API using five environment
// variables (see .env.example — none are set in this dev environment,
// which is exactly what puts this module into sandbox-simulation mode):
//
//   MPESA_CONSUMER_KEY     — Daraja app "Consumer Key"
//   MPESA_CONSUMER_SECRET  — Daraja app "Consumer Secret"
//   MPESA_SHORTCODE        — your Paybill/Till (BusinessShortCode)
//   MPESA_PASSKEY           — the Lipa Na M-Pesa Online passkey for that shortcode
//   MPESA_CALLBACK_URL     — a real, internet-reachable HTTPS URL that routes to
//                             POST /mpesa/callback on this server (Safaricom must
//                             be able to reach it — ngrok or similar in dev,
//                             your real domain in production)
//
// Get the first four from https://developer.safaricom.co.ke (create an app
// under a Daraja account; the passkey and shortcode come from the Lipa Na
// M-Pesa Online product once approved for production, or from the sandbox
// test credentials Safaricom publishes for development). Optionally set
// MPESA_ENV=production once you have live (non-sandbox) credentials — it
// defaults to "sandbox" otherwise, which points at
// https://sandbox.safaricom.co.ke instead of the production host.
//
// Nothing in this file or anywhere else in the app ever logs, renders, or
// sends these values to the browser — they are read from process.env only,
// at request time, server-side.
// ============================================================

const isConfigured = Boolean(
  process.env.MPESA_CONSUMER_KEY &&
    process.env.MPESA_CONSUMER_SECRET &&
    process.env.MPESA_SHORTCODE &&
    process.env.MPESA_PASSKEY
);

const BASE_URL =
  process.env.MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

async function getAccessToken() {
  const credentials = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString('base64');

  const response = await fetch(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  });

  if (!response.ok) {
    throw new Error(`Daraja OAuth failed: ${response.status}`);
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Real Daraja STK push. Only called when isConfigured is true.
 */
async function realInitiateStkPush({ phoneNumber, amount, accountReference, transactionDesc }) {
  const accessToken = await getAccessToken();
  const ts = timestamp();
  const password = Buffer.from(
    `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${ts}`
  ).toString('base64');

  const response = await fetch(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: ts,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: phoneNumber,
      PartyB: process.env.MPESA_SHORTCODE,
      PhoneNumber: phoneNumber,
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: accountReference,
      TransactionDesc: transactionDesc,
    }),
  });

  const data = await response.json();

  if (!response.ok || data.ResponseCode !== '0') {
    throw new Error(data.errorMessage || data.ResponseDescription || 'STK push request failed');
  }

  return {
    merchantRequestId: data.MerchantRequestID,
    checkoutRequestId: data.CheckoutRequestID,
  };
}

// ============================================================
// SANDBOX SIMULATOR (used automatically — see isConfigured above)
// ============================================================
// Mimics Daraja's real shape (synchronous STK-push acceptance, async
// callback) without any network calls, so the full payment state
// machine — PENDING → PROCESSING → SUCCESS/FAILED/CANCELLED →
// booking CONFIRMED — is testable with no credentials at all.
//
// Outcome is controllable by the test phone number's last two digits,
// so every branch of the state machine can be exercised on demand:
//   ends in "00" → simulated FAILED (e.g. insufficient funds)
//   ends in "11" → simulated CANCELLED (customer declined on their phone)
//   anything else → simulated SUCCESS
// The delay before the simulated callback fires (2–5s) mimics the real
// gap between STK push and the customer entering their PIN.
function simulateOutcome(phoneNumber) {
  if (phoneNumber.endsWith('00')) return { resultCode: 1, resultDesc: 'Insufficient funds in the account.' };
  if (phoneNumber.endsWith('11')) return { resultCode: 1032, resultDesc: 'Request cancelled by user.' };
  return { resultCode: 0, resultDesc: 'The service request is processed successfully.' };
}

function randomId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

/**
 * @param {(payload: object) => Promise<void>} onSimulatedCallback
 *   Called after the simulated delay with a Daraja-shaped callback
 *   payload — the caller (routes/payments.js) feeds this straight
 *   into the same processCallback() the real webhook uses, so the
 *   processing path is identical whether the callback is real or
 *   simulated.
 */
async function sandboxInitiateStkPush({ phoneNumber, amount, accountReference }, onSimulatedCallback) {
  const merchantRequestId = randomId('sandbox-merchant');
  const checkoutRequestId = randomId('sandbox-checkout');

  const delayMs = 2000 + Math.random() * 3000;
  setTimeout(() => {
    const { resultCode, resultDesc } = simulateOutcome(phoneNumber);
    const mpesaReceiptNumber =
      resultCode === 0 ? 'S' + Math.random().toString(36).slice(2, 10).toUpperCase() : null;

    onSimulatedCallback({
      merchantRequestId,
      checkoutRequestId,
      resultCode,
      resultDesc,
      amount,
      mpesaReceiptNumber,
      phoneNumber,
    }).catch((error) => {
      console.error('[mpesa-sandbox] simulated callback processing failed:', error.message);
    });
  }, delayMs);

  return { merchantRequestId, checkoutRequestId };
}

module.exports = {
  isConfigured,
  realInitiateStkPush,
  sandboxInitiateStkPush,
};
