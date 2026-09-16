// ==================================================
// StageLink — notification component behavior
// ==================================================
// Progressive enhancement: every action here also works as a plain
// form post / link without JavaScript. This script only keeps the
// unread badge current and avoids full page reloads for read actions.
(function () {
  var badges = document.querySelectorAll('[data-notif-count]');

  function renderCount(count) {
    badges.forEach(function (el) {
      el.textContent = count > 99 ? '99+' : String(count);
      el.hidden = count === 0;
    });
    document.querySelectorAll('[data-notif-bell]').forEach(function (bell) {
      bell.setAttribute(
        'aria-label',
        count === 0 ? 'Notifications' : 'Notifications, ' + count + ' unread'
      );
    });
  }

  function refreshCount() {
    if (badges.length === 0) return Promise.resolve();
    return fetch('/api/notifications/unread-count', { headers: { Accept: 'application/json' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) { if (data) renderCount(data.count); })
      .catch(function () { /* transient — keep the last known count */ });
  }

  refreshCount();

  // Poll gently, and only while the tab is actually visible.
  setInterval(function () {
    if (document.visibilityState === 'visible') refreshCount();
  }, 60000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') refreshCount();
  });

  function markItemRead(item) {
    item.classList.remove('is-unread');
    var pill = item.querySelector('[data-notif-new]');
    if (pill) pill.remove();
    var form = item.querySelector('[data-notif-mark-read]');
    if (form) form.remove();
  }

  document.querySelectorAll('[data-notif-mark-read]').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var item = form.closest('[data-notif-item]');
      fetch(form.action, { method: 'POST', headers: { Accept: 'application/json' } })
        .then(function (res) {
          if (!res.ok) throw new Error('failed');
          if (item) markItemRead(item);
          return refreshCount();
        })
        .catch(function () { form.submit(); });
    });
  });

  var readAll = document.querySelector('[data-notif-read-all]');
  if (readAll) {
    readAll.addEventListener('submit', function (event) {
      event.preventDefault();
      fetch(readAll.action, { method: 'POST', headers: { Accept: 'application/json' } })
        .then(function (res) {
          if (!res.ok) throw new Error('failed');
          document.querySelectorAll('[data-notif-item].is-unread').forEach(markItemRead);
          readAll.remove();
          return refreshCount();
        })
        .catch(function () { readAll.submit(); });
    });
  }
})();
