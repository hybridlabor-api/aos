'use strict';
// aos-gogate is read-only: it prints presets and passes go-grant.mjs --status through. Temp dirs are
// left for the container to discard; nothing here deletes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'aos-gogate.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gogate-'));
const tree = (dir) => fs.readdirSync(dir, { recursive: true }).sort();

function cli(args, env = {}) {
  const base = { ...process.env, ...env };
  if (!('CLAUDE_CONFIG_DIR' in env)) delete base.CLAUDE_CONFIG_DIR;
  const r = spawnSync(process.execPath, [CLI, ...args], { env: base, encoding: 'utf8' });
  return { status: r.status, out: r.stdout.trim(), err: r.stderr };
}

function fakeGrant(claudeDir) {
  fs.mkdirSync(path.join(claudeDir, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(claudeDir, 'hooks', 'go-grant.mjs'), "console.log('FAKE:' + process.argv.slice(2).join('|')); process.exit(7)\n");
}

test('presets print the exact text to type', () => {
  const home = tmp();
  const want = {
    release: 'gogate grant push-feature,github-write,merge,publish 2h',
    feature: 'gogate grant push-feature,github-write 2h',
    soft: 'gogate soft',
    hard: 'gogate hard',
    status: 'gogate status',
  };
  for (const [name, text] of Object.entries(want)) assert.deepEqual(cli(['preset', name], { HOME: home }).out, text);
  assert.equal(cli(['preset', 'nope'], { HOME: home }).status, 1);
  assert.match(cli(['presets'], { HOME: home }).out, /release\s+gogate grant push-feature,github-write,merge,publish 2h/);
});

test('status works with only a Codex hook dir installed (no ~/.claude)', () => {
  const home = tmp();
  fakeGrant(path.join(home, '.codex'));
  const before = tree(home);
  const r = cli(['status'], { HOME: home });
  assert.equal(r.status, 7);
  assert.equal(r.out, 'FAKE:--status');
  assert.deepEqual(tree(home), before);
});

test('status without go-gate installed exits 2 and writes nothing', () => {
  const home = tmp();
  const before = tree(home);
  const r = cli(['status'], { HOME: home });
  assert.equal(r.status, 2);
  assert.match(r.err, /go-gate is not installed/);
  assert.deepEqual(tree(home), before);
});

test('status runs go-grant.mjs --status, forwards only --session, writes nothing', () => {
  const home = tmp();
  fakeGrant(path.join(home, '.claude'));
  const before = tree(home);
  const r = cli(['status', '--session', 'abc', '--evil'], { HOME: home });
  assert.equal(r.status, 7);
  assert.equal(r.out, 'FAKE:--status|--session|abc');
  assert.equal(cli(['status'], { HOME: home }).out, 'FAKE:--status');
  assert.deepEqual(tree(home), before);
});

test('--session needs a real id', () => {
  const home = tmp();
  fakeGrant(path.join(home, '.claude'));
  assert.equal(cli(['status', '--session'], { HOME: home }).status, 1);
  assert.equal(cli(['status', '--session', '--status'], { HOME: home }).status, 1);
});

test('CLAUDE_CONFIG_DIR wins over HOME', () => {
  const home = tmp();
  const config = tmp();
  fakeGrant(config);
  assert.equal(cli(['status'], { HOME: home, CLAUDE_CONFIG_DIR: config }).out, 'FAKE:--status');
});

test('help says the human types the text', () => {
  const r = cli(['--help'], { HOME: tmp() });
  assert.equal(r.status, 0);
  assert.match(r.out, /never records anything/);
});
