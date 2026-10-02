'use strict';

// Pure helpers. Each function is inlined into the browser bundle with
// fn.toString(), so bodies may only reference each other and the arguments.

function roundPoint(p) {
  return [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4];
}

function clampPoint(p) {
  const c = v => (Number.isFinite(v) ? Math.min(5, Math.max(-4, v)) : 0);
  return [c(p[0]), c(p[1])];
}

function rawUnits(pt, box) {
  const w = box.width > 0 ? box.width : 1;
  const h = box.height > 0 ? box.height : 1;
  return [(pt[0] - box.left) / w, (pt[1] - box.top) / h];
}

function toAnchorUnits(pt, box) {
  return roundPoint(clampPoint(rawUnits(pt, box)));
}

function fromAnchorUnits(pt, box) {
  const w = box.width > 0 ? box.width : 1;
  const h = box.height > 0 ? box.height : 1;
  return [box.left + pt[0] * w, box.top + pt[1] * h];
}

function fitsAnchor(pagePoints, box) {
  return pagePoints.every(pt => {
    const u = rawUnits(pt, box);
    return u[0] >= -4 && u[0] <= 5 && u[1] >= -4 && u[1] <= 5;
  });
}

function rdp(points, eps) {
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1;
    let dist = 0;
    const dx = points[b][0] - points[a][0];
    const dy = points[b][1] - points[a][1];
    const len = Math.hypot(dx, dy);
    for (let i = a + 1; i < b; i++) {
      const d = len === 0
        ? Math.hypot(points[i][0] - points[a][0], points[i][1] - points[a][1])
        : Math.abs(dy * points[i][0] - dx * points[i][1] + points[b][0] * points[a][1] - points[b][1] * points[a][0]) / len;
      if (d > dist) { dist = d; worst = i; }
    }
    if (worst !== -1 && dist > eps) {
      keep[worst] = true;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function simplify(points, eps = 0.002, max = 512) {
  if (!Array.isArray(points) || points.length < 3) return Array.isArray(points) ? points.slice() : [];
  const limit = Math.max(2, max);
  let e = eps > 0 ? eps : 0.002;
  let out = rdp(points, e);
  for (let i = 0; out.length > limit && i < 64; i++) {
    e *= 2;
    out = rdp(points, e);
  }
  return out;
}

module.exports = { roundPoint, clampPoint, rawUnits, toAnchorUnits, fromAnchorUnits, fitsAnchor, rdp, simplify };
