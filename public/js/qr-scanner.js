// ==================================================
// StageLink — QR camera scanning (progressive enhancement)
// ==================================================
// Manual code entry (the plain form) always works and is the primary,
// always-testable path. This script only adds camera auto-scanning on
// top of it, using the browser's native BarcodeDetector API where
// available (Chrome/Edge/Android). Browsers without it (Safari,
// Firefox as of this writing) simply keep the manual field — no
// external QR library, no broken experience either way.
(function () {
  const wrap = document.querySelector('[data-camera-wrap]');
  const video = document.querySelector('[data-camera-video]');
  const hint = document.querySelector('[data-camera-hint]');
  const tokenInput = document.getElementById('token');
  const form = document.querySelector('[data-verify-form]');

  if (!wrap || !video || !tokenInput || !form) return;

  if (!('BarcodeDetector' in window)) {
    if (hint) hint.textContent = 'Camera scanning is not supported on this device — enter the code manually.';
    return;
  }

  navigator.mediaDevices
    ?.getUserMedia({ video: { facingMode: 'environment' } })
    .then(function (stream) {
      wrap.hidden = false;
      video.srcObject = stream;
      video.play();
      if (hint) hint.textContent = 'Point the camera at the passenger\'s QR code.';

      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      let scanning = true;

      const scanLoop = function () {
        if (!scanning) return;
        detector
          .detect(video)
          .then(function (codes) {
            if (codes.length > 0 && scanning) {
              scanning = false;
              tokenInput.value = codes[0].rawValue;
              stream.getTracks().forEach((track) => track.stop());
              form.submit();
              return;
            }
            requestAnimationFrame(scanLoop);
          })
          .catch(function () {
            requestAnimationFrame(scanLoop);
          });
      };

      requestAnimationFrame(scanLoop);
    })
    .catch(function () {
      if (hint) hint.textContent = 'Camera access was not granted — enter the code manually.';
    });
})();
