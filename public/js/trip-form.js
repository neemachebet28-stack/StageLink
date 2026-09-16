// Pre-fill the fare from the chosen route's base fare — the operator
// can still override it per trip.
(function () {
  var routeSelect = document.getElementById('routeId');
  var fareInput = document.getElementById('fareKes');
  if (!routeSelect || !fareInput) return;
  routeSelect.addEventListener('change', function () {
    var option = routeSelect.options[routeSelect.selectedIndex];
    var fare = option ? option.getAttribute('data-fare') : '';
    if (fare && !fareInput.value) fareInput.value = fare;
  });
})();
