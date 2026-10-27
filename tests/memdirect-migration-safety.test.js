const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cfg = require('../lib/gateway/config.js');
const { migrateMemoryDirect, codexHas } = require('../lib/gateway/migrate-memory.js');
const { resolveHarnessPath, HARNESS_ROWS } = require('../lib/mcp-secrets.js');
const { fakeComponents } = require('./helpers/memdirect-env.js');

const ROOT = path.resolve(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-memdirect-safety-'));
const gatewayMcp = (home) => path.join(cfg.gatewayDir(home), 'mcp.json');
const seedGateway = (home) => {
    fs.mkdirSync(cfg.gatewayDir(home), { recursive: true });
    fs.writeFileSync(gatewayMcp(home), JSON.stringify({ mcpServers: { github: { type: 'stdio', command: 'npx' }, memb_mcp: { command: 'node' }, deja: { command: 'deja' } } }, null, 2));
};
const gatewayHasMemory = (home) => {
    const m = JSON.parse(fs.readFileSync(gatewayMcp(home), 'utf8')).mcpServers;
    return { memb: m.memb_mcp !== undefined, deja: m.deja !== undefined };
};
const quiet = () => {};

// Item 1: memory must never end up in zero places.
test('item 1: a harness write that fails keeps the gateway copy of memb_mcp and deja', () => {
    const home = tmp();
    seedGateway(home);
    const claude = path.join(home, '.claude.json');
    fs.writeFileSync(claude, '{ not valid json');
    const rep = migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env: fakeComponents(home), log: quiet });
    assert.equal(rep.failed.length, 1);
    assert.equal(rep.gatewayCleaned, false);
    assert.deepStrictEqual(gatewayHasMemory(home), { memb: true, deja: true });
    assert.equal(fs.readFileSync(claude, 'utf8'), '{ not valid json', 'unparseable harness file is not rewritten');
});

test('item 1: harness registration off keeps the gateway copy', () => {
    const home = tmp();
    seedGateway(home);
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: {} }));
    const rep = migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env: fakeComponents(home), harnesses: false, log: quiet });
    assert.equal(rep.gatewayCleaned, false);
    assert.deepStrictEqual(gatewayHasMemory(home), { memb: true, deja: true });
});

test('item 1: a fully confirmed migration removes the gateway copy only after the harness has the entries', () => {
    const home = tmp();
    seedGateway(home);
    const claude = path.join(home, '.claude.json');
    fs.writeFileSync(claude, JSON.stringify({ mcpServers: {} }));
    const rep = migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env: fakeComponents(home), log: quiet });
    assert.equal(rep.gatewayCleaned, true);
    const c = JSON.parse(fs.readFileSync(claude, 'utf8')).mcpServers;
    assert.ok(c.memb_mcp && c.deja, 'Claude holds both direct entries');
    assert.deepStrictEqual(gatewayHasMemory(home), { memb: false, deja: false });
});

// Item 2: project files of the current directory are never rewritten.
test('item 2: a project .cursor/mcp.json in the working directory is untouched', () => {
    const home = tmp();
    seedGateway(home);
    const project = tmp();
    const projectCursor = path.join(project, '.cursor', 'mcp.json');
    fs.mkdirSync(path.dirname(projectCursor), { recursive: true });
    const before = JSON.stringify({ mcpServers: { other: { command: 'x' } } });
    fs.writeFileSync(projectCursor, before);
    const prev = process.cwd();
    process.chdir(project);
    try {
        migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env: fakeComponents(home), log: quiet });
    } finally {
        process.chdir(prev);
    }
    assert.equal(fs.readFileSync(projectCursor, 'utf8'), before);
});

// Item 3: JSONC with comments is never rewritten, and the skip is visible.
test('item 3: opencode.jsonc with comments is not rewritten, is reported, and keeps the gateway copy', () => {
    const home = tmp();
    seedGateway(home);
    const jsonc = path.join(home, '.config', 'opencode', 'opencode.jsonc');
    fs.mkdirSync(path.dirname(jsonc), { recursive: true });
    const text = '{\n  // my servers\n  "mcp": {}\n}\n';
    fs.writeFileSync(jsonc, text);
    const said = [];
    const rep = migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env: fakeComponents(home), log: (m) => said.push(m) });
    assert.equal(fs.readFileSync(jsonc, 'utf8'), text);
    assert.ok(rep.failed.some((f) => f.file === jsonc && /JSONC with comments/.test(f.error)));
    assert.ok(said.some((m) => /JSONC with comments/.test(m)), 'skip is logged');
    assert.equal(rep.gatewayCleaned, false);
});

// Item 4: Codex config keeps mode and symlink, and a dotted entry is not duplicated.
test('item 4: Codex config.toml keeps mode 0600 and a symlink target', () => {
    const home = tmp();
    seedGateway(home);
    const real = path.join(home, 'dotfiles', 'codex-config.toml');
    fs.mkdirSync(path.dirname(real), { recursive: true });
    fs.writeFileSync(real, '[model]\nname = "x"\n', { mode: 0o600 });
    fs.chmodSync(real, 0o600);
    const link = path.join(home, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(real, link);
    migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env: fakeComponents(home), log: quiet });
    assert.ok(fs.lstatSync(link).isSymbolicLink(), 'symlink preserved');
    assert.equal(fs.statSync(real).mode & 0o777, 0o600, 'mode preserved');
    assert.match(fs.readFileSync(real, 'utf8'), /\[mcp_servers\.deja\]/);
});

