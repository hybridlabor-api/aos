// Ziel C review repair: doctor A2A rows fail when the matrix is broken; uninstall reverses the A2A registrations.
// Every child process gets an inline temp HOME under os.tmpdir(); the uninstall run is container-only.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const SANDBOX_SKIP = process.env.AOS_TEST_SANDBOX !== 'container' && 'needs AOS_TEST_SANDBOX=container (runs the real uninstall path)';

const tempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'v5-a2a-repair-'));
const envFor = (home) => {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.CLAUDE_CONFIG_DIR;
  return env;
};

const a2aHooks = () => ({
  UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node "$HOME/.claude/hooks/a2a-inbox.mjs" drain' }] }],
  Stop: [{ hooks: [{ type: 'command', command: 'node "$HOME/.claude/hooks/a2a-inbox.mjs" stop' }] }],
});

function doctorRows(home) {
  const r = spawnSync(process.execPath, [path.join(REPO, 'bin', 'aos-doctor.mjs'), '--json'], { env: envFor(home), encoding: 'utf8', timeout: 120000 });
  const start = r.stdout.indexOf('{');
  assert.ok(start >= 0, `doctor printed no JSON: ${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout.slice(start)).results.filter((x) => x.area === 'a2a');
}

test('m3: with Claude installed and the A2A hooks missing, the doctor row is a hard failure, not a warning', () => {
  const home = tempHome();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: {} }));
  const row = doctorRows(home).find((x) => x.name === 'A2A Claude Code');
  assert.ok(row, 'row present');
  assert.equal(row.ok, false);
  assert.equal(row.warningOnly, false);
});

test('m3: hooks wired but lib/a2a-inbox.mjs not resolvable is also a hard failure', () => {
  const home = tempHome();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: a2aHooks() }));
  const row = doctorRows(home).find((x) => x.name === 'A2A Claude Code');
  assert.equal(row.ok, false);
  assert.equal(row.warningOnly, false);
  assert.match(row.detail, /lib\/a2a-inbox\.mjs/);
});

test('m3: hooks wired and lib present passes; without any Claude install the row stays a warning', () => {
  const home = tempHome();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.agents', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: a2aHooks() }));
  fs.writeFileSync(path.join(home, '.agents', 'lib', 'a2a-inbox.mjs'), '// stub\n');
  assert.equal(doctorRows(home).find((x) => x.name === 'A2A Claude Code').ok, true);

  const bare = tempHome();
  const row = doctorRows(bare).find((x) => x.name === 'A2A Claude Code');
  assert.equal(row.ok, false);
  assert.equal(row.warningOnly, true);
});

test('B1/M5: the real uninstall path strips the A2A hooks from settings.json and the recorded lib copies, keeping foreign hooks', { skip: SANDBOX_SKIP }, () => {
  const home = tempHome();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.agents', 'lib'), { recursive: true });
  const hooks = a2aHooks();
  hooks.Stop.unshift({ hooks: [{ type: 'command', command: 'node "/opt/other/own-hook.mjs"' }] });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ hooks }));
  fs.writeFileSync(path.join(home, '.agents', '.bdb-install-manifest.json'), '{}');

  const libFile = path.join(home, '.agents', 'lib', 'a2a-inbox.mjs');
  fs.writeFileSync(libFile, '// copy\n');
  const ur = require('../lib/uninstall-records.js');
  ur.recordA2aLibCopies(home, [libFile]);

  const r = spawnSync(process.execPath, [path.join(REPO, 'bin', 'aos-uninstall.mjs'), '--yes'], { env: envFor(home), encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);

  const text = fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8');
  assert.ok(!text.includes('a2a-inbox.mjs'), text);
  assert.ok(text.includes('own-hook.mjs'), 'foreign hook survives');
  assert.equal(fs.existsSync(libFile), false, 'recorded A2A lib copy is gone');
});
