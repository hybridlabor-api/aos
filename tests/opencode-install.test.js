// OpenCode C3: generated /bdb-aos-<cmd> files, edit-safe command install, opt-in extras,
// the lean-MCP rule and the machine-prompt marking of the plugin.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'build-plugin-manifest.mjs');
const OC_DIR = path.join(ROOT, '.opencode', 'commands');
const source = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin-commands.json'), 'utf8'));
const names = Object.keys(source.commands);

const check = (file) => execFileSync('node', [SCRIPT, '--check'], {
  cwd: ROOT, encoding: 'utf8', stdio: 'pipe',
  env: { ...process.env, ...(file ? { AOS_PLUGIN_COMMANDS: file } : {}) },
});
const tmps = [];
test.after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-oc-c3-')); tmps.push(d); return d; };

test('every command has a flat hyphen OpenCode file with no colon names inside', () => {
  for (const name of names) {
    const text = fs.readFileSync(path.join(OC_DIR, `bdb-aos-${name}.md`), 'utf8');
    assert.match(text, /^---\ndescription: ".+"\n---\n\n/);
    assert.ok(!/\/bdb-aos:/.test(text), `${name} still has a colon command name`);
  }
  assert.match(fs.readFileSync(path.join(OC_DIR, 'bdb-aos-init.md'), 'utf8'), /`\/bdb-aos-setup`/);
  assert.match(fs.readFileSync(path.join(OC_DIR, 'bdb-aos-loop.md'), 'utf8'), /OpenCode has no built-in loop/);
  assert.ok(fs.existsSync(path.join(OC_DIR, 'startcycle-graph.md')), 'existing command stays');
});

test('--check passes, and fails when only the opencode body changes', () => {
  check();
  const copy = structuredClone(source);
  copy.commands.setup.bodies.opencode = 'Different OpenCode wording. $ARGUMENTS';
  const file = path.join(tmp(), 'plugin-commands.json');
  fs.writeFileSync(file, JSON.stringify(copy));
  assert.throws(() => check(file), (e) => /\.opencode\/commands\/ is out of date \(bdb-aos-setup\.md\)/.test(e.stderr));
});

test('--check flags a hand-edited and a stale generated file, but not startcycle-graph.md', () => {
  const edited = path.join(OC_DIR, 'bdb-aos-store.md');
  const original = fs.readFileSync(edited, 'utf8');
  const stale = path.join(OC_DIR, 'bdb-aos-zzz-stale.md');
  try {
    fs.writeFileSync(edited, `${original}\nedit\n`);
    assert.throws(() => check(), (e) => /bdb-aos-store\.md/.test(e.stderr));
    fs.writeFileSync(edited, original);
    fs.writeFileSync(stale, 'x');
    assert.throws(() => check(), (e) => /bdb-aos-zzz-stale\.md/.test(e.stderr));
  } finally {
    fs.writeFileSync(edited, original);
    fs.rmSync(stale, { force: true });
  }
  check();
});

test('an empty opencode body is rejected', () => {
  const copy = structuredClone(source);
  copy.commands.setup.bodies.opencode = '  ';
  const file = path.join(tmp(), 'plugin-commands.json');
  fs.writeFileSync(file, JSON.stringify(copy));
  assert.throws(() => check(file), (e) => /empty body for opencode/.test(e.stderr));
});

function install(home, { optional = [], argv = [], env = {} } = {}) {
  const cfg = path.join(home, '.config', 'opencode', 'opencode.jsonc');
  const code = `const i = require(${JSON.stringify(path.join(ROOT, 'installer.js'))});` +
    `i.installOpencodePlugin({ targetHome: ${JSON.stringify(home)}, configPath: ${JSON.stringify(cfg)}, optional: ${optional === null ? 'undefined' : `new Set(${JSON.stringify(optional)})`} });`;
  const res = spawnSync(process.execPath, ['-e', code, '--', ...argv], {
    encoding: 'utf8', timeout: 30000,
    env: { PATH: process.env.PATH, HOME: home, ...env },
  });
  assert.equal(res.status, 0, res.stderr);
  return { out: res.stdout + res.stderr, cfg, cmdDir: path.join(home, '.config', 'opencode', 'commands') };
}
const readCfg = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

