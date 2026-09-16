// ==================================================
// StageLink — stage detail page behavior
// ==================================================
// Reads the data attributes rendered by stage.ejs and hands them to
// the map integration layer (map.js). Kept separate from map.js so
// map.js stays a reusable, page-agnostic module.
(function () {
  const mapContainer = document.querySelector('[data-map-container]');

  if (mapContainer && window.StageLinkMap) {
    const lat = parseFloat(mapContainer.dataset.lat);
    const lng = parseFloat(mapContainer.dataset.lng);

    window.StageLinkMap.render(mapContainer, {
      latitude: Number.isFinite(lat) ? lat : null,
      longitude: Number.isFinite(lng) ? lng : null,
      label: mapContainer.dataset.label || '',
    });
  }

  const directions = document.querySelector('[data-directions]');

  if (directions && window.StageLinkMap) {
    const lat = parseFloat(directions.dataset.lat);
    const lng = parseFloat(directions.dataset.lng);

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      directions.querySelectorAll('a[data-mode]').forEach(function (link) {
        link.href = window.StageLinkMap.directionsUrl(lat, lng, link.dataset.mode);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      });
    }
  }
})();
