// AO executor against a fake `ao` binary on PATH: with and without `spawn --workdir`. No real AO is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { aoName, aoWorkdirSupport, executeStep } from '../lib/fabric/executors.mjs';
import { reportFor, tmpProject } from './fixtures/fabric-helpers.mjs';

const skip = process.platform === 'win32' && 'the fake ao is a sh script';
const FAKE = `#!/bin/sh
case "$1" in
  --version) echo "ao 0.0.0-fake"; exit 0;;
  spawn) ;;
  *) exit 64;;
esac
if [ "$2" = "--help" ]; then
  echo "usage: ao spawn --project <id> --agent <h> --name <n> --prompt <t>"
  [ "$FAKE_AO_WORKDIR" = 1 ] && echo "  --workdir <path>"
  exit 0
fi
printf '%s\\n' "$@" > "$FAKE_AO_LOG"
wd=""; name=""
while [ $# -gt 0 ]; do
  case "$1" in --workdir) wd="$2";; --name) name="$2";; esac
  shift
done
[ \${#name} -gt 20 ] && { echo "name too long" >&2; exit 2; }
printf '{"id":"x1","status":"running","displayName":"%s","workdir":"%s","claimedPr":null}\\n' "$name" "\${FAKE_AO_REPORT_WORKDIR:-$wd}"
`;

function setup(p, { workdir, reportWorkdir } = {}) {
  const bin = path.join(p.dir, '.fakebin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'ao'), FAKE, { mode: 0o755 });
  const log = path.join(p.dir, 'ao-args.log');
  const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_AO_LOG: log, ...(workdir && { FAKE_AO_WORKDIR: '1' }), ...(reportWorkdir && { FAKE_AO_REPORT_WORKDIR: reportWorkdir }) };
  const step = {
    run: 'a-very-long-run-name-for-the-fabric', step_id: '0-architect-1', node: 'architect', attempt: 1, kind: 'plan', cwd: p.dir, brief: path.join(p.dir, 'brief.md'),
    expected_report: path.join(p.dir, 'reports', '0-architect-1.json'), timeout_s: 20, scope: 'read-only', allowed_writes: [], model_hint: {},
  };
  fs.mkdirSync(path.dirname(step.expected_report));
  fs.writeFileSync(step.expected_report, JSON.stringify(reportFor(step, p.dir)));
  const run = (mode, onPath = (h) => h === 'claude') => executeStep(step, { mode, env, onPath, detect: async () => ({ present: true, healthy: true }) });
  return { step, log, run };
}
const withProject = (fn) => async () => { const p = tmpProject({ git: false }); try { await fn(p); } finally { p.cleanup(); } };
const argsOf = (log) => fs.readFileSync(log, 'utf8').split('\n');

test('aoName is at most 20 chars for any run and node', () => {
  for (const node of ['architect', 'media-eventtech', 'x'.repeat(40)]) {
    const n = aoName({ run: 'r'.repeat(80), node, attempt: 12, step_id: `0-${node}-12` });
    assert.ok(n.length <= 20, n);
    assert.match(n, /^f-[0-9a-f]{6}-.+-12$/);
  }
});

test('with --workdir: realpath workdir, short name, --json, no --project', { skip }, withProject(async (p) => {
  const t = setup(p, { workdir: true });
  const r = await t.run('ao');
  assert.equal(r.executor, 'ao');
  assert.equal(r.report.status, 'ok');
  const a = argsOf(t.log);
  assert.equal(a[a.indexOf('--workdir') + 1], fs.realpathSync(p.dir));
  assert.ok(a[a.indexOf('--name') + 1].length <= 20);
  assert.ok(a.includes('--json'));
  assert.ok(!a.includes('--project') && !a.includes('--branch'));
}));

test('with --workdir: a returned workdir that differs escalates and is not done', { skip }, withProject(async (p) => {
  const other = path.join(p.dir, 'elsewhere');
  fs.mkdirSync(other);
  const t = setup(p, { workdir: true, reportWorkdir: other });
  const r = await t.run('ao');
  assert.equal(r.report.status, 'escalate');
  assert.equal(r.report.needs_human, true);
  assert.equal(r.report.findings[0].id, 'ao-workdir');
  assert.match(r.report.findings[0].summary, /not in/);
}));

test('without --workdir: unsupported, cached per run, and auto/ao go on to aos-acp instead of spawning ao', { skip }, withProject(async (p) => {
  const t = setup(p, { workdir: false });
  const cache = new Map();
  const env = { PATH: `${path.join(p.dir, '.fakebin')}${path.delimiter}${process.env.PATH}` };
  const sup = aoWorkdirSupport(env, cache);
  assert.deepEqual(sup, { ok: false, version: 'ao 0.0.0-fake' });
  assert.equal(aoWorkdirSupport({ PATH: '/nonexistent' }, cache), sup, 'second call is served from the cache');
  assert.equal(aoWorkdirSupport({ PATH: '/nonexistent' }).ok, false, 'no ao at all: unsupported');
  // No harness on PATH: the only thing left after ao is skipped is the aos-acp branch, which then reports it. ao itself never ran.
  for (const mode of ['auto', 'ao']) {
    await assert.rejects(t.run(mode, () => false), /no harness found/);
    assert.ok(!fs.existsSync(t.log), `${mode}: ao spawn must not run`);
  }
}));
