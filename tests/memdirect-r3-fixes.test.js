// Regression tests for memory-direct fix round 3: skip paths block the strip, already-stripped installs get the
// gateway copy back, symlinked mcp.json backups stay in the gateway dir, quoted top-level Codex mcp_servers.
// Temp HOME and temp PATH only; no real harness config is read or written.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cfg = require('../lib/gateway/config.js');
const { migrateMemoryDirect, readsGateway } = require('../lib/gateway/migrate-memory.js');
const { removeMcpBackups } = require('../lib/v5/pkg-gateway-remove.js');
const { resolveHarnessPath, HARNESS_ROWS } = require('../lib/mcp-secrets.js');
const { fakeComponents } = require('./helpers/memdirect-env.js');

const ROOT = path.resolve(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-memdirect-r3-'));
const gatewayMcp = (home) => path.join(cfg.gatewayDir(home), 'mcp.json');
const claudeFile = (home) => path.join(home, '.claude.json');
const codexFile = (home) => path.join(home, '.codex', 'config.toml');
const gatewayHasMemory = (home) => {
    const m = JSON.parse(fs.readFileSync(gatewayMcp(home), 'utf8')).mcpServers;
    return { memb: m.memb_mcp !== undefined, deja: m.deja !== undefined };
};
const seedGatewayWithMemory = (home) => {
    fs.mkdirSync(cfg.gatewayDir(home), { recursive: true });
    fs.writeFileSync(gatewayMcp(home), JSON.stringify({ mcpServers: { github: { command: 'npx' }, memb_mcp: { command: 'node' }, deja: { command: 'deja' } } }));
};

// Item 1: an unverified harness file that still carries an aos gateway entry blocks the strip.
test('r3 item 1: an unverified harness file with an aos gateway entry keeps the gateway copy', () => {
    const home = tmp();
    seedGatewayWithMemory(home);
    const env = fakeComponents(home);
    const vscodeRow = HARNESS_ROWS.find((r) => r.id === 'vscode');
    const vscode = resolveHarnessPath(vscodeRow.mcp.global[0], { home, env, platform: 'darwin', cwd: home });
    fs.mkdirSync(path.dirname(vscode), { recursive: true });
    fs.writeFileSync(vscode, JSON.stringify({ servers: { aos: { command: 'aos-mcp' } } }));
    const logs = [];
    const rep = migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env, platform: 'darwin', log: (m) => logs.push(m) });
    assert.equal(rep.gatewayCleaned, false);
    assert.deepStrictEqual(gatewayHasMemory(home), { memb: true, deja: true });
    assert.ok(logs.some((m) => /has an aos gateway entry.*gateway copy kept/.test(m)), 'the blocking harness is named');
});

test('r3 item 1 control: an unverified harness file without an aos entry does not block the strip', () => {
    const home = tmp();
    seedGatewayWithMemory(home);
    const env = fakeComponents(home);
    const vscodeRow = HARNESS_ROWS.find((r) => r.id === 'vscode');
    const vscode = resolveHarnessPath(vscodeRow.mcp.global[0], { home, env, platform: 'darwin', cwd: home });
    fs.mkdirSync(path.dirname(vscode), { recursive: true });
    fs.writeFileSync(vscode, JSON.stringify({ servers: { other: { command: 'x' } } }));
    const rep = migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env, platform: 'darwin', log: () => {} });
    assert.equal(rep.gatewayCleaned, true);
    assert.deepStrictEqual(gatewayHasMemory(home), { memb: false, deja: false });
});

test('r3 item 1: readsGateway recognises JSON, opencode and TOML aos entries only', () => {
    const home = tmp();
    const f = path.join(home, 'x.json');
    fs.writeFileSync(f, '{"mcpServers":{"aos":{}}}');
    assert.equal(readsGateway(f), true);
    fs.writeFileSync(f, '{"mcpServers":{"github":{}}}');
    assert.equal(readsGateway(f), false);
    fs.writeFileSync(f, '[mcp_servers.aos]\ncommand = "x"\n');
    assert.equal(readsGateway(f), true);
    assert.equal(readsGateway(path.join(home, 'absent.json')), false);
});

