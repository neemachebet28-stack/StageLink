// ==================================================
// StageLink — shared site behavior
// ==================================================
// Phase 1 scope: mobile navigation toggle only. booking.js, seats.js,
// payment.js, map.js and notifications.js are introduced in the
// phases that build those features.
// ==================================================

(function () {
  const header = document.querySelector('[data-site-header]');
  const toggle = document.querySelector('[data-nav-toggle]');

  if (!header || !toggle) return;

  toggle.addEventListener('click', function () {
    const isOpen = header.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(isOpen));
  });

  // Close the mobile panel after choosing a link, so returning to the
  // page later doesn't leave it stuck open.
  header.querySelectorAll('.nav-mobile-panel a').forEach(function (link) {
    link.addEventListener('click', function () {
      header.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });
})();
