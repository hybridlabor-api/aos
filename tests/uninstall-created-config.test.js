const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cfg = require('../lib/gateway/config.js');
const { migrateMemoryDirect } = require('../lib/gateway/migrate-memory.js');
const { reverseRegistrations } = require('../lib/uninstall-records.js');
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
test('fresh home: memory-direct migration then uninstall leaves no file under .config/opencode that AOS created', () => {
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

    assert.deepStrictEqual(walk(opencodeDir), [], 'nothing AOS created is left in .config/opencode');
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
    assert.deepStrictEqual(walk(opencodeDir).map((f) => path.basename(f)), ['opencode.jsonc'], 'only the user file remains');
});
