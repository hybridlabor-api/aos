const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cfg = require('../lib/gateway/config.js');
const { migrateMemoryDirect } = require('../lib/gateway/migrate-memory.js');
const { pruneBackups } = require('../lib/gateway/harness.js');
const { reverseMemoryDirect, readRecords } = require('../lib/uninstall-records.js');
const { fakeComponents } = require('./helpers/memdirect-env.js');

const ROOT = path.resolve(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-memdirect-uninstall-'));
const quiet = () => {};
const seedGateway = (home) => {
    fs.mkdirSync(cfg.gatewayDir(home), { recursive: true });
    fs.writeFileSync(path.join(cfg.gatewayDir(home), 'mcp.json'), JSON.stringify({ mcpServers: { github: { type: 'stdio', command: 'npx' }, memb_mcp: { command: 'node' }, deja: { command: 'deja' } } }, null, 2));
};

// Item 6: uninstall removes exactly the memory entries the migration added, keeps the user's own, and prunes backups.
test('item 6: uninstall removes the migrated memb_mcp and deja entries from JSON and Codex TOML and keeps foreign entries', () => {
    const home = tmp();
    seedGateway(home);
    const claude = path.join(home, '.claude.json');
    fs.writeFileSync(claude, JSON.stringify({ mcpServers: { github: { command: 'gh-mcp' } } }));
    const codex = path.join(home, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(codex), { recursive: true });
    fs.writeFileSync(codex, '[model]\nname = "x"\n\n[mcp_servers.github]\ncommand = "gh-mcp"\n');
    migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env: fakeComponents(home), log: quiet });
    assert.ok(JSON.parse(fs.readFileSync(claude, 'utf8')).mcpServers.memb_mcp, 'precondition: Claude holds memb_mcp');
    assert.match(fs.readFileSync(codex, 'utf8'), /\[mcp_servers\.deja\]/, 'precondition: Codex holds deja');
    assert.equal(reverseMemoryDirect({ home }).length, 2);
    assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(claude, 'utf8')).mcpServers), ['github']);
    const toml = fs.readFileSync(codex, 'utf8');
    assert.doesNotMatch(toml, /mcp_servers\.(deja|memb_mcp)/);
    assert.match(toml, /\[mcp_servers\.github\]/);
    assert.match(toml, /\[model\]/);
    assert.equal(readRecords(home).memoryDirect, undefined, 'record cleared after a complete reversal');
});

test('item 6: uninstall keeps an entry the user changed (command no longer the one AOS wrote)', () => {
    const home = tmp();
    seedGateway(home);
    const claude = path.join(home, '.claude.json');
    fs.writeFileSync(claude, JSON.stringify({ mcpServers: {} }));
    migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env: fakeComponents(home), log: quiet });
    const data = JSON.parse(fs.readFileSync(claude, 'utf8'));
    data.mcpServers.deja.command = '/elsewhere/deja';
    fs.writeFileSync(claude, JSON.stringify(data));
    reverseMemoryDirect({ home });
    const c = JSON.parse(fs.readFileSync(claude, 'utf8')).mcpServers;
    assert.equal(c.deja.command, '/elsewhere/deja', 'changed entry stays');
    assert.equal(c.memb_mcp, undefined, 'unchanged AOS entry is removed');
});

test('item 6: memory-direct backups are pruned like gateway backups (oldest and newest stay)', () => {
    const home = tmp();
    const file = path.join(home, '.claude.json');
    fs.writeFileSync(file, '{}');
    for (const t of [100, 200, 300]) fs.writeFileSync(`${file}.aos-memdirect-bak-${t}`, '{}');
    const arch = path.join(home, 'archive');
    const moved = pruneBackups(file, arch);
    assert.deepStrictEqual(fs.readdirSync(home).filter((n) => n.includes('aos-memdirect-bak-')).sort(), ['.claude.json.aos-memdirect-bak-100', '.claude.json.aos-memdirect-bak-300']);
    assert.deepStrictEqual(fs.readdirSync(arch), ['.claude.json.aos-memdirect-bak-200']);
    assert.equal(moved.length, 1);
});
