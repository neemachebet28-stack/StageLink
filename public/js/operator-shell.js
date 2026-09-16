// ==================================================
// StageLink — operator app shell (mobile sidebar toggle)
// ==================================================
(function () {
  const sidebar = document.querySelector('[data-op-sidebar]');
  const backdrop = document.querySelector('[data-op-sidebar-backdrop]');
  const toggle = document.querySelector('[data-op-sidebar-toggle]');
  if (!sidebar || !backdrop || !toggle) return;

  function open() {
    sidebar.classList.add('is-open');
    backdrop.classList.add('is-open');
    backdrop.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
  }

  function close() {
    sidebar.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    backdrop.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  }

  toggle.addEventListener('click', function () {
    sidebar.classList.contains('is-open') ? close() : open();
  });
  backdrop.addEventListener('click', close);
  sidebar.querySelectorAll('a').forEach((link) => link.addEventListener('click', close));
})();
