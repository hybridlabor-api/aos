// Regression tests for the pre-merge review r2 findings on fix/54-memory-direct (A1, A2 and the should-fix items).
// Temp HOME and temp PATH only; no real harness config is read or written.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cfg = require('../lib/gateway/config.js');
const { migrateMemoryDirect, codexHas } = require('../lib/gateway/migrate-memory.js');
const { pruneBackups } = require('../lib/gateway/harness.js');
const { removeMcpBackups } = require('../lib/v5/pkg-gateway-remove.js');
const { reverseMemoryDirect } = require('../lib/uninstall-records.js');
const { parseCodexTables, resolveHarnessPath, HARNESS_ROWS } = require('../lib/mcp-secrets.js');
const { fakeComponents } = require('./helpers/memdirect-env.js');

const ROOT = path.resolve(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-memdirect-r2-'));
const quiet = () => {};
const gatewayMcp = (home) => path.join(cfg.gatewayDir(home), 'mcp.json');
const seedGateway = (home, target = gatewayMcp(home)) => {
    fs.mkdirSync(cfg.gatewayDir(home), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ mcpServers: { github: { type: 'stdio', command: 'npx' }, memb_mcp: { command: 'node' }, deja: { command: 'deja' } } }, null, 2));
};
const gatewayHasMemory = (home) => {
    const m = JSON.parse(fs.readFileSync(gatewayMcp(home), 'utf8')).mcpServers;
    return { memb: m.memb_mcp !== undefined, deja: m.deja !== undefined };
};
const claudeFile = (home) => path.join(home, '.claude.json');
const codexFile = (home) => path.join(home, '.codex', 'config.toml');

// A1: an entry that is present but runs another command is not confirmed; the gateway copy stays.
test('A1: a dead-command deja already in the harness keeps the gateway copy and is reported', () => {
    const home = tmp();
    seedGateway(home);
    const env = fakeComponents(home);
    fs.writeFileSync(claudeFile(home), JSON.stringify({ mcpServers: { deja: { command: '/gone/old/deja', args: ['mcp'] } } }));
    const logs = [];
    const rep = migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env, log: (m) => logs.push(m) });
    assert.equal(rep.gatewayCleaned, false, 'gateway copy must not be stripped');
    assert.deepStrictEqual(gatewayHasMemory(home), { memb: true, deja: true });
    assert.equal(rep.stale.length, 1);
    assert.deepStrictEqual(rep.stale[0].names, ['deja']);
    assert.ok(logs.some((m) => /deja already defined with another command/.test(m)), 'user is told');
    const c = JSON.parse(fs.readFileSync(claudeFile(home), 'utf8')).mcpServers;
    assert.equal(c.deja.command, '/gone/old/deja', 'the stale entry is not overwritten');
});

test('A1: a matching command is confirmed, so the gateway copy goes', () => {
    const home = tmp();
    seedGateway(home);
    const env = fakeComponents(home);
    const deja = path.join(home, 'fake-bin', 'deja');
    fs.writeFileSync(claudeFile(home), JSON.stringify({ mcpServers: { deja: { command: deja, args: ['mcp'] } } }));
    const rep = migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env, log: quiet });
    assert.equal(rep.stale.length, 0);
    assert.equal(rep.gatewayCleaned, true);
    assert.deepStrictEqual(gatewayHasMemory(home), { memb: false, deja: false });
});

test('A1: an opencode entry with enabled:false is not confirmed', () => {
    const home = tmp();
    seedGateway(home);
    const env = fakeComponents(home);
    const row = HARNESS_ROWS.find((r) => r.verified === true && r.hint === 'opencode');
    const file = resolveHarnessPath(row.mcp.global[0], { home, env, platform: process.platform, cwd: home });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ mcp: { deja: { type: 'local', command: [path.join(home, 'fake-bin', 'deja'), 'mcp'], enabled: false } } }));
    const rep = migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env, log: quiet });
    assert.equal(rep.gatewayCleaned, false);
    assert.deepStrictEqual(gatewayHasMemory(home), { memb: true, deja: true });
    assert.deepStrictEqual(rep.stale[0].names, ['deja']);
});

