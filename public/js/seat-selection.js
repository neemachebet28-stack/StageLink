// ==================================================
// StageLink — seat selection behavior
// ==================================================
// Every click is a real request to the server, which re-validates the
// seat before responding — nothing here assumes a click succeeds
// until the server says so. On any conflict (seat taken, trip no
// longer bookable, etc.) the page reloads to resync with the server's
// current truth rather than trying to patch client state that may
// already be stale.
(function () {
  const panel = document.querySelector('[data-seat-map]');
  if (!panel) return;

  const tripId = panel.dataset.tripId;
  const statusEl = panel.querySelector('[data-selection-status]');
  const timerWrap = panel.querySelector('[data-hold-timer-wrap]');
  const timerEl = panel.querySelector('[data-hold-timer]');

  // seatId -> expiresAt (ms epoch), for the countdown display.
  const myHolds = new Map();
  let timerInterval = null;

  panel.querySelectorAll('.seat-button[data-held-by-you="true"]').forEach(function (btn) {
    // Server didn't tell us the exact expiry on page load beyond what's
    // rendered; treat existing holds conservatively so the countdown
    // never overstates the time left.
    myHolds.set(btn.dataset.seatId, Date.now() + 30 * 1000);
  });

  function setStatus(message, tone) {
    statusEl.textContent = message || '';
    if (tone) {
      statusEl.setAttribute('data-tone', tone);
    } else {
      statusEl.removeAttribute('data-tone');
    }
  }

  function startTimer() {
    if (timerInterval) return;
    timerWrap.hidden = false;

    timerInterval = setInterval(function () {
      if (myHolds.size === 0) {
        clearInterval(timerInterval);
        timerInterval = null;
        timerWrap.hidden = true;
        return;
      }

      const soonest = Math.min(...Array.from(myHolds.values()));
      const remainingMs = soonest - Date.now();

      if (remainingMs <= 0) {
        setStatus('Your seat hold expired. Refreshing…', 'error');
        window.location.reload();
        return;
      }

      const totalSeconds = Math.floor(remainingMs / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      timerEl.textContent = minutes + ':' + String(seconds).padStart(2, '0');
    }, 1000);
  }

  panel.addEventListener('click', function (event) {
    const button = event.target.closest('.seat-button');
    if (!button || button.disabled) return;

    const seatId = button.dataset.seatId;
    const heldByYou = button.dataset.heldByYou === 'true';
    const action = heldByYou ? 'release' : 'hold';

    button.disabled = true;
    setStatus(action === 'hold' ? 'Holding seat…' : 'Releasing seat…', null);

    fetch('/trips/' + tripId + '/seats/' + seatId + '/' + action, { method: 'POST' })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data };
        });
      })
      .then(function (result) {
        if (!result.ok || !result.data.success) {
          setStatus(result.data.message || 'That seat is no longer available.', 'error');
          setTimeout(function () {
            window.location.reload();
          }, 1200);
          return;
        }

        if (action === 'hold') {
          button.dataset.heldByYou = 'true';
          button.dataset.seatStatus = 'held';
          button.disabled = false;
          myHolds.set(seatId, new Date(result.data.expiresAt).getTime());
          setStatus('Seat held for ' + result.data.ttlMinutes + ' minutes.', 'success');
          startTimer();
        } else {
          button.dataset.heldByYou = 'false';
          button.dataset.seatStatus = 'available';
          button.disabled = false;
          myHolds.delete(seatId);
          setStatus('Seat released.', null);
        }
      })
      .catch(function () {
        setStatus('Something went wrong. Please try again.', 'error');
        button.disabled = false;
      });
  });

  if (myHolds.size > 0) {
    startTimer();
  }
})();
