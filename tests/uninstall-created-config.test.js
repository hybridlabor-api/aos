const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cfg = require('../lib/gateway/config.js');
const { migrateMemoryDirect } = require('../lib/gateway/migrate-memory.js');
const { reverseRegistrations, recordOpencodePlugin } = require('../lib/uninstall-records.js');
const { fakeComponents } = require('./helpers/memdirect-env.js');

const ROOT = path.resolve(__dirname, '..');
const quiet = () => {};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-uninstall-created-'));
const SCHEMA = 'https://opencode.ai/config.json';
const walk = (dir) => (fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
    : []);

// Gateway copy of the two memory servers, as the installer leaves it before the memory-direct migration.
const seedGateway = (home) => {
    fs.mkdirSync(cfg.gatewayDir(home), { recursive: true });
    fs.writeFileSync(path.join(cfg.gatewayDir(home), 'mcp.json'), JSON.stringify({ mcpServers: { memb_mcp: { command: 'node' }, deja: { command: 'deja' } } }, null, 2));
};

// Fresh HOME, OpenCode present (its config written by the installer, so AOS created it). Migration, then uninstall.
test('fresh home: memory-direct migration then uninstall leaves no AOS file under .config/opencode; the stamp backup stays', () => {
    const home = tmp();
    const env = fakeComponents(home);
    const opencodeDir = path.join(home, '.config', 'opencode');
    const jsonc = path.join(opencodeDir, 'opencode.jsonc');
    fs.mkdirSync(opencodeDir, { recursive: true });
    fs.writeFileSync(jsonc, JSON.stringify({ $schema: SCHEMA, plugin: [], mcp: {} }, null, 2) + '\n');
    seedGateway(home);

    migrateMemoryDirect({ home, aosRoot: ROOT, now: 1792580578094, env, log: quiet });
    const migrated = JSON.parse(fs.readFileSync(jsonc, 'utf8'));
    assert.ok(migrated.mcp.memb_mcp, 'precondition: OpenCode holds memb_mcp');
    assert.ok(migrated.mcp.deja, 'precondition: OpenCode holds deja');
    assert.ok(fs.existsSync(`${jsonc}.aos-memdirect-bak-1792580578094`), 'precondition: memory-direct backup written');

    reverseRegistrations({ home, env, platform: 'darwin' });

    const left = walk(opencodeDir).map((f) => path.basename(f));
    assert.ok(!left.includes('opencode.jsonc'), 'the AOS-only config is removed');
    assert.ok(!left.some((n) => n.includes('aos-memdirect-bak-')), 'the memory-direct backup is archived out of the harness dir');
    assert.ok(left.every((n) => /^opencode\.jsonc\.\d{8}T\d{6}Z\.bak$/.test(n)), `only uninstall stamp backups may remain: ${left}`);
    assert.ok(!left.some((n) => /\.bak\.\d+$/.test(n)), `no .bak.<N> duplicates may remain: ${left}`);
    assert.ok(left.length > 0, 'the uninstall backup of the removed config is kept');
});

// Real uninstall order in one run: the plugin[] entry is removed first (writer 1), then memory-direct removes its
// entries from the same file (writer 2). Both must share one stamp backup; the second used to collide into `.bak.1`.
test('one run, plugin[] removal then memory-direct reverse on one opencode.jsonc: one stamp backup, no .bak.N', () => {
    const home = tmp();
    const env = fakeComponents(home);
    const opencodeDir = path.join(home, '.config', 'opencode');
    const jsonc = path.join(opencodeDir, 'opencode.jsonc');
    const pluginJs = path.join(opencodeDir, 'plugins', 'bdb-aos.js');
    fs.mkdirSync(path.dirname(pluginJs), { recursive: true });
    fs.writeFileSync(pluginJs, '// BDB Agent OS (AOS) plugin for OpenCode\nexport default {};\n');
    fs.writeFileSync(jsonc, JSON.stringify({ $schema: SCHEMA, plugin: [`file://${pluginJs}`], mcp: {} }, null, 2) + '\n');
    recordOpencodePlugin(home, pluginJs);
    seedGateway(home);

    migrateMemoryDirect({ home, aosRoot: ROOT, now: 1792580578094, env, log: quiet });
    assert.ok(JSON.parse(fs.readFileSync(jsonc, 'utf8')).mcp.deja, 'precondition: OpenCode holds deja');

    reverseRegistrations({ home, env, platform: 'darwin' });

    const left = walk(opencodeDir).map((f) => path.basename(f));
    const stamps = left.filter((n) => /^opencode\.jsonc\.\d{8}T\d{6}Z\.bak$/.test(n));
    assert.equal(stamps.length, 1, `exactly one <stamp>.bak beside opencode.jsonc: ${left}`);
    assert.ok(!left.some((n) => /\.bak\.\d+$/.test(n)), `no .bak.<N> duplicate may remain: ${left}`);
    assert.ok(!left.some((n) => n.includes('aos-memdirect-bak-')), `no memory-direct backup may remain beside it: ${left}`);
    // The single backup is the pre-run state: it still has the plugin[] entry and the memory-direct entries.
    const backup = JSON.parse(fs.readFileSync(path.join(opencodeDir, stamps[0]), 'utf8'));
    assert.equal(backup.plugin.length, 1, 'the stamp backup keeps the pre-run plugin[] entry');
    assert.ok(backup.mcp.deja, 'the stamp backup keeps the pre-run deja entry');
});

test('uninstall keeps an OpenCode config the user owns, with the user content intact', () => {
    const home = tmp();
    const env = fakeComponents(home);
    const opencodeDir = path.join(home, '.config', 'opencode');
    const jsonc = path.join(opencodeDir, 'opencode.jsonc');
    fs.mkdirSync(opencodeDir, { recursive: true });
    fs.writeFileSync(jsonc, JSON.stringify({ $schema: SCHEMA, theme: 'dark', plugin: [], mcp: {} }, null, 2) + '\n');
    seedGateway(home);

    migrateMemoryDirect({ home, aosRoot: ROOT, now: 1792580578094, env, log: quiet });
    reverseRegistrations({ home, env, platform: 'darwin' });

    const kept = JSON.parse(fs.readFileSync(jsonc, 'utf8'));
    assert.equal(kept.theme, 'dark', 'the user setting stays');
    assert.equal(kept.mcp.memb_mcp, undefined, 'AOS memory entry is removed');
    assert.equal(kept.mcp.deja, undefined, 'AOS memory entry is removed');
    const left = walk(opencodeDir).map((f) => path.basename(f));
    assert.ok(left.includes('opencode.jsonc'), 'the user file remains');
    const baks = left.filter((n) => n !== 'opencode.jsonc');
    assert.ok(baks.length <= 1, `at most one stamp backup may remain: ${left}`);
    assert.ok(baks.every((n) => /^opencode\.jsonc\.\d{8}T\d{6}Z\.bak$/.test(n)), `only the stamp backup may remain: ${left}`);
    assert.ok(!left.some((n) => /\.bak\.\d+$/.test(n)), `no .bak.<N> duplicates may remain: ${left}`);
    assert.ok(!left.some((n) => n.includes('aos-memdirect-bak-')), `no aos-memdirect-bak file may remain: ${left}`);
});
