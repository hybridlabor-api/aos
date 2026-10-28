'use strict';
// skillLibrary modes (lean|smart|groups|full): router list, usage picks, groups, ask-once, optimize prompt,
// and end-to-end install/retire/restore against throwaway HOMEs.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

process.env.AOS_TEST_SANDBOX = '1';
delete process.env.CLAUDE_CONFIG_DIR;
const homes = [];
const mk = () => { const h = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aos-lean-'))); homes.push(h); return h; };
process.on('exit', () => { for (const h of homes) fs.rmSync(h, { recursive: true, force: true }); });
const HOME = mk();
// Antigravity is detected by an `agy` binary on PATH; CI has none, so put a stub first on PATH.
const FAKE_BIN = mk();
fs.writeFileSync(path.join(FAKE_BIN, 'agy'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
process.env.PATH = `${FAKE_BIN}${path.delimiter}${process.env.PATH}`;
process.env.HOME = HOME;
for (const d of ['.claude', '.gemini/config', '.codex', '.config/opencode']) fs.mkdirSync(path.join(HOME, d), { recursive: true });

const ROOT = path.join(__dirname, '..');
const lean = require('../lib/lean-skills');
const core = require('../lib/core-skills');
const profile = require('../lib/v5/profile');
const optimize = require('../lib/v5/optimize');
const installer = require('../installer.js');

const roots = (h = HOME) => ({
  agents: path.join(h, '.agents', 'skills'), claude: path.join(h, '.claude', 'skills'),
  agy: path.join(h, '.gemini', 'config', 'skills'), codex: path.join(h, '.codex', 'skills'),
  opencode: path.join(h, '.config', 'opencode', 'skills'),
});
const names = (dir) => { try { return fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'SKILL.md'))); } catch { return []; } };
const storeCli = (args, h = HOME) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'aos-store.mjs'), ...args], { env: { ...process.env, HOME: h, USERPROFILE: h, AOS_TEST_SANDBOX: '1' }, encoding: 'utf8' });

test('every lean router and required skill exists in the package', () => {
  const shipped = new Set(core.shippedSkills(ROOT));
  const d = lean.def(ROOT);
  const all = [...d.routers, ...Object.values(d.required).flat()];
  assert.deepStrictEqual(all.filter((n) => !shipped.has(n)), []);
  assert.strictEqual(new Set(all).size, all.length, 'no duplicates');
  for (const n of ['find-skill', 'ask-tim', 'aos-store', 'aos-setup', 'aos-update', 'bdb-updater', 'fabric', 'plan-canvas', 'agenttrail', 'clear-context', 'gogate', 'advisor']) assert.ok(d.routers.includes(n), n);
});

test('groups: category groups plus playbooks and fabric', () => {
  const gm = lean.groupMap(ROOT);
  for (const g of ['design-ui-ux', 'engineering-method', 'media-eventtech', 'bdb-core', 'saas-ops', 'library', 'playbooks', 'fabric']) assert.ok(gm[g] && gm[g].length, g);
  assert.ok(gm.playbooks.every((n) => n.startsWith('pb-')));
  const keep = lean.keepSet('groups', ROOT, { groups: ['playbooks'] });
  assert.ok(keep.has('pb-ship') && keep.has('find-skill') && !keep.has('tdd'));
  assert.ok(!lean.keepSet('lean', ROOT, { groups: ['playbooks'] }).has('pb-bug-fix'), 'lean ignores groups');
  const ex = lean.excluded('groups', ROOT, { groups: ['playbooks'] });
  assert.ok(!ex.includes('pb-bug-fix') && ex.includes('tdd'));
  assert.deepStrictEqual(lean.excluded('full', ROOT), []);
});

test('smart: top N from a fixture transcript dir, old and router and unknown names ignored', () => {
  const h = mk();
  const dir = path.join(h, '.claude', 'projects', 'proj');
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 90 * 86400000).toISOString();
  const skill = (n, ts = now) => JSON.stringify({ timestamp: ts, message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: n } }] } });
  const cmd = (n) => JSON.stringify({ timestamp: now, message: { content: `<command-name>/${n}</command-name>` } });
  fs.writeFileSync(path.join(dir, 's.jsonl'), [
    ...Array(5).fill(skill('tdd')), ...Array(3).fill(skill('debugger')), skill('systematic-debugging'), cmd('systematic-debugging'),
    ...Array(9).fill(skill('fabric')), ...Array(9).fill(skill('not-a-real-skill')), ...Array(9).fill(skill('python-pro', old)), skill('bdb-aos:brainstorm'), 'not json "Skill"',
  ].join('\n'));
  const top = lean.topPicks(h, ROOT, 2);
  assert.deepStrictEqual(top, ['tdd', 'debugger']);
  assert.deepStrictEqual(lean.topPicks(h, ROOT, 25).slice(0, 3), ['tdd', 'debugger', 'systematic-debugging']);
  assert.ok(!lean.topPicks(h, ROOT, 25).includes('python-pro'));
  // refresh stores picks only in smart mode
  profile.writeSettings(h, { skillLibrary: 'smart', skillTopN: 2 });
  assert.deepStrictEqual(lean.refreshPicks(h, ROOT), ['tdd', 'debugger']);
  assert.deepStrictEqual(profile.readSettings(h, () => {}).skillPicks, ['tdd', 'debugger']);
  const keep = lean.keepSet('smart', ROOT, lean.optsOf(profile.readSettings(h, () => {})));
  assert.ok(keep.has('tdd') && keep.has('debugger') && !keep.has('python-pro'));
});

