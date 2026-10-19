// Discovery file ~/.aos/endpoints.json (schema 1, docs/one-port.md). Readers tolerate a missing or
// broken file and unknown keys, fall back to the default ports, and treat a dead pid as down.
// Writers update atomically (tmp + rename) and merge per service id.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const HUB_URL = 'http://127.0.0.1:7900';
export const DEFAULTS = {
  hub: { port: 7900, via: null },
  gateway: { port: 7790, via: null },
  'plan-canvas': { port: 4519, via: '/canvas' },
  memb: { port: 8088, via: '/memb' },
  synapse: { port: 7781, via: '/synapse' },
  ao: { port: 3101, via: null },
};
export const endpointsPath = (home = homedir()) => join(home, '.aos', 'endpoints.json');

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const pidAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

export function readRaw(home) {
  try {
    const j = JSON.parse(readFileSync(endpointsPath(home), 'utf8'));
    return isObj(j) ? j : {};
  } catch { return {}; }
}

// Always returns every known id (defaults filled in) so callers never branch on a missing file.
export function readEndpoints({ home, alive = pidAlive } = {}) {
  const raw = readRaw(home);
  const hub = typeof raw.hub === 'string' ? raw.hub : HUB_URL;
  const services = {};
  for (const [id, d] of Object.entries(DEFAULTS)) {
    const e = isObj(raw.services) && isObj(raw.services[id]) ? raw.services[id] : null;
    const port = e && Number.isInteger(e.port) ? e.port : d.port;
    const pid = e && Number.isInteger(e.pid) ? e.pid : null;
    let status = e && ['up', 'down', 'unknown'].includes(e.status) ? e.status : 'unknown';
    if (status === 'up' && pid !== null && !alive(pid)) status = 'down';
    services[id] = {
      url: e && typeof e.url === 'string' ? e.url : `http://127.0.0.1:${port}`,
      port, pid, version: e && typeof e.version === 'string' ? e.version : null, status,
      via: e && 'via' in e ? e.via : (d.via ? `${hub}${d.via}` : null),
    };
  }
  const agenttrail = (Array.isArray(raw.agenttrail) ? raw.agenttrail : [])
    .filter((m) => isObj(m) && Number.isInteger(m.port) && (!Number.isInteger(m.pid) || alive(m.pid)))
    .map((m) => ({ repo: typeof m.repo === 'string' ? m.repo : null, url: typeof m.url === 'string' ? m.url : `http://127.0.0.1:${m.port}`, port: m.port, pid: Number.isInteger(m.pid) ? m.pid : null }));
  return { schema: 1, updated: typeof raw.updated === 'string' ? raw.updated : null, hub, services, agenttrail };
}

// Where to reach a service: the documented default when nothing is recorded.
export const urlOf = (id, opts) => readEndpoints(opts).services[id]?.url;

function save(home, doc) {
  const file = endpointsPath(home);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...doc, schema: 1, updated: new Date().toISOString() }, null, 2));
  renameSync(tmp, file);
}

// patch: { hub?, services?: { id: partial entry }, agenttrail?: [full list] }. Missing pid/version keep the stored value for the same port.
export function updateEndpoints(home, patch = {}) {
  const raw = readRaw(home);
  const services = isObj(raw.services) ? { ...raw.services } : {};
  for (const [id, p] of Object.entries(patch.services || {})) {
    const old = isObj(services[id]) ? services[id] : {};
    const port = p.port ?? old.port;
    const same = old.port === port;
    const merged = { ...old, ...p, port, url: p.url ?? `http://127.0.0.1:${port}` };
    if (same && p.status !== 'down') for (const k of ['pid', 'version']) if (p[k] == null && old[k] != null) merged[k] = old[k];
    if (!('via' in merged) && DEFAULTS[id]?.via) merged.via = `${patch.hub || raw.hub || HUB_URL}${DEFAULTS[id].via}`;
    services[id] = merged;
  }
  save(home, { ...raw, hub: patch.hub || raw.hub || HUB_URL, services, agenttrail: patch.agenttrail || (Array.isArray(raw.agenttrail) ? raw.agenttrail : []) });
}

export const markDown = (home, id) => updateEndpoints(home, { services: { [id]: { status: 'down', pid: null } } });

export function upsertTrail(home, entry) {
  const list = (Array.isArray(readRaw(home).agenttrail) ? readRaw(home).agenttrail : []).filter((m) => m && m.port !== entry.port);
  updateEndpoints(home, { agenttrail: [...list, entry] });
}
export function removeTrail(home, port) {
  updateEndpoints(home, { agenttrail: (readRaw(home).agenttrail || []).filter((m) => m && m.port !== port) });
}

// Hub supervisor side: statusService rows -> patch. Trail maps keep the repo a map reported about itself.
export function patchFromRows(rows, { hubPort = 7900, hubPid = process.pid, hubVersion = null, trailRepos = [] } = {}) {
  const hub = `http://127.0.0.1:${hubPort}`;
  const services = { hub: { port: hubPort, url: hub, pid: hubPid, version: hubVersion, status: 'up', via: null } };
  for (const r of rows) {
    if (!DEFAULTS[r.id] || r.id === 'hub') continue;
    const port = Number.isInteger(r.port) ? r.port : DEFAULTS[r.id].port;
    services[r.id] = {
      port, url: `http://127.0.0.1:${port}`, status: r.up === true ? 'up' : r.up === false ? 'down' : 'unknown',
      ...(r.version ? { version: String(r.version) } : {}),
      via: DEFAULTS[r.id].via ? `${hub}${DEFAULTS[r.id].via}` : null,
    };
  }
  const t = rows.find((r) => r.id === 'agenttrail');
  const agenttrail = t && Array.isArray(t.ports)
    ? t.ports.map((port) => trailRepos.find((m) => m.port === port) || { repo: null, url: `http://127.0.0.1:${port}`, port, pid: null })
    : undefined;
  return { hub, services, ...(agenttrail ? { agenttrail } : {}) };
}
