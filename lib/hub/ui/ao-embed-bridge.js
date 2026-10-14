(function () {
  'use strict';
  if (typeof window === 'undefined' || window.parent === window) return;

  var meta = document.querySelector('meta[name="ao-embed-ancestors"]');
  var allowedOrigins = [];
  if (meta && meta.content) {
    allowedOrigins = meta.content.split(/[,\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  try {
    window.parent.postMessage({ type: 'ao.embed.hello', app: 'aos-hub', protocol: 1 }, '*');
  } catch (e) {}

  function clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
  }

  window.addEventListener('message', function (event) {
    if (!event || !event.data || event.data.type !== 'ao.embed.set-zoom') return;
    if (typeof event.data.zoom !== 'number' || isNaN(event.data.zoom)) return;
    if (!allowedOrigins.includes(event.origin)) return;

    var clamped = clamp(event.data.zoom, 0.5, 2);
    document.documentElement.style.zoom = String(clamped);
  });
})();