test('item 4: a dotted memb_mcp key under [mcp_servers] is detected, not duplicated', () => {
    const home = tmp();
    seedGateway(home);
    const toml = path.join(home, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(toml), { recursive: true });
    fs.writeFileSync(toml, '[mcp_servers]\nmemb_mcp.command = "node"\nmemb_mcp.args = []\n');
    migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env: fakeComponents(home), log: quiet });
    const text = fs.readFileSync(toml, 'utf8');
    assert.equal((text.match(/\[mcp_servers\.memb_mcp\]/g) || []).length, 0, 'no duplicate memb_mcp table');
    assert.match(text, /\[mcp_servers\.deja\]/);
});

test('item 4: codexHas recognises header, dotted and inline forms only inside mcp_servers', () => {
    assert.equal(codexHas('[mcp_servers.memb_mcp]\ncommand = "x"\n', 'memb_mcp'), true);
    assert.equal(codexHas('[mcp_servers]\nmemb_mcp.command = "x"\n', 'memb_mcp'), true);
    assert.equal(codexHas('[mcp_servers]\nmemb_mcp = { command = "x" }\n', 'memb_mcp'), true);
    assert.equal(codexHas('mcp_servers.memb_mcp.command = "x"\n', 'memb_mcp'), true);
    assert.equal(codexHas('[profiles.x]\nmemb_mcp.command = "x"\n', 'memb_mcp'), false);
    assert.equal(codexHas('[model]\nname = "x"\n', 'deja'), false);
});

// Item 5: only verified rows, each under its own root key.
test('item 5: unverified rows (cline-legacy, aider, vscode) are never touched', () => {
    const home = tmp();
    seedGateway(home);
    const env = fakeComponents(home);
    const cline = resolveHarnessPath('~/.cline/mcp_settings.json', { home, env, platform: 'darwin', cwd: home });
    const aider = resolveHarnessPath('~/.aider/mcp.json', { home, env, platform: 'darwin', cwd: home });
    const vscodeRow = HARNESS_ROWS.find((r) => r.id === 'vscode');
    const vscode = resolveHarnessPath(vscodeRow.mcp.global[0], { home, env, platform: 'darwin', cwd: home });
    const files = [cline, aider, vscode];
    const before = {};
    for (const f of files) {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        before[f] = JSON.stringify({ mcpServers: {}, servers: {} });
        fs.writeFileSync(f, before[f]);
    }
    migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env, platform: 'darwin', log: quiet });
    for (const f of files) assert.equal(fs.readFileSync(f, 'utf8'), before[f], `${path.basename(f)} untouched`);
});

// Item 8: absolute commands. A GUI-launched harness does not find bare `node` or `deja`.
test('item 8: direct entries use an absolute node and an absolute deja path', () => {
    const home = tmp();
    seedGateway(home);
    const claude = path.join(home, '.claude.json');
    fs.writeFileSync(claude, JSON.stringify({ mcpServers: {} }));
    const env = fakeComponents(home);
    migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env, nodePath: '/opt/node/bin/node', log: quiet });
    const c = JSON.parse(fs.readFileSync(claude, 'utf8')).mcpServers;
    assert.equal(c.memb_mcp.command, '/opt/node/bin/node');
    assert.equal(c.deja.command, path.join(home, 'fake-bin', 'deja'));
});

// Item 9: a memb entry is only written when its python exists; otherwise the gateway copy stays.
test('item 9: missing memb python skips memb_mcp in harnesses and keeps the gateway copy; deja still goes direct', () => {
    const home = tmp();
    seedGateway(home);
    const claude = path.join(home, '.claude.json');
    fs.writeFileSync(claude, JSON.stringify({ mcpServers: {} }));
    const env = fakeComponents(home);
    fs.rmSync(path.join(home, '.gemini', 'config', 'mcps', 'memb-mcp', '.venv'), { recursive: true, force: true });
    const said = [];
    migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env, log: (m) => said.push(m) });
    const c = JSON.parse(fs.readFileSync(claude, 'utf8')).mcpServers;
    assert.equal(c.memb_mcp, undefined, 'no dangling memb entry');
    assert.ok(c.deja, 'deja registered');
    assert.deepStrictEqual(gatewayHasMemory(home), { memb: true, deja: false }, 'memb gateway copy kept (cannot be replaced); deja moved direct');
    assert.ok(said.some((m) => /memb_mcp .*missing/.test(m)));
});
test('bare node/deja entries written by the installer count as confirmed and the gateway copy is removed', () => {
    const home = tmp();
    seedGateway(home);
    const claude = path.join(home, '.claude.json');
    fs.writeFileSync(claude, JSON.stringify({ mcpServers: {} }));
    migrateMemoryDirect({ home, aosRoot: ROOT, now: 1, env: fakeComponents(home), log: quiet });
    const abs = JSON.parse(fs.readFileSync(claude, 'utf8')).mcpServers;
    const bare = (e) => ({ ...e, command: path.basename(e.command).replace(/\.exe$/i, '') });
    fs.writeFileSync(claude, JSON.stringify({ mcpServers: { memb_mcp: bare(abs.memb_mcp), deja: bare(abs.deja) } }));
    seedGateway(home);
    const msgs = [];
    const rep = migrateMemoryDirect({ home, aosRoot: ROOT, now: 2, env: fakeComponents(home), log: (m) => msgs.push(m) });
    assert.equal(rep.gatewayCleaned, true);
    assert.deepStrictEqual(gatewayHasMemory(home), { memb: false, deja: false });
    assert.ok(!msgs.some((m) => /another command|gateway copy kept/.test(m)));
});
