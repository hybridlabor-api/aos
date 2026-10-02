const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'build-plugin-manifest.mjs');
const EXPECTED = ['setup', 'init', 'doctor', 'store', 'mastersession', 'orchestrator', 'plan', 'brainstorm',
  'startproject', 'graph', 'shipping', 'memb', 'playbooks', 'loop'];
const source = JSON.parse(readFileSync(join(ROOT, 'plugin-commands.json'), 'utf8'));

const check = (file) => execFileSync('node', [SCRIPT, '--check'], {
  cwd: ROOT, encoding: 'utf8', stdio: 'pipe',
  env: { ...process.env, ...(file ? { AOS_PLUGIN_COMMANDS: file } : {}) },
});
const withCommands = (mutate) => {
  const copy = structuredClone(source);
  mutate(copy.commands);
  const file = join(mkdtempSync(join(tmpdir(), 'aos-cmds-')), 'plugin-commands.json');
  writeFileSync(file, JSON.stringify(copy));
  return file;
};

test('source defines exactly the planned commands, each with a claude body', () => {
  assert.deepEqual(Object.keys(source.commands).sort(), [...EXPECTED].sort());
  for (const [name, def] of Object.entries(source.commands)) {
    assert.ok(def.description.trim(), `${name} description`);
    assert.ok(def.bodies.claude.trim(), `${name} claude body`);
  }
});

test('both manifests list the generated command files', () => {
  for (const path of ['.claude-plugin/plugin.json', 'plugins/bdb-aos/.claude-plugin/plugin.json']) {
    const manifest = JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
    assert.deepEqual(manifest.commands, EXPECTED.slice().sort().map((n) => `./commands/${n}.md`));
    for (const entry of manifest.commands) assert.ok(readFileSync(join(ROOT, entry), 'utf8').startsWith('---\n'));
  }
});

test('doctor never writes settings', () => {
  assert.match(source.commands.doctor.bodies.claude, /Never write to settings/);
});

test('--check passes on the committed output', () => {
  check();
});

test('--check rejects a command that collides with a skill name', () => {
  const file = withCommands((c) => { c['memb-skill'] = { ...c.memb, skills: [] }; });
  assert.throws(() => check(file), /collides with a skill/);
});

test('--check rejects a missing claude body, empty description and unknown skill', () => {
  assert.throws(() => check(withCommands((c) => { delete c.graph.bodies.claude; })), /no body for claude/);
  assert.throws(() => check(withCommands((c) => { c.graph.description = ' '; })), /empty description/);
  assert.throws(() => check(withCommands((c) => { c.graph.skills = ['no-such-skill']; })), /unknown skill no-such-skill/);
});

test('--check tolerates an unknown skill only when pending C6', () => {
  check(withCommands((c) => { c.loop.skills = ['loop-templates']; c.loop.pending = 'C6'; }));
});

test('--check fails when generated command files are stale', () => {
  const file = withCommands((c) => { c.graph.bodies.claude = 'changed'; });
  assert.throws(() => check(file), /out of date/);
});
