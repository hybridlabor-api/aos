import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../ui/logic.js';

test('services summary and state', () => {
  const s = [{ id: 'hub', up: true }, { id: 'memb', up: false }, { id: 'x', up: null }];
  assert.deepEqual(L.servicesSummary(s), { up: 1, total: 3, down: ['memb'], tone: 'bad' });
  assert.equal(L.servicesSummary([{ id: 'a', up: true }]).tone, 'ok');
  assert.equal(L.servicesSummary([{ id: 'a', up: null }]).tone, 'warn');
  assert.equal(L.serviceState({}), 'unknown');
});

test('doctor summary counts warnings apart from failures', () => {
  const d = { ok: false, results: [{ ok: true }, { ok: false, warningOnly: true }, { ok: false, warningOnly: false }] };
  assert.deepEqual(L.doctorSummary(d), { total: 3, fail: 1, warn: 1, tone: 'bad' });
  assert.equal(L.doctorSummary({ results: [{ ok: false, warningOnly: true }] }).tone, 'warn');
  assert.equal(L.doctorSummary(null).tone, 'ok');
  assert.equal(L.detailText({ a: 1 }), '{"a":1}');
  assert.equal(L.detailText(null), '');
});

test('upstream rows merge selected and known servers', () => {
  const rows = L.upstreamRows({ upstreams: [{ name: 'github', ok: true }, { name: 'custom', ok: false, busy: true }] }, ['github', 'chrome-devtools']);
  assert.deepEqual(rows.map((r) => [r.name, r.state, r.changeable]), [['chrome-devtools', 'notSelected', true], ['custom', 'starting', false], ['github', 'ok', true]]);
  assert.equal(L.upstreamState({ ok: false, degraded: true }), 'degraded');
  assert.equal(L.upstreamState({ ok: false }), 'failing');
  assert.deepEqual(L.upstreamRows(null, []), []);
});

test('typed restart confirm must match exactly', () => {
  assert.ok(L.restartConfirmed('memb', 'memb'));
  assert.ok(L.restartConfirmed(' memb ', 'memb'));
  assert.ok(!L.restartConfirmed('MEMB', 'memb'));
  assert.ok(!L.restartConfirmed('mem', 'memb'));
  assert.ok(!L.restartConfirmed('', ''));
  assert.ok(!L.restartConfirmed(undefined, 'memb'));
});

test('git badge and project name', () => {
  assert.equal(L.gitBadge({ is_git: false }).key, 'projects.notGit');
  assert.equal(L.gitBadge({ is_git: true, changes: null }).key, 'projects.gitUnknown');
  assert.equal(L.gitBadge({ is_git: true, changes: 0 }).tone, 'ok');
  assert.deepEqual(L.gitBadge({ is_git: true, changes: 3 }), { key: 'projects.changes', n: 3, tone: 'warn' });
  assert.equal(L.projectName({ dir: 'd', meta: { name: 'N' } }), 'N');
  assert.equal(L.projectName({ dir: 'd', meta: null }), 'd');
});

test('secret rows keep names and flags only', () => {
  assert.deepEqual(L.secretRows([{ name: 'A_KEY', has_value: true, value: 'leak' }]), [{ name: 'A_KEY', set: true }]);
});

test('screen from hash', () => {
  assert.equal(L.screenFromHash('#services'), 'services');
  assert.equal(L.screenFromHash('#nope'), 'home');
  assert.equal(L.screenFromHash(''), 'home');
});

import { toggleTarget, moveTarget, routerRows } from '../ui/logic.js';

test('router editor: toggle adds at the end and removes', () => {
  assert.deepEqual(toggleTarget(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggleTarget(['a', 'b'], 'a'), ['b']);
});

test('router editor: move swaps neighbours and ignores out-of-range', () => {
  assert.deepEqual(moveTarget(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
  assert.deepEqual(moveTarget(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c']);
  assert.deepEqual(moveTarget(['a', 'b'], 'x', 1), ['a', 'b']);
});

test('router editor: rows carry targets and source with defaults', () => {
  const rows = routerRows({ roles: ['builder', 'scout'], preferences: { builder: ['claude'] }, sources: { builder: 'user' } });
  assert.deepEqual(rows, [{ role: 'builder', targets: ['claude'], source: 'user' }, { role: 'scout', targets: [], source: 'shipped' }]);
  assert.deepEqual(routerRows(null), []);
});
