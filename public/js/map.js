// ==================================================
// StageLink — map integration layer
// ==================================================
// This module is the seam between StageLink's UI and whichever real
// map provider gets configured later (Google Maps, Mapbox, OSM tiles,
// etc.). Nothing else in the app should assume a specific provider —
// views call window.StageLinkMap, not a provider SDK directly.
//
// No provider is configured yet, so render() draws an honest static
// placeholder rather than pretending to show a live map. When a
// provider is added, only the body of render() needs to change; the
// call sites in stage.ejs stay the same.
// ==================================================

(function () {
  /**
   * Renders a placeholder map panel into `container`.
   * @param {HTMLElement} container
   * @param {{ latitude: number|null, longitude: number|null, label: string }} point
   */
  function render(container, point) {
    if (!container) return;

    const hasCoordinates =
      point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude);

    if (!hasCoordinates) {
      container.innerHTML =
        '<div class="empty-state">Location coordinates aren\'t available for this stage yet.</div>';
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'map-placeholder';
    wrapper.setAttribute('role', 'img');
    wrapper.setAttribute(
      'aria-label',
      `Map preview placeholder for ${point.label || 'this stage'}. Live map provider not yet connected.`
    );

    const pin = document.createElement('div');
    pin.className = 'map-placeholder-pin';
    pin.innerHTML =
      '<span class="map-placeholder-dot" aria-hidden="true" style="width:16px;height:16px;border-radius:50%;background:var(--color-primary);border:3px solid #fff;box-shadow:0 2px 10px rgba(16,35,28,.3);"></span>' +
      '<span class="map-placeholder-label">Map preview — provider not yet connected</span>';

    wrapper.appendChild(pin);
    container.innerHTML = '';
    container.appendChild(wrapper);
  }

  /**
   * Builds a real, working directions deep link (Google Maps web) for
   * a given travel mode. This is a genuine external link, not a
   * simulated one — it just doesn't render tiles inside StageLink
   * itself until a map provider is configured.
   * @param {number} latitude
   * @param {number} longitude
   * @param {'walking'|'bicycling'|'driving'} mode
   */
  function directionsUrl(latitude, longitude, mode) {
    const params = new URLSearchParams({
      api: '1',
      destination: `${latitude},${longitude}`,
      travelmode: mode,
    });
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }

  window.StageLinkMap = { render, directionsUrl };
})();
