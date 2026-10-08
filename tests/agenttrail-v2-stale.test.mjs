import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { lifecycle, stalledTasks, branchState, CONFIG_DEFAULTS, loadConfig } from '../skills/global_config/agenttrail/lib/stale.mjs';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const ago = (ms) => NOW - ms;

const GIT_ENV = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
};

let repo;
let repoB;

before(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-stale-'));
  git(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'base');
  git(repo, 'checkout', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'b');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'work');

  repoB = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-stale-b-'));
  git(repoB, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repoB, 'c.txt'), 'c');
  git(repoB, 'add', '.');
  git(repoB, 'commit', '-qm', 'base');
  git(repoB, 'checkout', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(repoB, 'd.txt'), 'd');
  git(repoB, 'add', '.');
  git(repoB, 'commit', '-qm', 'work');
});

describe('lifecycle transitions', () => {
  const at = (ageMs, extra = {}) => lifecycle({ now: NOW, lastActivity: ago(ageMs), ...extra });

  test('a session reporting right now is live', () => {
    assert.equal(at(0, { liveSession: true }), 'live');
    assert.equal(at(5 * MIN, { liveSession: true }), 'live');
  });

  test('activity inside the 6h window is active once no session is live', () => {
    assert.equal(at(11 * MIN), 'active');
    assert.equal(at(59 * MIN), 'active');
    assert.equal(at(6 * HOUR - MIN), 'active');
  });

  test('past 6h and inside 48h is idle', () => {
    assert.equal(at(6 * HOUR), 'idle');
    assert.equal(at(47 * HOUR), 'idle');
  });

  test('past 48h is archived', () => {
    assert.equal(at(48 * HOUR), 'archived');
    assert.equal(at(400 * HOUR), 'archived');
  });

  test('a live session is never archived, however old the plan file is', () => {
    assert.equal(at(400 * HOUR, { liveSession: true }), 'live');
  });

  test('a merged branch archives immediately', () => {
    assert.equal(at(0, { branchState: 'merged' }), 'archived');
    assert.equal(at(0, { branchState: 'merged', pinned: true }), 'archived');
  });

  test('a deleted branch archives immediately', () => {
    assert.equal(at(1 * MIN, { branchState: 'deleted' }), 'archived');
  });

  test('a merged branch with a live session stays live', () => {
    assert.equal(at(400 * HOUR, { branchState: 'merged', liveSession: true }), 'live');
  });

  test('a pinned plan stays visible instead of being archived', () => {
    assert.equal(at(400 * HOUR, { pinned: true }), 'idle');
    assert.equal(at(20 * HOUR, { pinned: true }), 'idle');
  });

  test('an open branch on an old plan still archives', () => {
    assert.equal(at(400 * HOUR, { branchState: 'open' }), 'archived');
  });

  test('thresholds are configurable and default to the decided values', () => {
    assert.equal(CONFIG_DEFAULTS.liveMs, 10 * MIN);
    assert.equal(CONFIG_DEFAULTS.activeMs, 6 * HOUR);
    assert.equal(CONFIG_DEFAULTS.idleMs, 48 * HOUR);
    assert.equal(CONFIG_DEFAULTS.stalledMs, 30 * MIN);
    assert.equal(at(20 * HOUR, { cfg: { ...CONFIG_DEFAULTS, idleMs: 12 * HOUR } }), 'archived');
  });
});

describe('stalledTasks', () => {
  const task = (id, status, by) => ({ id, status, by });

  test('an active task whose agent stopped reporting is stalled after 30 min', () => {
    const runs = new Map([['opus', { lastEventAt: ago(29 * MIN) }]]);
    assert.deepEqual([...stalledTasks([task('t1', 'active', 'opus')], runs, NOW)], []);
    const stale = new Map([['opus', { lastEventAt: ago(31 * MIN) }]]);
    assert.deepEqual([...stalledTasks([task('t1', 'active', 'opus')], stale, NOW)], ['t1']);
  });

  test('an ended session stalls its active task immediately', () => {
    const runs = new Map([['opus', { lastEventAt: ago(0), ended: true }]]);
    assert.deepEqual([...stalledTasks([task('t1', 'active', 'opus')], runs, NOW)], ['t1']);
  });

  test('an active task with no known run is stalled', () => {
    assert.deepEqual([...stalledTasks([task('t1', 'active', 'ghost')], new Map(), NOW)], ['t1']);
  });

  test('a healthy active task is not stalled', () => {
    const runs = new Map([['opus', { lastEventAt: ago(2 * MIN) }]]);
    assert.deepEqual([...stalledTasks([task('t1', 'active', 'opus')], runs, NOW)], []);
  });

  test('only active tasks are considered', () => {
    const runs = new Map();
    const tasks = [task('done', 'done', 'opus'), task('todo', 'pending', 'opus'), task('stuck', 'blocked', 'opus'), task('nobody', 'active', '')];
    assert.deepEqual([...stalledTasks(tasks, runs, NOW)], []);
  });

  test('a plain object of runs works as well as a Map', () => {
    const runs = { opus: { lastEventAt: ago(60 * MIN) } };
    assert.deepEqual([...stalledTasks([task('t1', 'active', 'opus')], runs, NOW)], ['t1']);
  });

  test('the stalled threshold is configurable', () => {
    const runs = new Map([['opus', { lastEventAt: ago(20 * MIN) }]]);
    const cfg = { ...CONFIG_DEFAULTS, stalledMs: 10 * MIN };
    assert.deepEqual([...stalledTasks([task('t1', 'active', 'opus')], runs, NOW, cfg)], ['t1']);
  });
});

describe('branchState', () => {
  test('a branch merged into the default branch is merged', () => {
    git(repo, 'checkout', '-q', 'main');
    git(repo, 'merge', '-q', '--ff-only', 'feature');
    assert.equal(branchState(repo, 'feature', { defaultBranch: 'main' }), 'merged');
  });

  test('a branch that still has work ahead of the default branch is open', () => {
    assert.equal(branchState(repoB, 'feature', { defaultBranch: 'main' }), 'open');
  });

  test('a branch that no longer exists is deleted', () => {
    assert.equal(branchState(repoB, 'gone', { defaultBranch: 'main' }), 'deleted');
  });

  test('the default branch is discovered when not given', () => {
    assert.equal(branchState(repoB, 'feature'), 'open');
  });
});

describe('loadConfig', () => {
  test('defaults apply when no file exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-cfg-'));
    assert.deepEqual(loadConfig(dir), CONFIG_DEFAULTS);
  });

  test('a partial file overrides only what it names', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-cfg-'));
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ idleMs: 12 * HOUR }));
    const cfg = loadConfig(dir);
    assert.equal(cfg.idleMs, 12 * HOUR);
    assert.equal(cfg.activeMs, CONFIG_DEFAULTS.activeMs);
  });

  test('a malformed file falls back to the defaults', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-cfg-'));
    fs.writeFileSync(path.join(dir, 'config.json'), '{ not json');
    assert.deepEqual(loadConfig(dir), CONFIG_DEFAULTS);
  });
});