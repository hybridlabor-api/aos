import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { summarizeAcpLog, normalizeHubModel, normalizeRegistry, mergeSessions, renderText, buildOverview, readTailLines, harnessLabel } from '../bin/aos-sessions.mjs';

const NOW = Date.parse('2026-10-08T02:10:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

test('acp running', () => {
  const r = summarizeAcpLog([JSON.stringify({ ts: iso(40_000), event: 'start', adapter: 'opencode' }), JSON.stringify({ ts: iso(30_000), event: 'send' })], NOW);
  assert.equal(r.state, 'running');
});
test('acp stalled', () => {
  const r = summarizeAcpLog([JSON.stringify({ ts: iso(20 * 60_000), event: 'send' })], NOW);
  assert.equal(r.state, 'stalled');
});
test('acp done', () => {
  const r = summarizeAcpLog([JSON.stringify({ ts: iso(5000), event: 'start' }), JSON.stringify({ ts: iso(1000), event: 'done', stopReason: 'ok' })], NOW);
  assert.equal(r.state, 'done');
  assert.match(r.detail, /ok/);
});
test('acp GO via permission_pending', () => {
  const r = summarizeAcpLog([JSON.stringify({ ts: iso(60_000), event: 'send' }), JSON.stringify({ ts: iso(30_000), event: 'permission_pending' })], NOW);
  assert.equal(r.state, 'GO needed');
});
test('acp GO via denied guarded', () => {
  const r = summarizeAcpLog([JSON.stringify({ ts: iso(60_000), event: 'send' }), JSON.stringify({ ts: iso(30_000), event: 'permission', allow: false, guarded: true })], NOW);
  assert.equal(r.state, 'GO needed');
});

test('kimi label', () => {
  assert.equal(harnessLabel('Kimi'), 'kimi (via trail)');
  const rows = normalizeHubModel({ sessions: [{ id: '1', name: 'k', harness: 'kimi', state: 'working', ts: new Date(NOW).toISOString() }] }, NOW);
  assert.equal(rows[0].harness, 'kimi (via trail)');
});

test('merge hub wins', () => {
  const hub = normalizeHubModel({ sessions: [{ id: 'a', name: 'x', harness: 'claude', state: 'working', cwd: '/r', ts: new Date(NOW).toISOString() }] }, NOW);
  const reg = normalizeRegistry([{ name: 'x', harness: 'claude', cwd: '/r', pid: 1 }], () => true, NOW);
  const merged = mergeSessions(hub, reg, []);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].section, 'working');
  assert.equal(merged[0].alive, true);
});

test('render wraps and no colour', () => {
  const ov = { now: NOW, hub: 'down', sessions: [{ name: 'a-very-long-name-1234567890', harness: 'claude', section: 'working', detail: 'x'.repeat(200), ageMs: 1000 }], acp: [] };
  const t = renderText(ov, { width: 60, color: false });
  assert.ok(!t.includes('\x1b['));
  for (const l of t.split('\n')) assert.ok(l.length <= 61, l);
});

test('json shape via buildOverview', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-'));
  fs.mkdirSync(path.join(home, 'sessions'));
  fs.writeFileSync(path.join(home, 'sessions', 'a.json'), JSON.stringify({ name: 'a', harness: 'codex', cwd: '/x', pid: 99999999 }));
  const ov = buildOverview({ aosHome: home, hubModel: null, now: NOW, isAlive: () => false });
  assert.equal(ov.hub, 'down');
  assert.ok(Array.isArray(ov.sessions) && Array.isArray(ov.acp));
  assert.ok(ov.sessions.every((s) => s.section));
});

test('tail reader reads last 64KB', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-'));
  const fp = path.join(home, 'w.jsonl');
  const good = JSON.stringify({ ts: new Date(NOW - 1000).toISOString(), name: 'w', event: 'send' });
  const pad = 'x'.repeat(200_000);
  fs.writeFileSync(fp, pad.slice(0, 150_000) + '\n' + good + '\n');
  const lines = readTailLines(fp);
  assert.ok(lines.some((l) => l.includes('send')));
  assert.ok(!lines.some((l) => l.includes('x'.repeat(100))));
});

test('no writes', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-'));
  fs.mkdirSync(path.join(home, 'sessions'));
  const before = JSON.stringify(fs.readdirSync(home));
  buildOverview({ aosHome: home, hubModel: { sessions: [] }, now: NOW, isAlive: () => true });
  assert.equal(JSON.stringify(fs.readdirSync(home)), before);
});

test('GO needed workers show in NEEDS YOU, done workers get a check and the stop reason', () => {
  const overview = {
    now: new Date(0).toISOString(), hub: 'down', sessions: [],
    acp: [
      { name: 'w-go', harness: 'opencode', state: 'GO needed', detail: 'GO needed (permission_pending)', ageMs: 1000 },
      { name: 'w-done', harness: 'opencode', state: 'done', detail: 'end_turn', ageMs: 5000 },
    ],
  };
  const out = renderText(overview, { width: 100, color: false });
  assert.match(out, /NEEDS YOU \(1\)\n\s+▲ opencode\s+w-go/);
  assert.match(out, /✓ opencode\s+w-done\s+done \(end_turn\)/);
  assert.match(out, /1 active/);
});