// A2: a top-level inline mcp_servers table must not get appended [mcp_servers.x] tables.
test('A2: a top-level inline mcp_servers table is refused; config.toml is unchanged and the gateway copy stays', () => {
    const home = tmp();
    seedGateway(home);
    const env = fakeComponents(home);
    const inline = 'mcp_servers = { github = { command = "gh-mcp" } }\n';
    fs.mkdirSync(path.dirname(codexFile(home)), { recursive: true });
    fs.writeFileSync(codexFile(home), inline);
    const rep = migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env, log: quiet });
    assert.equal(fs.readFileSync(codexFile(home), 'utf8'), inline);
    assert.equal(rep.failed.length, 1);
    assert.match(rep.failed[0].error, /inline mcp_servers/);
    assert.deepStrictEqual(gatewayHasMemory(home), { memb: true, deja: true });
});

test('A2: a Codex config with ordinary tables gets valid, parseable entries', () => {
    const home = tmp();
    seedGateway(home);
    const env = fakeComponents(home);
    fs.mkdirSync(path.dirname(codexFile(home)), { recursive: true });
    fs.writeFileSync(codexFile(home), '[model]\nname = "x"\n\n[mcp_servers.github]\ncommand = "gh-mcp"\n');
    const rep = migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env, log: quiet });
    assert.equal(rep.failed.length, 0);
    const t = parseCodexTables(fs.readFileSync(codexFile(home), 'utf8'));
    assert.ok(t.memb_mcp && t.deja && t.github, 'every table parses');
    assert.equal(codexHas(fs.readFileSync(codexFile(home), 'utf8'), 'deja'), true);
});

// Should-fix: the gateway-dir mcp.json backups hold the upstream env and go with uninstall.
test('uninstall removes the gateway mcp.json memory-direct and gateway backups, not other files', () => {
    const home = tmp();
    seedGateway(home);
    const dir = cfg.gatewayDir(home);
    const bak1 = path.join(dir, 'mcp.json.aos-memdirect-bak-1700000000000');
    const bak2 = path.join(dir, 'mcp.json.aos-gateway-bak-1700000000001.1');
    const keep = path.join(dir, 'mcp.json.user-notes');
    fs.writeFileSync(bak1, '{"mcpServers":{"x":{"env":{"TOKEN":"s"}}}}');
    fs.writeFileSync(bak2, '{}');
    fs.writeFileSync(keep, 'mine');
    const removed = removeMcpBackups(dir, home);
    assert.deepStrictEqual(removed.sort(), [path.basename(bak1), path.basename(bak2)].sort());
    assert.equal(fs.existsSync(bak1), false);
    assert.equal(fs.existsSync(bak2), false);
    assert.equal(fs.existsSync(keep), true);
    assert.equal(fs.existsSync(gatewayMcp(home)), true, 'mcp.json itself is removed by the caller, not here');
});

test('removeMcpBackups refuses any directory other than the gateway dir of HOME', () => {
    const home = tmp();
    assert.throws(() => removeMcpBackups(path.join(home, 'elsewhere'), home), /refusing/);
    assert.throws(() => removeMcpBackups(cfg.gatewayDir(home), '/'), /refusing/);
});

// Should-fix: the uninstall-created <file>.<stamp>.bak files are pruned like the other backup markers.
test('pruneBackups recognises the uninstall stamp backups and keeps the oldest and newest', () => {
    const home = tmp();
    const file = path.join(home, '.claude.json');
    fs.writeFileSync(file, '{}');
    const names = ['20261020T100000Z.bak', '20261021T100000Z.bak', '20261021T110000Z.bak'];
    for (const n of names) fs.writeFileSync(`${file}.${n}`, '{}');
    const archive = path.join(home, 'archive');
    const moved = pruneBackups(file, archive);
    assert.equal(moved.length, 1);
    assert.equal(fs.existsSync(`${file}.20261020T100000Z.bak`), true, 'oldest kept');
    assert.equal(fs.existsSync(`${file}.20261021T110000Z.bak`), true, 'newest kept');
    assert.equal(fs.existsSync(`${file}.20261021T100000Z.bak`), false, 'middle moved out');
    assert.equal(fs.existsSync(moved[0]), true, 'moved into the archive');
});

