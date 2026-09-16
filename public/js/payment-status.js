// ==================================================
// StageLink — payment status polling
// ==================================================
// Polls the server's own record of the payment, which only ever
// changes from a verified Daraja callback (real or sandbox-simulated
// — see routes/payments.js and models/payments.js). This script never
// decides a payment succeeded; it only reflects what the server has
// already confirmed.
(function () {
  const panel = document.querySelector('[data-payment-panel]');
  if (!panel || panel.dataset.status !== 'processing') return;

  const reference = panel.dataset.reference;
  const pollStatusEl = panel.querySelector('[data-poll-status]');

  let attempts = 0;
  const maxAttempts = 40; // ~2 minutes at 3s intervals

  const interval = setInterval(function () {
    attempts += 1;

    fetch('/bookings/' + reference + '/payment-status')
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (data.paymentStatus === 'success') {
          clearInterval(interval);
          if (pollStatusEl) pollStatusEl.textContent = 'Payment confirmed — refreshing…';
          window.location.reload();
          return;
        }
        if (data.paymentStatus === 'failed' || data.paymentStatus === 'cancelled') {
          clearInterval(interval);
          if (pollStatusEl) pollStatusEl.textContent = 'Payment ' + data.paymentStatus + ' — refreshing…';
          window.location.reload();
          return;
        }
        if (pollStatusEl) {
          pollStatusEl.textContent = 'Still checking for confirmation… (' + attempts + ')';
        }
      })
      .catch(function () {
        // Transient network issue — keep polling silently rather than
        // alarming the passenger over a single missed check.
      });

    if (attempts >= maxAttempts) {
      clearInterval(interval);
      if (pollStatusEl) {
        pollStatusEl.textContent = "This is taking longer than expected. Refresh the page to check again.";
      }
    }
  }, 3000);
})();
