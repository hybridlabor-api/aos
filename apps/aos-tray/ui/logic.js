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

export const SCREENS = ['home', 'store', 'services', 'router', 'awake', 'projects', 'secrets', 'settings'];

/** Home: gateway upstream counts. An upstream is failed when it has an error and is not ok. */
export function gatewayCounts(st) {
  const ups = (st && Array.isArray(st.upstreams)) ? st.upstreams : [];
  const failed = ups.filter((u) => !u.ok && u.error).length;
  const ok = ups.filter((u) => u.ok).length;
  return { running: Boolean(st && st.running), total: ups.length, ok, failed };
}

/** Home: tone for the go-gate mode word. `off` is shown as a warning because nothing is guarded. */
export function gogateTone(mode) {
  if (!mode) return 'muted';
  return mode === 'off' ? 'warn' : 'ok';
}

/** Library: filter and cap the catalog. `kind` is 'all' | 'skill' | 'agent'; `scope` 'all' | 'installed'. */
export function filterItems(items, { q = '', kind = 'all', scope = 'all', limit = 60 } = {}) {
  const needle = String(q).trim().toLowerCase();
  const hit = (it) => (kind === 'all' || it.kind === kind)
    && (scope === 'all' || it.installed)
    && (!needle || it.name.toLowerCase().includes(needle) || (it.description || '').toLowerCase().includes(needle) || (it.category || '').toLowerCase().includes(needle));
  const all = (items || []).filter(hit);
  return { rows: all.slice(0, limit), total: all.length };
}

/** Library: what a row can do. Core items ship with AOS and are never removed from here. */
export function itemActions(it) {
  if (it.problem) return { install: false, uninstall: false };
  if (it.core) return { install: false, uninstall: false };
  return { install: !it.installed, uninstall: it.installed };
}

/** Always on: label key, tone and remaining whole minutes (timer only) for the current mode. */
export function awakeStatus(view) {
  if (!view || !view.supported) return { key: 'awake.unsupported', tone: 'muted', minutes: 0 };
  const m = view.mode || { kind: 'off' };
  if (m.kind === 'on') return { key: 'awake.on', tone: 'ok', minutes: 0 };
  if (m.kind === 'until') {
    const left = Math.max(0, Math.ceil((m.until - view.now) / 60));
    return left > 0 ? { key: 'awake.timer', tone: 'ok', minutes: left } : { key: 'awake.off', tone: 'muted', minutes: 0 };
  }
  return { key: 'awake.off', tone: 'muted', minutes: 0 };
}

/** Codenotch card: which state key and which actions make sense. */
export function codenotchState(info) {
  if (!info || !info.supported) return { key: 'codenotch.unsupported', tone: 'muted', canStart: false, canInstall: false };
  if (!info.installed) return { key: 'codenotch.notInstalled', tone: 'warn', canStart: false, canInstall: true };
  return { key: info.running ? 'codenotch.running' : 'codenotch.stopped', tone: info.running ? 'ok' : 'muted', canStart: !info.running, canInstall: true };
}

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