test('install writes every command, is idempotent, and keeps foreign files', () => {
  const home = tmp();
  const cmdDir = path.join(home, '.config', 'opencode', 'commands');
  fs.mkdirSync(cmdDir, { recursive: true });
  fs.writeFileSync(path.join(cmdDir, 'mine.md'), 'user command');
  install(home);
  for (const name of names) assert.ok(fs.existsSync(path.join(cmdDir, `bdb-aos-${name}.md`)), name);
  const snap = () => Object.fromEntries(fs.readdirSync(cmdDir).map((f) => [f, fs.statSync(path.join(cmdDir, f)).mtimeMs]));
  const before = snap();
  install(home);
  assert.deepEqual(snap(), before, 'second run changes nothing');
  assert.equal(fs.readFileSync(path.join(cmdDir, 'mine.md'), 'utf8'), 'user command');
  assert.ok(!fs.readdirSync(cmdDir).some((f) => f.endsWith('.new')));
});

test('a user-edited command is kept and the shipped copy lands as .new', () => {
  const home = tmp();
  const { cmdDir } = install(home);
  const file = path.join(cmdDir, 'bdb-aos-graph.md');
  fs.writeFileSync(file, 'my version');
  const { out } = install(home);
  assert.equal(fs.readFileSync(file, 'utf8'), 'my version');
  assert.equal(fs.readFileSync(`${file}.new`, 'utf8'), fs.readFileSync(path.join(OC_DIR, 'bdb-aos-graph.md'), 'utf8'));
  assert.match(out, /KEPT/);
});

test('an untracked file with a shipped name is kept, not overwritten', () => {
  const home = tmp();
  const cmdDir = path.join(home, '.config', 'opencode', 'commands');
  fs.mkdirSync(cmdDir, { recursive: true });
  fs.writeFileSync(path.join(cmdDir, 'bdb-aos-memb.md'), 'older hand-written');
  install(home);
  assert.equal(fs.readFileSync(path.join(cmdDir, 'bdb-aos-memb.md'), 'utf8'), 'older hand-written');
  assert.ok(fs.existsSync(path.join(cmdDir, 'bdb-aos-memb.md.new')));
});

test('an outdated unmodified command is updated', () => {
  const home = tmp();
  const { cmdDir } = install(home);
  const file = path.join(cmdDir, 'bdb-aos-doctor.md');
  const manifestPath = path.join(home, '.agents', '.bdb-install-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  fs.writeFileSync(file, 'old shipped');
  manifest[file].sha256 = require('node:crypto').createHash('sha256').update('old shipped').digest('hex');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  install(home);
  assert.equal(fs.readFileSync(file, 'utf8'), fs.readFileSync(path.join(OC_DIR, 'bdb-aos-doctor.md'), 'utf8'));
});

test('optional components are off by default', () => {
  const home = tmp();
  const { cfg, out } = install(home);
  const plugins = readCfg(cfg).plugin;
  assert.equal(plugins.length, 1);
  assert.match(plugins[0], /bdb-aos\.js$/);
  assert.ok(!/brew install rtk|loop-shell/.test(out));
  assert.deepEqual(fs.readdirSync(path.dirname(cfg)).filter((f) => f.endsWith('.bak')), []);
});

test('opt-in appends pinned entries after a backup, once, and warns about loop-shell', () => {
  const home = tmp();
  const cfgDir = path.join(home, '.config', 'opencode');
  fs.mkdirSync(cfgDir, { recursive: true });
  const cfg = path.join(cfgDir, 'opencode.jsonc');
  fs.writeFileSync(cfg, JSON.stringify({ model: 'x/y', plugin: ['some-other'] }));
  const first = install(home, { optional: ['ponytail', 'loop', 'rtk', 'bogus'] });
  const plugins = readCfg(cfg).plugin;
  assert.ok(plugins.includes('some-other'));
  assert.ok(plugins.includes('@dietrichgebert/ponytail@4.10.0'));
  assert.ok(plugins.includes('@bybrawe/opencode-loop@0.6.2'));
  assert.ok(!plugins.some((p) => /rtk/.test(p)), 'rtk is a hint only');
  assert.match(first.out, /brew install rtk && rtk init -g --opencode/);
  assert.match(first.out, /go-gate, may never see them/);
  assert.match(first.out, /Unknown OpenCode optional component "bogus"/);
  const baks = fs.readdirSync(cfgDir).filter((f) => f.includes('.bak'));
  assert.equal(baks.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(cfgDir, baks[0]), 'utf8')).plugin.length, 1, 'backup holds the pre-change config');
  install(home, { optional: ['ponytail', 'loop'] });
  assert.deepEqual(readCfg(cfg).plugin, plugins, 'second run adds nothing');
});

