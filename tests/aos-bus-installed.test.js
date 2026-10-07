// Installed layout: ~/.claude/hooks/aos-bus.mjs imports its lib via the a2a hooks' fallback
// (checkout ../../lib, else ~/.agents/lib). The installer copies .claude/hooks -> ~/.claude/hooks
// and lib/ -> ~/.agents/lib, so an installed `aos-bus list` must run without MODULE_NOT_FOUND.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

test('installed aos-bus copy runs on the ~/.agents/lib fallback (no ERR_MODULE_NOT_FOUND)', () => {
  const hooksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-bus-inst-'));
  const home = hooksDir; // same dir also serves as the fake HOME
  const fsActions = [
    // same-dir imports (go-gate) are copied together with the hook; ../../lib is NOT beside it
    () => fs.copyFileSync(path.join(ROOT, '.claude', 'hooks', 'aos-bus.mjs'), path.join(hooksDir, 'aos-bus.mjs')),
    () => fs.copyFileSync(path.join(ROOT, '.claude', 'hooks', 'go-gate.mjs'), path.join(hooksDir, 'go-gate.mjs')),
    () => { fs.mkdirSync(path.join(home, '.agents', 'lib'), { recursive: true }); },
    () => fs.writeFileSync(path.join(home, '.agents', 'lib', 'a2a-inbox.mjs'),
      'export const inboxRoot = () => "/inbox-root-placeholder";\n'),
  ];
  for (const a of fsActions) a();

  const env = { ...process.env, HOME: home };
  delete env.CLAUDE_CONFIG_DIR;
  // `list` is the cheapest CLI path that resolves the LIB (inboxRoot) and exits 0 on an empty bus.
  const run = spawnSync(process.execPath, [path.join(hooksDir, 'aos-bus.mjs'), 'list'], { env, encoding: 'utf8' });
  const err = `${run.stderr || ''}`;
  assert.equal(run.status, 0, `installed aos-bus failed: exit ${run.status}\nstdout: ${run.stdout}\nstderr: ${err}`);
  assert.ok(!/ERR_MODULE_NOT_FOUND|not found/i.test(err), `unexpected module error: ${err}`);
  assert.ok(!err.includes('inboxRoot'), 'unexpected runtime error from the resolved lib');
});

test('without any lib beside or under ~/.agents/lib the hook fails cleanly, never with MODULE_NOT_FOUND', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-bus-nolib-'));
  fs.copyFileSync(path.join(ROOT, '.claude', 'hooks', 'aos-bus.mjs'), path.join(dir, 'aos-bus.mjs'));
  fs.copyFileSync(path.join(ROOT, '.claude', 'hooks', 'go-gate.mjs'), path.join(dir, 'go-gate.mjs'));
  const env = { ...process.env, HOME: dir };
  delete env.CLAUDE_CONFIG_DIR;
  const run = spawnSync(process.execPath, [path.join(dir, 'aos-bus.mjs'), 'list'], { env, encoding: 'utf8' });
  const err = `${run.stderr || ''}`;
  assert.notEqual(run.status, 0, 'a bus without a resolvable lib cannot serve');
  assert.ok(!/ERR_MODULE_NOT_FOUND/.test(err), `clean failure expected, got: ${err}`);
  assert.match(err, /not found/, 'the failure must name the missing lib');
});
