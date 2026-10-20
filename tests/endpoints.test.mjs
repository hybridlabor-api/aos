import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { readEndpoints, updateEndpoints, markDown, patchFromRows, endpointsPath, urlOf } from '../lib/endpoints.mjs';

const mk = () => mkdtempSync(join(tmpdir(), 'aos-endpoints-'));

test('missing file: every known id falls back to its documented default port', () => {
  const home = mk();
  const e = readEndpoints({ home });
  assert.equal(e.services['plan-canvas'].url, 'http://127.0.0.1:4519');
  assert.equal(e.services.ao.port, 3101);
  assert.equal(e.services.memb.via, 'http://127.0.0.1:7900/memb');
  assert.equal(urlOf('synapse', { home }), 'http://127.0.0.1:7781');
  assert.deepEqual(e.agenttrail, []);
});

test('broken file and unknown keys are tolerated', () => {
  const home = mk();
  mkdirSync(join(home, '.aos'));
  writeFileSync(endpointsPath(home), '{nope');
  assert.equal(readEndpoints({ home }).services.hub.port, 7900);
  writeFileSync(endpointsPath(home), JSON.stringify({ schema: 9, extra: 1, services: { memb: { port: 9999, future: true, status: 'up' }, bogus: {} } }));
  const e = readEndpoints({ home });
  assert.equal(e.services.memb.url, 'http://127.0.0.1:9999');
  assert.equal(e.services.bogus, undefined);
});

test('a pid that is not alive turns up into down; dead trail maps are dropped', () => {
  const home = mk();
  updateEndpoints(home, { services: { 'plan-canvas': { port: 4600, pid: 111, status: 'up' } }, agenttrail: [{ repo: '/r', url: 'http://127.0.0.1:5333', port: 5333, pid: 222 }, { repo: '/s', url: 'http://127.0.0.1:5334', port: 5334, pid: 333 }] });
  const e = readEndpoints({ home, alive: (pid) => pid === 333 });
  assert.equal(e.services['plan-canvas'].status, 'down');
  assert.deepEqual(e.agenttrail.map((m) => m.port), [5334]);
});

test('updates merge per id, keep pid/version for the same port, markDown clears pid, writes leave no tmp file', () => {
  const home = mk();
  updateEndpoints(home, { services: { memb: { port: 8088, pid: 42, version: '2.4.0', status: 'up' } } });
  updateEndpoints(home, { services: { memb: { port: 8088, status: 'up' } } });
  let raw = JSON.parse(readFileSync(endpointsPath(home), 'utf8'));
  assert.equal(raw.schema, 1);
  assert.equal(raw.services.memb.pid, 42);
  assert.equal(raw.services.memb.version, '2.4.0');
  markDown(home, 'memb');
  raw = JSON.parse(readFileSync(endpointsPath(home), 'utf8'));
  assert.equal(raw.services.memb.status, 'down');
  assert.equal(raw.services.memb.pid, null);
  assert.deepEqual(readdirSync(join(home, '.aos')), ['endpoints.json']);
});

test('patchFromRows maps supervisor rows, keeps trail repos', () => {
  const p = patchFromRows([
    { id: 'memb', port: 8088, up: true, version: '2.4.0' },
    { id: 'ao', port: 3101, up: false },
    { id: 'a2a', up: true },
    { id: 'agenttrail', ports: [5330, 5331] },
  ], { hubPort: 7900, hubPid: 7, trailRepos: [{ repo: '/x', url: 'http://127.0.0.1:5330', port: 5330, pid: 9 }] });
  assert.equal(p.services.hub.pid, 7);
  assert.equal(p.services.memb.status, 'up');
  assert.equal(p.services.ao.status, 'down');
  assert.equal(p.services.a2a, undefined);
  assert.equal(p.agenttrail[0].repo, '/x');
  assert.equal(p.agenttrail[1].repo, null);
});

test('skill-side lite writers produce a file the reader understands', async () => {
  const home = mk();
  const old = process.env.HOME;
  process.env.HOME = home;
  try {
    const require = createRequire(import.meta.url);
    const pc = require('../skills/global_config/plan-canvas/scripts/lib/endpoints-lite.js');
    pc.announce('plan-canvas', { port: 4521, version: '1.1.0' });
    const { announceTrail } = await import('../skills/global_config/agenttrail/lib/endpoints-lite.mjs');
    announceTrail({ repo: '/repo', port: 5333 });
    let e = readEndpoints({ home });
    assert.equal(e.services['plan-canvas'].url, 'http://127.0.0.1:4521');
    assert.equal(e.services['plan-canvas'].status, 'up');
    assert.equal(e.agenttrail[0].repo, '/repo');
    pc.retire('plan-canvas');
    e = readEndpoints({ home });
    assert.equal(e.services['plan-canvas'].status, 'down');
  } finally { process.env.HOME = old; }
});