test('opt-in via env var and --opencode-optional flag; an existing other pin is not duplicated', () => {
  const home = tmp();
  const cfgDir = path.join(home, '.config', 'opencode');
  fs.mkdirSync(cfgDir, { recursive: true });
  const cfg = path.join(cfgDir, 'opencode.jsonc');
  fs.writeFileSync(cfg, JSON.stringify({ plugin: ['@dietrichgebert/ponytail@4.9.0'] }));
  install(home, { optional: null, env: { AOS_OPENCODE_OPTIONAL: 'ponytail,loop' } });
  const plugins = readCfg(cfg).plugin;
  assert.equal(plugins.filter((p) => /ponytail/.test(p)).length, 1);
  assert.ok(plugins.includes('@dietrichgebert/ponytail@4.9.0'));
  assert.ok(plugins.includes('@bybrawe/opencode-loop@0.6.2'));
  const home2 = tmp();
  const r = install(home2, { optional: null, argv: ['--opencode-optional=ponytail'] });
  assert.ok(readCfg(r.cfg).plugin.includes('@dietrichgebert/ponytail@4.10.0'));
});

test('lean-MCP rule: the plugin install leaves OpenCode mcp keys untouched, opt-ins included', () => {
  const home = tmp();
  const cfgDir = path.join(home, '.config', 'opencode');
  fs.mkdirSync(cfgDir, { recursive: true });
  const cfg = path.join(cfgDir, 'opencode.jsonc');
  const mcp = {
    memb_mcp: { type: 'local', command: ['memb'], enabled: true },
    deja: { type: 'local', command: ['deja'], enabled: false },
    zavora_computer_use: { type: 'local', command: ['z'], enabled: true },
  };
  fs.writeFileSync(cfg, JSON.stringify({ mcp }));
  install(home, { optional: ['ponytail', 'loop', 'rtk'] });
  assert.deepEqual(readCfg(cfg).mcp, mcp);
  const home2 = tmp();
  const r = install(home2);
  assert.equal(readCfg(r.cfg).mcp, undefined, 'no mcp key is invented');
});