// Item 2: gateway copy already gone and a harness entry is stale: the copy is re-added, never reported as kept.
test('r3 item 2: an already-stripped gateway gets memb_mcp and deja back when a harness is not confirmed', () => {
    const home = tmp();
    fs.mkdirSync(cfg.gatewayDir(home), { recursive: true });
    fs.writeFileSync(gatewayMcp(home), JSON.stringify({ mcpServers: { github: { command: 'npx' } } }));
    const env = fakeComponents(home);
    fs.writeFileSync(claudeFile(home), JSON.stringify({ mcpServers: { deja: { command: '/gone/old/deja', args: ['mcp'] } } }));
    const logs = [];
    const rep = migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env, log: (m) => logs.push(m) });
    assert.equal(rep.gatewayCleaned, false);
    assert.deepStrictEqual(gatewayHasMemory(home), { memb: true, deja: true });
    assert.ok(logs.some((m) => /re-added/.test(m)), 'the re-add is reported');
    assert.ok(!logs.some((m) => /gateway copy of .* kept/.test(m)), 'no "kept" claim for a re-added copy');
});

test('r3 item 2: with no gateway mcp.json the message says absent, not kept', () => {
    const home = tmp();
    const env = fakeComponents(home);
    fs.writeFileSync(claudeFile(home), JSON.stringify({ mcpServers: { deja: { command: '/gone/old/deja', args: ['mcp'] } } }));
    const logs = [];
    migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env, log: (m) => logs.push(m) });
    assert.ok(logs.some((m) => /absent/.test(m)), 'absent is reported');
    assert.ok(!logs.some((m) => /kept/.test(m)), 'nothing is claimed as kept');
    assert.equal(fs.existsSync(gatewayMcp(home)), false, 'no gateway file is created');
});

// Item 3: symlinked mcp.json. The backup goes next to mcp.json in the gateway dir and uninstall removes it.
test('r3 item 3: a symlinked gateway mcp.json gets its backup inside the gateway dir', () => {
    const home = tmp();
    const target = path.join(home, 'elsewhere', 'mcp-target.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ mcpServers: { github: { command: 'npx' }, memb_mcp: { command: 'node' }, deja: { command: 'deja' } } }));
    fs.mkdirSync(cfg.gatewayDir(home), { recursive: true });
    fs.symlinkSync(target, gatewayMcp(home));
    const env = fakeComponents(home);
    const rep = migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env, log: () => {} });
    assert.equal(rep.gatewayCleaned, true);
    assert.equal(fs.lstatSync(gatewayMcp(home)).isSymbolicLink(), true, 'the link is kept');
    const inDir = fs.readdirSync(cfg.gatewayDir(home)).filter((n) => /^mcp\.json\.aos-memdirect-bak-1/.test(n));
    assert.equal(inDir.length, 1, 'backup is in the gateway dir');
    assert.equal(fs.readdirSync(path.dirname(target)).filter((n) => /bak/.test(n)).length, 0, 'no backup next to the target');
    const gone = removeMcpBackups(cfg.gatewayDir(home), home);
    assert.ok(gone.includes(inDir[0]), 'uninstall removes the backup');
});

// Item 4: a quoted top-level mcp_servers inline table blocks the TOML write, as the bare form does.
for (const key of ['"mcp_servers"', "'mcp_servers'"]) {
    test(`r3 item 4: top-level ${key} = { ... } in config.toml is detected and not written`, () => {
        const home = tmp();
        seedGatewayWithMemory(home);
        const env = fakeComponents(home);
        const original = `${key} = { github = { command = "npx" } }\n`;
        fs.mkdirSync(path.dirname(codexFile(home)), { recursive: true });
        fs.writeFileSync(codexFile(home), original);
        const logs = [];
        const rep = migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env, log: (m) => logs.push(m) });
        assert.equal(rep.gatewayCleaned, false);
        assert.equal(fs.readFileSync(codexFile(home), 'utf8'), original, 'config.toml unchanged');
        assert.ok(logs.some((m) => /top-level inline/.test(m)), 'user is told');
    });
}
