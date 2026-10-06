// F3 H-1 regression: syncSkillsToGlobalHarnesses never writes ~/.codex/skills (Codex reads ~/.agents/skills
// too, so both roots list every skill twice) and the one-time retirement of old AOS copies is idempotent.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-f3-'));
const home = path.join(tmp, 'home');
const bin = path.join(tmp, 'bin');
fs.mkdirSync(home); fs.mkdirSync(bin);
process.env.HOME = home;
process.env.USERPROFILE = home;
delete process.env.CLAUDE_CONFIG_DIR;
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
assert.equal(os.homedir(), home);
fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
process.env.PATH = `${bin}:/usr/bin:/bin`;

const inst = require('../installer.js');
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }) : []);
const backups = () => walk(path.join(home, '.agents', 'backups')).filter((n) => /^plugin-migration-codex-skills-[^/\\]*$/.test(n));

test('Codex detected: skills land in ~/.agents/skills only, old AOS copies are retired once, .system untouched', () => {
  assert.ok(inst.detectPlatforms().some((d) => d.key === 'codex'), 'codex shim must be detected');
  const root = path.join(home, '.codex', 'skills');
  const old = path.join(root, 'startcycle', 'SKILL.md');
  const sys = path.join(root, '.system', 'imagegen', 'SKILL.md');
  for (const [f, t] of [[old, 'old AOS copy'], [sys, 'system']]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); }
  inst.initSessionManifest({ [old]: { path: old, sha256: sha('old AOS copy') } }, []);

  for (let run = 1; run <= 3; run++) {
    inst.syncSkillsToGlobalHarnesses();
    assert.deepEqual(walk(root).filter((n) => !n.startsWith('.system')), [], `run ${run}: nothing but .system in ~/.codex/skills`);
    assert.equal(fs.readFileSync(sys, 'utf8'), 'system');
    assert.ok(fs.existsSync(path.join(home, '.agents', 'skills', 'startcycle', 'SKILL.md')), `run ${run}: agents/skills written`);
    assert.equal(backups().length, 1, `run ${run}: exactly the one-time backup, never a new one`);
  }
});
