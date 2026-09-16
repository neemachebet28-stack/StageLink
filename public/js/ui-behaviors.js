// ==================================================
// StageLink — small shared UI behaviours
// ==================================================
// These replace inline onclick/onsubmit/onchange handlers so the site
// can run under a strict Content-Security-Policy (script-src 'self').
// Markup opts in with data attributes:
//   <form data-confirm="Are you sure?">   confirm before submitting
//   <select data-auto-submit>             submit the form on change
//   <button data-print>                   open the print dialog
(function () {
  document.addEventListener('submit', function (event) {
    var form = event.target.closest && event.target.closest('form[data-confirm]');
    if (form && !window.confirm(form.getAttribute('data-confirm'))) event.preventDefault();
  });

  document.addEventListener('change', function (event) {
    var el = event.target.closest && event.target.closest('[data-auto-submit]');
    if (el && el.form) el.form.submit();
  });

  document.addEventListener('click', function (event) {
    if (event.target.closest && event.target.closest('[data-print]')) window.print();
  });

  // CSRF token for fetch() calls, from the <meta> tag the server injects.
  window.stagelinkCsrfToken = function () {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  };
})();
