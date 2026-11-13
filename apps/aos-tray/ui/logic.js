// Pure view logic: data from the Rust commands in, plain values out. No DOM here, so
// test/logic.test.mjs runs it under `node --test`.

/** 'up' | 'down' | 'unknown' for one entry of `aos services status --json`. */
export function serviceState(s) {
  if (s && s.up === true) return 'up';
  if (s && s.up === false) return 'down';
  return 'unknown';
}

export function servicesSummary(services = []) {
  const up = services.filter((s) => serviceState(s) === 'up').length;
  const down = services.filter((s) => serviceState(s) === 'down').map((s) => s.id);
  const tone = down.length ? 'bad' : services.length && up === services.length ? 'ok' : 'warn';
  return { up, total: services.length, down, tone };
}

/** Counts of `aos doctor --json` results. Warning-only failures are warnings, not failures. */
export function doctorSummary(d) {
  const results = (d && d.results) || [];
  const fail = results.filter((r) => !r.ok && !r.warningOnly).length;
  const warn = results.filter((r) => !r.ok && r.warningOnly).length;
  return { total: results.length, fail, warn, tone: fail ? 'bad' : warn ? 'warn' : 'ok' };
}

/** Doctor details may be strings or JSON values. */
export function detailText(x) {
  if (x === null || x === undefined || x === '') return '';
  return typeof x === 'string' ? x : JSON.stringify(x);
}

/** State key of a gateway upstream; null = not selected. */
export function upstreamState(u) {
  if (!u) return 'notSelected';
  if (u.ok) return 'ok';
  if (u.busy) return 'starting';
  if (u.degraded) return 'degraded';
  return 'failing';
}

/** Upstreams the gateway knows plus the shipped servers that can be added, sorted. */
export function upstreamRows(status, known = []) {
  const selected = new Map(((status && status.upstreams) || []).map((u) => [u.name, u]));
  const names = [...new Set([...selected.keys(), ...known])].sort();
  return names.map((name) => ({ name, upstream: selected.get(name) || null, state: upstreamState(selected.get(name)), changeable: known.includes(name) }));
}

/** The typed confirm: exactly the id, surrounding spaces ignored (Rust checks the same). */
export function restartConfirmed(typed, id) {
  return typeof typed === 'string' && typeof id === 'string' && id.length > 0 && typed.trim() === id;
}

/** Git badge for one project: { key, n, tone }. */
export function gitBadge(p) {
  if (!p.is_git) return { key: 'projects.notGit', tone: 'muted' };
  if (p.changes === null || p.changes === undefined) return { key: 'projects.gitUnknown', tone: 'warn' };
  if (p.changes === 0) return { key: 'projects.clean', tone: 'ok' };
  return { key: 'projects.changes', n: p.changes, tone: 'warn' };
}

/** Display name of a project: project.json name, else the folder. */
export function projectName(p) {
  return (p.meta && p.meta.name) || p.dir;
}

/** Secrets list shows names and a set/empty flag only; this drops anything else defensively. */
export function secretRows(list = []) {
  return list.map((s) => ({ name: String(s.name), set: Boolean(s.has_value) }));
}

export const SCREENS = ['home', 'store', 'services', 'router', 'projects', 'secrets', 'settings'];

/** Router editor: add a target at the end of the list, or remove it when already present. */
export function toggleTarget(list, name) {
  return list.includes(name) ? list.filter((x) => x !== name) : [...list, name];
}

/** Router editor: move one target up (delta -1) or down (+1); out-of-range moves are no-ops. */
export function moveTarget(list, name, delta) {
  const i = list.indexOf(name);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return list.slice();
  const out = list.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Router editor: rows for the role table, with the layer each preference comes from. */
export function routerRows(view) {
  if (!view || !Array.isArray(view.roles)) return [];
  return view.roles.map((role) => ({
    role,
    targets: (view.preferences && view.preferences[role]) || [],
    source: (view.sources && view.sources[role]) || 'shipped',
  }));
}

/** Screen from a location hash like '#services'; unknown -> 'home'. */
export function screenFromHash(hash) {
  const id = String(hash || '').replace(/^#/, '');
  return SCREENS.includes(id) ? id : 'home';
}
