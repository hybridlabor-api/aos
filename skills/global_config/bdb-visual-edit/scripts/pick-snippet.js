// READ-ONLY snippet for chrome-devtools evaluate. Replace X and Y with the
// click coordinates (numbers) before sending. No network, no mutation, no
// text or input values: tag, class names, a source attribute and geometry only.
(() => {
  const el = document.elementFromPoint(X, Y);
  if (!el) return null;
  const nth = (node) => {
    let n = 1;
    for (let s = node.previousElementSibling; s; s = s.previousElementSibling) {
      if (s.tagName === node.tagName) n += 1;
    }
    return n;
  };
  const parts = [];
  for (let node = el; node && node !== document.body && node !== document.documentElement && parts.length < 12; node = node.parentElement) {
    parts.unshift(node.tagName.toLowerCase() + ':nth-of-type(' + nth(node) + ')');
  }
  const src = el.closest('[data-aos-src]');
  const r = el.getBoundingClientRect();
  return {
    tag: el.tagName.toLowerCase(),
    classes: Array.from(el.classList).slice(0, 12),
    srcLoc: src ? src.getAttribute('data-aos-src') : null,
    selector: parts.join(' > '),
    bbox: { x: r.x, y: r.y, width: r.width, height: r.height },
  };
})()
