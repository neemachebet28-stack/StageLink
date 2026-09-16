// ==================================================
// StageLink — booking summary page behavior
// ==================================================
// Just a clear loading state on submit and a disabled double-click
// guard — the actual validation and seat-locking all happens
// server-side in routes/booking.js, which is what any of this result
// depends on, not this script.
(function () {
  const form = document.querySelector('[data-checkout-form]');
  if (!form) return;

  form.addEventListener('submit', function () {
    const button = form.querySelector('[data-submit-button]');
    if (!button) return;
    button.disabled = true;
    button.textContent = 'Confirming your booking…';
  });
})();