test('the installer never runs foreign installers', () => {
  const lines = fs.readFileSync(path.join(ROOT, 'installer.js'), 'utf8').split('\n');
  const risky = lines.filter((l) => !l.trim().startsWith('//') && /opencode-loop|ponytail|rtk init|orca-opencode-status|dag\.jsonc/.test(l)
    && /npx|execSync|execFileSync|spawn|exec\(/.test(l));
  assert.deepEqual(risky, []);
});

test('every machine-sent session.prompt in the plugin is synthetic and marked aos_*', () => {
  const src = fs.readFileSync(path.join(ROOT, '.opencode', 'plugins', 'bdb-aos.js'), 'utf8');
  const calls = [...src.matchAll(/client\.session\.prompt\(/g)];
  assert.ok(calls.length >= 2, 'bus wake and loop nudge');
  for (const m of calls) {
    const window = src.slice(m.index - 700, m.index + 900);
    assert.match(window, /synthetic: true/, 'prompt part must be synthetic');
    assert.match(window, /metadata[^\n]*aos_(bus|loop)|aos_(bus|loop)/, 'prompt part must carry aos_bus or aos_loop');
  }
});

test('a second spelling of the bdb-aos.js path is reported', () => {
  const home = tmp();
  const cfgDir = path.join(home, '.config', 'opencode');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(path.join(cfgDir, 'opencode.jsonc'), JSON.stringify({ plugin: ['/elsewhere/repo/.opencode/plugins/bdb-aos.js'] }));
  assert.match(install(home).out, /lists bdb-aos\.js under another path/);
  const clean = tmp();
  assert.ok(!/another path/.test(install(clean).out));
});

const PERM = { '~/.agents/**': 'allow', '~/.config/opencode/**': 'allow' };
function permHome(cfgObj, raw) {
  const home = tmp();
  const cfgDir = path.join(home, '.config', 'opencode');
  fs.mkdirSync(cfgDir, { recursive: true });
  const cfg = path.join(cfgDir, 'opencode.jsonc');
  fs.writeFileSync(cfg, raw ?? JSON.stringify(cfgObj));
  return { home, cfg, cfgDir, baks: () => fs.readdirSync(cfgDir).filter((f) => f.includes('.bak')) };
}
const permEnv = { AOS_OPENCODE_PERMISSION: 'external_directory' };

test('permission opt-in is off by default', () => {
  const h = permHome({ model: 'x/y' });
  install(h.home);
  assert.equal(readCfg(h.cfg).permission, undefined);
});

test('permission opt-in adds only external_directory, leaves mcp, is idempotent', () => {
  const mcp = { memb_mcp: { type: 'local', command: ['memb'], enabled: true } };
  const h = permHome({ mcp, permission: { bash: 'allow' } });
  install(h.home, { optional: null, env: permEnv });
  const c = readCfg(h.cfg);
  assert.deepEqual(c.permission, { bash: 'allow', external_directory: PERM });
  assert.deepEqual(c.mcp, mcp);
  assert.equal(h.baks().length, 1);
  const before = fs.readFileSync(h.cfg, 'utf8');
  install(h.home, { optional: null, env: permEnv });
  assert.equal(fs.readFileSync(h.cfg, 'utf8'), before);
  assert.equal(h.baks().length, 1);
});

test('permission opt-in via flag creates the permission block', () => {
  const h = permHome({});
  install(h.home, { optional: null, argv: ['--opencode-permission=external_directory'] });
  assert.deepEqual(readCfg(h.cfg).permission, { external_directory: PERM });
});

test('an existing external_directory is kept and noted', () => {
  const h = permHome({ permission: { external_directory: 'allow' } });
  const r = install(h.home, { optional: null, env: permEnv });
  assert.equal(readCfg(h.cfg).permission.external_directory, 'allow');
  assert.match(r.out, /left untouched/);
  assert.equal(h.baks().length, 0);
});

test('a string-shorthand permission is refused, not clobbered', () => {
  const h = permHome({ permission: 'allow' });
  const r = install(h.home, { optional: null, env: permEnv });
  assert.equal(readCfg(h.cfg).permission, 'allow');
  assert.match(r.out, /not an object/);
});

test('JSONC input is parsed; unparseable config is refused', () => {
  const h = permHome(null, '{\n  // note\n  "model": "x/y", /* c */\n  "plugin": [],\n}\n');
  install(h.home, { optional: null, env: permEnv });
  const c = readCfg(h.cfg);
  assert.equal(c.model, 'x/y');
  assert.deepEqual(c.permission, { external_directory: PERM });
  const bad = permHome(null, '{ "model": ');
  const r = install(bad.home, { optional: null, env: permEnv });
  assert.match(r.out, /Could not parse/);
  assert.equal(readCfg(bad.cfg).permission, undefined);
});
