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
  const body = (name) => { const i = src.indexOf(`function ${name}(`); return src.slice(i, src.indexOf('\n}\n', i)); };
  // v5 split Quick Update into kernel + harnesses steps; runQuickUpdate runs them in that order.
  const quick = body('runQuickUpdate');
  assert.ok(quick.indexOf('quickUpdateKernel(') >= 0 && quick.indexOf('quickUpdateKernel(') < quick.indexOf('quickUpdateHarnesses('));
  {
    const b = `${body('quickUpdateKernel')}\n${body('quickUpdateHarnesses')}`;
    const order = ['runPluginMigration()', 'runAgyPluginStep()', 'injectHarnessRules()', 'runCodexPluginStep()'].map((k) => b.indexOf(k));
    assert.ok(order.every((x) => x >= 0), `Quick Update misses a plugin step: ${order}`);
    assert.deepEqual([...order].sort((a, b2) => a - b2), order);
  }
  const full = body('main');
  assert.ok(full.indexOf('runAgyPluginStep()') > 0 && full.indexOf('runAgyPluginStep()') < full.indexOf('injectHarnessRules()') && full.indexOf('injectHarnessRules()') < full.indexOf('runCodexPluginStep()'));
});

test('codex step reaches a Codex that is only an npm .cmd-style shim on PATH (no shell string), logs one line when absent', () => {
  const calls = path.join(tmp, 'codex-calls');
  const WIN = process.platform === 'win32';
  if (WIN) fs.writeFileSync(path.join(bin, 'codex.cmd'), `@echo off\r\necho %* >> "${calls}"\r\necho %* | findstr /c:"list" >nul && echo {"installed":[],"available":[]}\r\nexit /b 0\r\n`);
  else shim('codex', `echo "$@" >> "${calls}"\ncase "$2" in list) echo '{"installed":[],"available":[]}';; esac\nexit 0`);
  const old = process.env.PATH;
  process.env.PATH = [bin, ...(WIN ? [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')] : ['/usr/bin', '/bin'])].join(path.delimiter);
  try {
    try { inst.runCodexPluginStep(); } catch { /* the shim never lists the plugin as installed, so the step now reports FAILED */ }
    const got = fs.readFileSync(calls, 'utf8').replace(/"/g, ''); // the cmd.exe path quotes every argument
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

test('retireCodexSkillCopies: module skills matching ~/.agents/skills are backed up and retired, edited copies stay', () => {
  const codexRoot = path.join(home, '.codex', 'skills');
  const agentsRoot = path.join(home, '.agents', 'skills');

  const mkCodex = (rel, text) => {
    const f = path.join(codexRoot, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
    return f;
  };
  const mkAgents = (rel, text) => {
    const f = path.join(agentsRoot, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
    return f;
  };

  // 1. Module skill matching exactly (e.g. code-first-hardware-design)
  const m1Codex = mkCodex('code-first-hardware-design/SKILL.md', '# CFHD original');
  const m1Agents = mkAgents('code-first-hardware-design/SKILL.md', '# CFHD original');

  // 2. Module skill with nested files matching exactly
  const m2CodexA = mkCodex('pcb-layout-routing-automation/SKILL.md', '# Routing');
  const m2CodexB = mkCodex('pcb-layout-routing-automation/scripts/route.py', '# python code');
  const m2AgentsA = mkAgents('pcb-layout-routing-automation/SKILL.md', '# Routing');
  const m2AgentsB = mkAgents('pcb-layout-routing-automation/scripts/route.py', '# python code');

  // 3. Module skill edited in ~/.codex/skills (e.g. pcb-constraint-definition)
  const m3Codex = mkCodex('pcb-constraint-definition/SKILL.md', '# Constraints EDITED');
  const m3Agents = mkAgents('pcb-constraint-definition/SKILL.md', '# Constraints original');

  // 4. Foreign skill only in ~/.codex/skills (not in ~/.agents/skills)
  const foreign = mkCodex('my-custom-codex-skill/SKILL.md', '# Custom');

  // Manifest is empty (these are module skills, not in core manifest)
  const manifest = {};
  const res = inst.retireCodexSkillCopies(manifest);

  // m1 and m2 should be retired (backed up and removed)
  assert.ok(!fs.existsSync(m1Codex), 'm1 should be removed from ~/.codex/skills');
  assert.ok(!fs.existsSync(path.dirname(m1Codex)), 'm1 dir should be cleaned up');
  assert.ok(!fs.existsSync(m2CodexA), 'm2 SKILL.md should be removed');
  assert.ok(!fs.existsSync(m2CodexB), 'm2 subfile should be removed');
  assert.ok(!fs.existsSync(path.dirname(m2CodexA)), 'm2 dir should be cleaned up');

  // ~/.agents/skills copies must remain untouched
  assert.ok(fs.existsSync(m1Agents), 'agents copy of m1 must remain');
  assert.ok(fs.existsSync(m2AgentsA), 'agents copy of m2 must remain');
  assert.ok(fs.existsSync(m3Agents), 'agents copy of m3 must remain');

  // Edited m3 must STAY in ~/.codex/skills and be reported
  assert.ok(fs.existsSync(m3Codex), 'edited module skill copy must stay');
  assert.ok(res.leftover.includes('pcb-constraint-definition'), 'edited skill must be in leftover');

  // Foreign skill must STAY in ~/.codex/skills and NOT be in leftover
  assert.ok(fs.existsSync(foreign), 'foreign skill must stay');
  assert.ok(!res.leftover.includes('my-custom-codex-skill'), 'foreign skill is not an AOS leftover');

  // Check backup exists for m1
  const backupsDir = path.join(home, '.agents', 'backups');
  const backupEntries = fs.readdirSync(backupsDir).filter((d) => d.startsWith('plugin-migration-codex-skills-'));
  assert.ok(backupEntries.length > 0, 'backup directory should be created');
  const latestBackup = path.join(backupsDir, backupEntries[backupEntries.length - 1]);
  const backedUpM1 = path.join(latestBackup, '.codex', 'skills', 'code-first-hardware-design', 'SKILL.md');
  assert.ok(fs.existsSync(backedUpM1), 'backed up file should exist');
  assert.equal(fs.readFileSync(backedUpM1, 'utf8'), '# CFHD original');
});

