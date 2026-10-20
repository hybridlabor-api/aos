import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import SPECS from '../lib/cli-specs/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// aos-cli forwards every flag to the pi agent; its --help is pi's, not ours.
const runnable = SPECS.filter((s) => s.name !== 'aos-cli' && s.name !== 'aos');
// Guard-based CLIs print straight from the spec, so they support --json.
const fromSpec = runnable.filter((s) => s.entry.startsWith('bin/') && s.name !== 'go-check');

function run(spec, args) {
  const home = mkdtempSync(join(tmpdir(), 'aos-help-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AOS_NO_OPEN: '1', AOS_HUB_HOME: home };
  const r = spawnSync(process.execPath, [join(root, spec.entry), ...args], { cwd: home, env, encoding: 'utf8', timeout: 30000 });
  return { r, home };
}

test('every spec entry exists and is unique', () => {
  const names = new Set();
  for (const s of SPECS) {
    assert.ok(existsSync(join(root, s.entry)), `${s.name}: entry ${s.entry} missing`);
    assert.ok(!names.has(s.name), `duplicate spec ${s.name}`);
    names.add(s.name);
  }
});

test('every package.json bin has a spec', () => {
  const covered = new Set(SPECS.flatMap((s) => [s.name, ...(s.aliases || [])]));
  for (const name of Object.keys(pkg.bin)) assert.ok(covered.has(name), `bin ${name} has no spec in lib/cli-specs`);
});

for (const spec of runnable) {
  for (const flag of ['--help', '-h']) {
    test(`${spec.name} ${flag} exits 0 without side effects`, () => {
      const { r, home } = run(spec, [flag]);
      assert.equal(r.status, 0, `${r.stderr}${r.stdout}`);
      assert.match(r.stdout, /usage/i);
      assert.deepEqual(readdirSync(home), [], 'help must not write into HOME');
    });
  }
}

for (const spec of fromSpec) {
  test(`${spec.name} help prints the spec, also as JSON`, () => {
    const text = run(spec, ['help']).r;
    assert.equal(text.status, 0, text.stderr);
    assert.ok(text.stdout.startsWith(`${spec.name} - ${spec.summary}`), text.stdout.slice(0, 120));
    const json = run(spec, ['--help', '--json']).r;
    assert.equal(json.status, 0, json.stderr);
    assert.equal(JSON.parse(json.stdout).name, spec.name);
  });
}

test('aos-mcp-env leaves --help after -- to the wrapped command', () => {
  const spec = SPECS.find((s) => s.name === 'aos-mcp-env');
  const { r } = run(spec, ['--vars', 'X', '--', process.execPath, '--version']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^v\d+\./);
});