// Should-fix: a harness write whose record cannot be saved is rolled back, so no unrecorded entry is left behind.
test('a failed record write restores the harness file from its backup and keeps the gateway copy', () => {
    const home = tmp();
    seedGateway(home);
    const env = fakeComponents(home);
    const original = JSON.stringify({ mcpServers: { github: { command: 'gh-mcp' } } });
    fs.writeFileSync(claudeFile(home), original);
    // The records file cannot be replaced while it is a directory: recordMemoryDirect throws.
    fs.mkdirSync(path.join(home, '.agents', '.bdb-uninstall-records.json'), { recursive: true });
    const rep = migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env, log: quiet });
    assert.equal(rep.failed.length, 1);
    assert.match(rep.failed[0].error, /not recorded/);
    assert.equal(fs.readFileSync(claudeFile(home), 'utf8'), original, 'harness file restored');
    assert.deepStrictEqual(gatewayHasMemory(home), { memb: true, deja: true });
});

// Should-fix: the migration takes the gateway dir lock; a held lock changes nothing.
test('a held gateway lock makes the migration change nothing and keep the gateway copy', () => {
    const home = tmp();
    seedGateway(home);
    const env = fakeComponents(home);
    const original = JSON.stringify({ mcpServers: { github: { command: 'gh-mcp' } } });
    fs.writeFileSync(claudeFile(home), original);
    const lock = path.join(cfg.gatewayDir(home), '.rmw.lock');
    fs.writeFileSync(lock, '99999');
    const past = new Date(Date.now() + 5000);
    fs.utimesSync(lock, past, past); // fresh (not stale) lock: mtime in the future counts as young
    const logs = [];
    const rep = migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env, log: (m) => logs.push(m) });
    assert.equal(rep.failed.length, 1);
    assert.match(rep.failed[0].error, /held by another aos-gateway process/);
    assert.equal(fs.readFileSync(claudeFile(home), 'utf8'), original);
    assert.deepStrictEqual(gatewayHasMemory(home), { memb: true, deja: true });
    assert.ok(logs.some((m) => /nothing changed, gateway copy kept/.test(m)));
});

// Should-fix: the gateway mcp.json is written through its realpath; a symlink stays a symlink.
test('the gateway mcp.json symlink survives the memory strip and its target is updated', () => {
    const home = tmp();
    const target = path.join(home, 'shared', 'mcp.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    seedGateway(home, target);
    fs.mkdirSync(cfg.gatewayDir(home), { recursive: true });
    fs.symlinkSync(target, gatewayMcp(home));
    const env = fakeComponents(home);
    const deja = path.join(home, 'fake-bin', 'deja');
    fs.writeFileSync(claudeFile(home), JSON.stringify({ mcpServers: { deja: { command: deja, args: ['mcp'] } } }));
    const rep = migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env, log: quiet });
    assert.equal(rep.gatewayCleaned, true);
    assert.equal(fs.lstatSync(gatewayMcp(home)).isSymbolicLink(), true, 'link kept');
    assert.notEqual(JSON.parse(fs.readFileSync(target, 'utf8')).mcpServers.github, undefined, 'unrelated entries kept');
    assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).mcpServers.deja, undefined, 'target updated');
});

// Should-fix: a Windows deja path with spaces or cmd.exe metacharacters is not written as a cmd /c entry.
test('Windows deja path with cmd.exe metacharacters is not registered; the gateway copy stays', () => {
    const home = tmp();
    seedGateway(home);
    const logs = [];
    const rep = migrateMemoryDirect({
        home, aosRoot: ROOT, now: 1, env: { PATH: '' }, platform: 'win32', dejaPath: 'C:\\tools\\a&b\\deja.cmd',
        log: (m) => logs.push(m),
    });
    assert.equal(rep.gatewayCleaned, false);
    assert.deepStrictEqual(gatewayHasMemory(home), { memb: true, deja: true });
    assert.ok(logs.some((m) => /cmd\.exe metacharacters/.test(m)), 'user is told why');
});

test('reverseMemoryDirect still removes entries the migration wrote (regression guard)', () => {
    const home = tmp();
    seedGateway(home);
    const env = fakeComponents(home);
    fs.writeFileSync(claudeFile(home), JSON.stringify({ mcpServers: { github: { command: 'gh' } } }));
    migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env, log: quiet });
    assert.ok(reverseMemoryDirect({ home }).length >= 1);
});
