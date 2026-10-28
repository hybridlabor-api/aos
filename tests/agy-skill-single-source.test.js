// agy keeps only routers in ~/.gemini/config/skills; the rest lives once in ~/.agents/skills. Temp HOME only.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-agy1-'));
const home = path.join(tmp, 'home');
fs.mkdirSync(home);
process.env.HOME = home;
process.env.USERPROFILE = home;
delete process.env.CLAUDE_CONFIG_DIR;
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
assert.equal(os.homedir(), home);

const inst = require('../installer.js');
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const put = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };

test('router names are kept, everything else is not', () => {
  for (const n of ['find-skill', 'ask-tim', 'plan-canvas', 'aos-store', 'fabric-graph', 'fabric']) assert.ok(inst.isAgyRouter(n), n);
  for (const n of ['react-patterns', 'golang-pro']) assert.ok(!inst.isAgyRouter(n), n);
});

test('update migrates AOS duplicates to a backup, keeps routers and user skills', () => {
  const cfg = path.join(home, '.gemini', 'config', 'skills');
  const ag = path.join(home, '.agents', 'skills');
  const dup = put(cfg, 'react-patterns/SKILL.md', 'R');
  put(ag, 'react-patterns/SKILL.md', 'R');
  const router = put(cfg, 'find-skill/SKILL.md', 'F');
  put(ag, 'find-skill/SKILL.md', 'F');
  const edited = put(cfg, 'golang-pro/SKILL.md', 'G edited');
  put(ag, 'golang-pro/SKILL.md', 'G');
  const mine = put(cfg, 'my-own/SKILL.md', 'mine');
  const onlyHere = put(cfg, 'solo/SKILL.md', 'S');
  const m = (f, t) => ({ path: f, sha256: sha(t) });
  const manifest = { [dup]: m(dup, 'R'), [router]: m(router, 'F'), [edited]: m(edited, 'G'), [onlyHere]: m(onlyHere, 'S') };
  inst.retireAgySkillCopies(manifest, { home });
  assert.ok(!fs.existsSync(dup), 'AOS duplicate moved');
  assert.ok(fs.existsSync(router), 'router stays');
  assert.ok(fs.existsSync(mine), 'user skill stays');
  assert.ok(fs.existsSync(onlyHere), 'skill missing from ~/.agents/skills stays');
  assert.ok(fs.existsSync(edited), 'edited copy stays');
  assert.ok(fs.existsSync(path.join(ag, 'react-patterns', 'SKILL.md')), 'shared copy untouched');
  const b = fs.readdirSync(path.join(home, '.agents', 'backups')).find((d) => d.startsWith('plugin-migration-agy-skills-'));
  assert.ok(b && fs.existsSync(path.join(home, '.agents', 'backups', b, '.gemini', 'config', 'skills', 'react-patterns', 'SKILL.md')));
});

test('a symlinked config/skills is never touched', () => {
  const h2 = path.join(tmp, 'home2');
  const real = path.join(tmp, 'real');
  put(real, 'react-patterns/SKILL.md', 'R');
  put(path.join(h2, '.agents', 'skills'), 'react-patterns/SKILL.md', 'R');
  fs.mkdirSync(path.join(h2, '.gemini', 'config'), { recursive: true });
  fs.symlinkSync(real, path.join(h2, '.gemini', 'config', 'skills'));
  const f = path.join(real, 'react-patterns', 'SKILL.md');
  inst.retireAgySkillCopies({ [path.join(h2, '.gemini', 'config', 'skills', 'react-patterns', 'SKILL.md')]: { sha256: sha('R') } }, { home: h2 });
  assert.ok(fs.existsSync(f));
});
