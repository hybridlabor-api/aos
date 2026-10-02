// F1 regressions: Quick Update installs the agy/Codex plugins, AOS stops feeding Codex twice, stale
// ~/.codex-plugin is retired, AOS_PLUGIN_CLI switch. Temp HOME, fake codex/agy shims on PATH; no real CLI.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-f1-'));
const home = path.join(tmp, 'home');
const bin = path.join(tmp, 'bin');
fs.mkdirSync(home); fs.mkdirSync(bin);
process.env.HOME = home;
process.env.USERPROFILE = home;
delete process.env.CLAUDE_CONFIG_DIR;
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
assert.equal(os.homedir(), home);

const inst = require('../installer.js');
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const ROOT = path.join(__dirname, '..');

function shim(name, body) {
  const f = path.join(bin, name);
  fs.writeFileSync(f, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

test('Quick Update runs the same three plugin steps, in the full-install order', () => {
  const src = fs.readFileSync(path.join(ROOT, 'installer.js'), 'utf8');
  const body = (name) => { const i = src.indexOf(`async function ${name}(`); return src.slice(i, src.indexOf('\n}\n', i)); };
  for (const fn of ['runQuickUpdate']) {
    const b = body(fn);
    const order = ['runPluginMigration()', 'runAgyPluginStep()', 'injectHarnessRules()', 'runCodexPluginStep()'].map((k) => b.indexOf(k));
    assert.ok(order.every((x) => x >= 0), `${fn} misses a plugin step: ${order}`);
    assert.deepEqual([...order].sort((a, b2) => a - b2), order);
  }
  const full = body('main');
  assert.ok(full.indexOf('runAgyPluginStep()') > 0 && full.indexOf('runAgyPluginStep()') < full.indexOf('injectHarnessRules()') && full.indexOf('injectHarnessRules()') < full.indexOf('runCodexPluginStep()'));
});

test('codex step reaches a Codex that is only an npm .cmd-style shim on PATH (no shell string), logs one line when absent', () => {
  const calls = path.join(tmp, 'codex-calls');
  shim('codex', `echo "$@" >> "${calls}"\ncase "$2" in list) echo '{"installed":[],"available":[]}';; esac\nexit 0`);
  const old = process.env.PATH;
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  try {
    inst.runCodexPluginStep();
    const got = fs.readFileSync(calls, 'utf8');
    assert.match(got, /plugin list --json/);
    assert.match(got, /plugin marketplace add .*/);
  } finally { process.env.PATH = old; }
});

test('realClaudeHome: AOS_PLUGIN_CLI on forces, off disables, otherwise real home only', () => {
  const was = process.env.AOS_PLUGIN_CLI;
  try {
    delete process.env.AOS_PLUGIN_CLI;
    assert.equal(inst.realClaudeHome(home), false);
    assert.equal(inst.realClaudeHome(os.userInfo().homedir), true);
    process.env.AOS_PLUGIN_CLI = 'on';
    assert.equal(inst.realClaudeHome(home), true);
    process.env.AOS_PLUGIN_CLI = 'off';
    assert.equal(inst.realClaudeHome(os.userInfo().homedir), false);
  } finally { if (was === undefined) delete process.env.AOS_PLUGIN_CLI; else process.env.AOS_PLUGIN_CLI = was; }
});

test('retireStaleCodexPluginDir: removes only what AOS wrote (manifest or package bytes), backs it up', () => {
  const dir = path.join(home, '.codex-plugin');
  fs.mkdirSync(dir, { recursive: true });
  const pj = path.join(dir, 'plugin.json');
  fs.copyFileSync(path.join(ROOT, '.codex-plugin', 'plugin.json'), pj);
  const mine = path.join(dir, 'system.md');
  fs.writeFileSync(mine, 'aos-wrote-this');
  const user = path.join(dir, 'notes.txt');
  fs.writeFileSync(user, 'user file');
  const manifest = { [mine]: { path: mine, sha256: sha('aos-wrote-this') } };
  inst.retireStaleCodexPluginDir(manifest);
  assert.ok(!fs.existsSync(pj) && !fs.existsSync(mine));
  assert.ok(fs.existsSync(user), 'foreign file stays');
  assert.equal(manifest[mine], undefined);
  const backups = fs.readdirSync(path.join(home, '.agents', 'backups')).filter((d) => d.startsWith('codex-plugin-dir-'));
  assert.equal(backups.length, 1);
  assert.ok(fs.existsSync(path.join(home, '.agents', 'backups', backups[0], 'plugin.json')));
});

test('retireStaleCodexPluginDir: an edited manifest file is kept', () => {
  const dir = path.join(home, '.codex-plugin');
  const f = path.join(dir, 'system.md');
  fs.writeFileSync(f, 'edited by user');
  inst.retireStaleCodexPluginDir({ [f]: { path: f, sha256: sha('original') } });
  assert.ok(fs.existsSync(f));
});

test('retireCodexSkillCopies: AOS copies leave ~/.codex/skills, foreign and .system stay; edits block removal', () => {
  const root = path.join(home, '.codex', 'skills');
  const mk = (rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
  const a = mk('alpha/SKILL.md', 'A');
  const b = mk('beta/SKILL.md', 'B');
  const sys = mk('.system/imagegen/SKILL.md', 'S');
  const manifest = { [a]: { path: a, sha256: sha('A') }, [b]: { path: b, sha256: sha('B') } };
  fs.writeFileSync(b, 'B edited');
  inst.retireCodexSkillCopies(manifest);
  assert.ok(fs.existsSync(a) && fs.existsSync(b), 'edited copy blocks the all-or-nothing removal');
  fs.writeFileSync(b, 'B');
  inst.retireCodexSkillCopies(manifest);
  assert.ok(!fs.existsSync(a) && !fs.existsSync(b));
  assert.ok(fs.existsSync(sys));
});

test('harnessDirs no longer copies .codex-plugin into HOME', () => {
  const src = fs.readFileSync(path.join(ROOT, 'installer.js'), 'utf8');
  const m = /const harnessDirs = \[([^\]]*)\]/.exec(src);
  assert.ok(m && !m[1].includes('.codex-plugin'));
});