test('smart: no usage data falls back to routers plus groups', () => {
  const h = mk();
  assert.deepStrictEqual(lean.topPicks(h, ROOT), []);
  assert.deepStrictEqual(lean.excluded('smart', ROOT, { groups: [], picks: [] }), lean.excluded('lean', ROOT));
  const withGroup = lean.excluded('smart', ROOT, { groups: ['fabric'], picks: [] });
  assert.ok(withGroup.length < lean.excluded('lean', ROOT).length);
});

test('ask-once: asked once, marker set, never when unattended or without UI', async () => {
  const h = mk();
  const calls = [];
  const ui = { select: async (m, o) => { calls.push(m); return 'groups'; }, multi: async () => ['playbooks', 'bogus'] };
  assert.strictEqual(await lean.askOnce({ home: h, ui, root: ROOT, unattended: true }), null);
  assert.strictEqual(await lean.askOnce({ home: h, ui: {}, root: ROOT }), null);
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(profile.readSettings(h, () => {}).skillLibraryAsked, undefined);
  assert.strictEqual(await lean.askOnce({ home: h, ui, root: ROOT }), 'groups');
  const st = profile.readSettings(h, () => {});
  assert.deepStrictEqual([st.skillLibrary, st.skillGroups, st.skillLibraryAsked], ['groups', ['playbooks'], true]);
  assert.strictEqual(await lean.askOnce({ home: h, ui, root: ROOT }), null);
  assert.match(calls[0], /smart \(recommended/);
  assert.strictEqual(calls.length, 1);
});

test('optimize prompt: hint only without a TTY, asked once with one', async () => {
  const h = mk();
  const out = [];
  let asked = 0;
  const ui = { select: async () => { asked++; return 'yes'; } };
  assert.strictEqual(await optimize.optimizeOnce({ home: h, ui, tty: false, write: (s) => out.push(s) }), 'hint');
  assert.strictEqual(await optimize.optimizeOnce({ home: h, ui, tty: true, unattended: true, write: (s) => out.push(s) }), 'hint');
  assert.strictEqual(asked, 0);
  assert.strictEqual(profile.readSettings(h, () => {}).optimizeAsked, undefined);
  assert.strictEqual(await optimize.optimizeOnce({ home: h, ui, tty: true, dryRun: true, write: () => {} }), null);
  assert.strictEqual(await optimize.optimizeOnce({ home: h, ui, tty: true, write: (s) => out.push(s) }), 'asked-yes');
  assert.strictEqual(profile.readSettings(h, () => {}).context, 'full');
  assert.strictEqual(await optimize.optimizeOnce({ home: h, ui, tty: true, write: () => {} }), null);
  assert.strictEqual(asked, 1);
  // already optimized (context set and router file present): nothing to ask
  const h2 = mk();
  profile.writeSettings(h2, { context: 'worker' });
  fs.mkdirSync(path.join(h2, '.aos'), { recursive: true });
  fs.writeFileSync(path.join(h2, '.aos', 'router.json'), '{}');
  assert.strictEqual(await optimize.optimizeOnce({ home: h2, ui, tty: true, write: () => {} }), null);
});

test('seedFresh: fresh installs become lean, existing installs stay full', () => {
  const fresh = mk();
  assert.strictEqual(lean.seedFresh(fresh, { dryRun: true }), 'lean');
  assert.strictEqual(profile.readSettings(fresh, () => {}).skillLibrary, undefined, 'dry-run writes nothing');
  assert.strictEqual(lean.seedFresh(fresh), 'lean');
  assert.strictEqual(profile.readSettings(fresh, () => {}).skillLibrary, 'lean');
  const old = mk();
  fs.mkdirSync(path.join(old, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(old, '.agents', '.bdb-manifest.json'), '{"version":"1.0.0"}');
  assert.strictEqual(lean.seedFresh(old), 'full');
});

test('lean end to end: fresh lean install, full->lean retire, store install, lean->full, dry-run', () => {
  const R = roots();
  const leanNames = [...lean.leanSet(ROOT)].sort();

  // 1. full install
  profile.writeSettings(HOME, { skillLibrary: 'full' });
  installer.applyInstallOptions(HOME);
  assert.deepStrictEqual(installer.quickUpdateKernel(installer.detectInstallState()).filter((f) => !/agy plugin/.test(f)), []);
  installer.flushSessionManifest();
  const fullCount = names(R.agents).length;
  assert.ok(fullCount > 200);
  assert.ok(names(R.claude).length >= fullCount);
  assert.strictEqual(names(R.codex).length, 0, 'Codex reads ~/.agents/skills, no .codex copy');

  // user skill and an edited AOS skill must survive the switch
  for (const r of [R.agents, R.claude]) {
    fs.mkdirSync(path.join(r, 'my-own-skill'), { recursive: true });
    fs.writeFileSync(path.join(r, 'my-own-skill', 'SKILL.md'), '---\nname: my-own-skill\n---\nmine\n');
  }
  const edited = path.join(R.claude, 'tdd', 'SKILL.md');
  fs.appendFileSync(edited, '\nMy own edit.\n');

  // 2. dry-run changes nothing
  const out = [];
  const host = installer;
  const dry = lean.command(['lean'], host, { home: HOME, write: (s) => out.push(s), dryRun: true });
  return dry.then((code) => {
    assert.strictEqual(code, 0);
    assert.match(out.join(''), /dry-run/);
    assert.strictEqual(names(R.agents).length, fullCount + 1);
    assert.strictEqual(profile.readSettings(HOME, () => {}).skillLibrary, 'full');

    // 3. full -> lean
    return lean.command(['lean'], host, { home: HOME, write: () => {} });
  }).then(() => {
    for (const k of ['agents', 'claude', 'opencode', 'agy']) {
      const got = names(R[k]).filter((n) => n !== 'my-own-skill' && n !== 'tdd');
      assert.deepStrictEqual(got.sort(), leanNames, `${k} keeps only the routers`);
    }
    assert.strictEqual(names(R.codex).length, 0);
    assert.ok(fs.existsSync(path.join(R.agents, 'my-own-skill', 'SKILL.md')), 'user skill survives');
    assert.ok(fs.readFileSync(edited, 'utf8').includes('My own edit.'), 'edited AOS skill survives');
    assert.ok(!fs.existsSync(path.join(R.agents, 'tdd')), 'unedited copy retired');
    // unedited copies are byte-identical to the library; edited ones are kept whole, so nothing needs a backup copy
    assert.ok(fs.existsSync(path.join(HOME, '.aos', 'library', 'skills', 'python-pro', 'SKILL.md')), 'library keeps everything');

    // 4. on demand install
    const r1 = storeCli(['install', 'python-pro']);
    assert.strictEqual(r1.status, 0, r1.stderr);
    for (const k of ['agents', 'claude', 'agy', 'opencode']) assert.ok(fs.existsSync(path.join(R[k], 'python-pro', 'SKILL.md')), k);
    const r2 = storeCli(['install', 'golang-pro', '--harness=claude']);
    assert.strictEqual(r2.status, 0, r2.stderr);
    assert.ok(fs.existsSync(path.join(R.claude, 'golang-pro', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(R.agents, 'golang-pro')));

    // a later switch keeps store installs
    installer.applySkillLibrary('lean');
    assert.ok(fs.existsSync(path.join(R.agents, 'python-pro', 'SKILL.md')), 'store install protected');

    // 5. lean -> full restores everything
    return lean.command(['full'], host, { home: HOME, write: () => {} });
  }).then(() => {
    assert.strictEqual(names(R.agents).filter((n) => n !== 'my-own-skill').length, fullCount);
    assert.ok(fs.existsSync(path.join(R.agents, 'tdd', 'SKILL.md')));
    assert.strictEqual(profile.readSettings(HOME, () => {}).skillLibrary, 'full');
  });
});

test('fresh lean install gives only routers in every harness', () => {
  const h = mk();
  const R = roots(h);
  // The installer module is bound to the first HOME, so run a child process with the fresh one.
  for (const d of ['.claude', '.gemini/config', '.codex', '.config/opencode']) fs.mkdirSync(path.join(h, d), { recursive: true });
  profile.writeSettings(h, { skillLibrary: 'lean' });
  const code = `process.env.AOS_TEST_SANDBOX='1';const i=require(${JSON.stringify(path.join(ROOT, 'installer.js'))});i.applyInstallOptions(process.env.HOME);const f=i.quickUpdateKernel(i.detectInstallState());process.exit(f.filter(x=>!/agy plugin/.test(x)).length?1:0)`;
  const r = spawnSync(process.execPath, ['-e', code], { env: { ...process.env, HOME: h, USERPROFILE: h }, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr + r.stdout.slice(-500));
  const leanNames = [...lean.leanSet(ROOT)].sort();
  for (const k of ['agents', 'claude', 'agy', 'opencode']) assert.deepStrictEqual(names(R[k]).sort(), leanNames, k);
  assert.strictEqual(names(R.codex).length, 0);
});
