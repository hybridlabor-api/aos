// With the bdb-aos plugin installed, loose ~/.claude/agents copies are retired (backup), edited and
// model-override copies stay, and the harness copy skips plugin-covered agents. Temp HOME only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-dupes-'));
const home = path.join(tmp, 'home');
fs.mkdirSync(home);
process.env.HOME = home;
process.env.USERPROFILE = home;
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.AOS_PLUGIN_MIGRATION;
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const inst = require('../installer.js');
const ROOT = path.join(__dirname, '..');
const shipped = path.join(ROOT, '.claude', 'agents');
const loose = path.join(home, '.claude', 'agents');
const put = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const names = ['architect', 'reviewer', 'techlead'];

function installPlugin() {
  const root = path.join(home, '.claude', 'plugins', 'cache', 'bdb-marketplace', 'bdb-aos', '1.0.0');
  put(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ agents: ['./agents'] }));
  for (const n of names) put(path.join(root, 'agents', `${n}.md`), fs.readFileSync(path.join(shipped, `${n}.md`), 'utf8'));
}
function seedLoose() {
  fs.rmSync(path.join(home, '.agents'), { recursive: true, force: true });
  for (const n of names) put(path.join(loose, `${n}.md`), fs.readFileSync(path.join(shipped, `${n}.md`), 'utf8'));
  put(path.join(loose, 'reviewer.md'), fs.readFileSync(path.join(shipped, 'reviewer.md'), 'utf8') + '\nmy edit\n');
}

test('plugin absent: nothing covered, nothing retired', () => {
  seedLoose();
  assert.deepEqual(inst.pluginCoveredAgentFiles(), []);
  assert.ok(fs.existsSync(path.join(loose, 'architect.md')));
});

test('plugin present: unedited copies retired with backup, edited kept, override kept', () => {
  installPlugin();
  seedLoose();
  put(path.join(home, '.aos', 'pipeline.json'), JSON.stringify({ pipeline: { techlead: { models: { claude: 'haiku' } } } }));
  const covered = inst.pluginCoveredAgentFiles();
  assert.ok(covered.includes('architect.md') && covered.includes('reviewer.md'));
  assert.ok(!covered.includes('techlead.md'), 'override agent still copied');
  assert.ok(!fs.existsSync(path.join(loose, 'architect.md')), 'unedited retired');
  assert.ok(fs.existsSync(path.join(loose, 'reviewer.md')), 'edited stays');
  assert.ok(fs.existsSync(path.join(loose, 'techlead.md')), 'override stays');
  const bdir = path.join(home, '.agents', 'backups');
  const b = fs.readdirSync(bdir).find((d) => d.startsWith('plugin-migration-'));
  assert.ok(fs.existsSync(path.join(bdir, b, '.claude', 'agents', 'architect.md')), 'backed up');
  const pm = require('../lib/plugin-migration.js');
  assert.deepEqual(pm.restoreBackup({ home, backupDir: path.join(bdir, b) }).map((f) => path.basename(f)), ['architect.md']);
});

test('plugin disabled in settings.json: nothing covered', () => {
  put(path.join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'bdb-aos@bdb-marketplace': false } }));
  assert.deepEqual(inst.pluginCoveredAgentFiles(), []);
  fs.rmSync(path.join(home, '.claude', 'settings.json'));
});

test('harness copy excludes the covered agent files', () => {
  const src = fs.readFileSync(path.join(ROOT, 'installer.js'), 'utf8');
  assert.match(src, /\['settings\.json', 'hooks', \.\.\.pluginCoveredAgentFiles\(\)\]/);
});
