// #187: OpenCode reads ~/.agents/skills through skills.paths, so AOS stops feeding ~/.config/opencode/skills too and retires its own unedited copies.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-ocskills-'));
const home = path.join(tmp, 'home');
const bin = path.join(tmp, 'bin');
fs.mkdirSync(home); fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'opencode'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
delete process.env.CLAUDE_CONFIG_DIR;
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
assert.equal(os.homedir(), home);

const inst = require('../installer.js');
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const ocRoot = path.join(home, '.config', 'opencode', 'skills');
const mk = (rel, text) => { const f = path.join(ocRoot, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };

test('without skills.paths the OpenCode copies stay and stay a sync target', () => {
  const a = mk('alpha/SKILL.md', 'A');
  const manifest = { [a]: { path: a, sha256: sha('A') } };
  assert.equal(inst.opencodeUsesAgentsSkills(home), false);
  inst.retireOpencodeSkillCopies(manifest);
  assert.ok(fs.existsSync(a));
  assert.ok(inst.globalSkillDestinations({ ignorePluginCoverage: true }).some((d) => d.dir === ocRoot));
});

test('with skills.paths (opencode.jsonc, comments) AOS copies are backed up and removed; user and edited skills stay', () => {
  const cfgFile = path.join(home, '.config', 'opencode', 'opencode.jsonc');
  fs.writeFileSync(cfgFile, `{\n  // mine\n  "skills": { "paths": [${JSON.stringify(path.join(home, '.agents', 'skills'))}, ".agents/skills"] }\n}\n`);
  assert.equal(inst.opencodeUsesAgentsSkills(home), true);
  assert.ok(!inst.globalSkillDestinations({ ignorePluginCoverage: true }).some((d) => d.dir === ocRoot));
  const a = path.join(ocRoot, 'alpha', 'SKILL.md');
  const b = mk('beta/SKILL.md', 'B');
  const mine = mk('mine/SKILL.md', 'user skill');
  const manifest = { [a]: { path: a, sha256: sha('A') }, [b]: { path: b, sha256: sha('B') } };
  fs.writeFileSync(b, 'B edited');
  inst.retireOpencodeSkillCopies(manifest);
  assert.ok(fs.existsSync(a) && fs.existsSync(b), 'an edited copy blocks the all-or-nothing removal');
  fs.writeFileSync(b, 'B');
  inst.retireOpencodeSkillCopies(manifest);
  assert.ok(!fs.existsSync(a) && !fs.existsSync(b));
  assert.ok(fs.existsSync(mine), 'user skill untouched');
  const backups = fs.readdirSync(path.join(home, '.agents', 'backups')).filter((n) => n.startsWith('plugin-migration-opencode-skills-'));
  assert.equal(backups.length > 0, true);
  assert.ok(fs.existsSync(path.join(home, '.agents', 'backups', backups[0], '.config', 'opencode', 'skills', 'alpha', 'SKILL.md')));
});

test('a failed backup keeps every file of the skill (copy all first, unlink after)', () => {
  const agents = path.join(home, '.agents', 'skills', 'zeta', 'SKILL.md');
  fs.mkdirSync(path.dirname(agents), { recursive: true });
  fs.writeFileSync(agents, 'Z');
  const z = mk('zeta/SKILL.md', 'Z');
  const z2 = mk('zeta/extra.md', 'E');
  fs.writeFileSync(path.join(home, '.agents', 'skills', 'zeta', 'extra.md'), 'E');
  fs.rmSync(path.join(home, '.agents', 'backups'), { recursive: true, force: true });
  fs.writeFileSync(path.join(home, '.agents', 'backups'), 'not a directory');
  inst.retireOpencodeSkillCopies({});
  assert.ok(fs.existsSync(z) && fs.existsSync(z2));
});
