// ==================================================
// StageLink — passenger discovery behavior
// ==================================================
// Two independent features, both progressive enhancement over
// server-rendered pages that already work without JS:
//   1. "Stages near me" — browser geolocation + /api/stages/nearby
//   2. Live search suggestions on the discover page — /api/search
// ==================================================

(function () {
  // --------------------------------------------------
  // Nearby stages
  // --------------------------------------------------
  const nearbyPanel = document.querySelector('[data-nearby-panel]');

  if (nearbyPanel) {
    const button = nearbyPanel.querySelector('[data-nearby-trigger]');
    const statusEl = nearbyPanel.querySelector('[data-nearby-status]');
    const resultsEl = nearbyPanel.querySelector('[data-nearby-results]');

    button.addEventListener('click', function () {
      if (!('geolocation' in navigator)) {
        statusEl.textContent =
          "Your browser doesn't support location lookup. Try searching by county or town instead.";
        return;
      }

      statusEl.textContent = 'Finding your location…';
      resultsEl.innerHTML = '';
      button.disabled = true;

      navigator.geolocation.getCurrentPosition(
        function (position) {
          const { latitude, longitude } = position.coords;
          fetchNearby(latitude, longitude);
        },
        function () {
          statusEl.textContent =
            "We couldn't access your location. You can allow location access and try again, or search by county or town instead.";
          button.disabled = false;
        },
        { enableHighAccuracy: false, timeout: 8000 }
      );
    });

    function fetchNearby(latitude, longitude) {
      const params = new URLSearchParams({ lat: latitude, lng: longitude });

      fetch('/api/stages/nearby?' + params.toString())
        .then(function (res) {
          if (!res.ok) throw new Error('Request failed');
          return res.json();
        })
        .then(function (data) {
          button.disabled = false;
          renderNearbyResults(data.stages || []);
        })
        .catch(function () {
          button.disabled = false;
          statusEl.textContent = 'Something went wrong finding nearby stages. Please try again.';
        });
    }

    function renderNearbyResults(stages) {
      if (stages.length === 0) {
        statusEl.textContent = "No stages found within 15km. Try browsing by county instead.";
        resultsEl.innerHTML = '';
        return;
      }

      statusEl.textContent = `${stages.length} stage${stages.length === 1 ? '' : 's'} found near you.`;
      resultsEl.innerHTML = stages
        .map(function (stage) {
          const distance = stage.distance_km ? Number(stage.distance_km).toFixed(1) : null;
          return (
            '<a class="list-row" href="/stages/' +
            stage.id +
            '">' +
            '<div><div class="list-row-title">' +
            escapeHtml(stage.name) +
            '</div><div class="list-row-meta">' +
            escapeHtml(stage.town_name) +
            ', ' +
            escapeHtml(stage.county_name) +
            '</div></div>' +
            (distance ? '<div class="list-row-action">' + distance + ' km</div>' : '') +
            '</a>'
          );
        })
        .join('');
    }
  }

  // --------------------------------------------------
  // Live search suggestions
  // --------------------------------------------------
  const searchInput = document.querySelector('[data-live-search]');
  const suggestionsEl = document.querySelector('[data-search-suggestions]');
  let debounceTimer = null;

  if (searchInput && suggestionsEl) {
    searchInput.addEventListener('input', function () {
      const query = searchInput.value.trim();

      clearTimeout(debounceTimer);

      if (query.length < 2) {
        suggestionsEl.innerHTML = '';
        suggestionsEl.hidden = true;
        return;
      }

      debounceTimer = setTimeout(function () {
        fetch('/api/search?' + new URLSearchParams({ q: query }).toString())
          .then(function (res) {
            return res.json();
          })
          .then(function (data) {
            renderSuggestions(data.stages || []);
          })
          .catch(function () {
            suggestionsEl.innerHTML = '';
            suggestionsEl.hidden = true;
          });
      }, 250);
    });

    document.addEventListener('click', function (event) {
      if (!suggestionsEl.contains(event.target) && event.target !== searchInput) {
        suggestionsEl.hidden = true;
      }
    });

    function renderSuggestions(stages) {
      if (stages.length === 0) {
        suggestionsEl.innerHTML = '<div class="empty-state">No stages match that search.</div>';
        suggestionsEl.hidden = false;
        return;
      }

      suggestionsEl.innerHTML = stages
        .map(function (stage) {
          return (
            '<a class="list-row" href="/stages/' +
            stage.id +
            '">' +
            '<div><div class="list-row-title">' +
            escapeHtml(stage.name) +
            '</div><div class="list-row-meta">' +
            escapeHtml(stage.town_name) +
            ', ' +
            escapeHtml(stage.county_name) +
            '</div></div>' +
            '</a>'
          );
        })
        .join('');
      suggestionsEl.hidden = false;
    }
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }
})();
