// F7 review round 1, items A/B/C/F/G: per-target duplicate guard, Codex direct tables, template copy, no write to ~/.agents/mcp_config.json.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const harness = require('../lib/gateway/harness.js');
const { shippedServers, harnessMcpFiles } = require('../lib/mcp-secrets.js');

const ROOT = path.join(__dirname, '..');
// installer.js fixes homeDir at require time: a temp HOME before the first require keeps every write out of the real home.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-f7-home-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
const TOKEN = 'e'.repeat(64);
const shipped = shippedServers(ROOT);
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('C: Codex enable moves the AOS-owned github table into the migration record; disable restores it', () => {
    const home = tmp('aos-f7c-');
    const file = path.join(home, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const gh = shipped.github;
    const original = `[model]\nname = "x"\n\n# AOS:MCP:START\n[mcp_servers.github]\ncommand = "${gh.command}"\nargs = ${JSON.stringify(gh.args).replace(/,/g, ', ')}\n\n[mcp_servers.mine]\ncommand = "node"\nargs = ["m.js"]\n# AOS:MCP:END\n`;
    fs.writeFileSync(file, original);
    const files = [{ file, kind: 'toml' }];
    const [r] = harness.enable({ home, token: TOKEN, shipped, files, now: 1 });
    assert.deepStrictEqual(r.removed, ['github'], JSON.stringify(r));
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!text.includes('[mcp_servers.github]'));
    assert.ok(text.includes('[mcp_servers.mine]') && text.includes('# AOS:MCP:END') && text.includes('[mcp_servers.aos]'));
    assert.ok(harness.tomlHasGateway(text));
    assert.ok(harness.readMigration(home).some((x) => x.key === 'github' && x.original.startsWith('[mcp_servers.github]')));

    const [d] = harness.disable({ home, files, now: 2 });
    assert.deepStrictEqual(d.restored, ['github']);
    const back = fs.readFileSync(file, 'utf8');
    assert.ok(back.includes('[mcp_servers.github]') && !back.includes('[mcp_servers.aos]'));
});

test('C: a user-owned github table in config.toml stays', () => {
    const home = tmp('aos-f7c2-');
    const file = path.join(home, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '[mcp_servers.github]\ncommand = "my-github"\nargs = []\n');
    const [r] = harness.enable({ home, token: TOKEN, shipped, files: [{ file, kind: 'toml' }], now: 1 });
    assert.deepStrictEqual(r.kept, [{ name: 'github', reason: 'user-owned' }]);
    assert.ok(fs.readFileSync(file, 'utf8').includes('command = "my-github"'));
});

test('A/B: the gateway servers are dropped only for a target file that holds the aos entry', () => {
    const { withoutGatewayServers } = require('../installer.js');
    const dir = tmp('aos-f7ab-');
    const withAos = path.join(dir, '.claude.json');
    const desktop = path.join(dir, 'claude_desktop_config.json');
    const toml = path.join(dir, 'config.toml');
    fs.writeFileSync(withAos, JSON.stringify({ mcpServers: { aos: harness.entryFor('claude', TOKEN) } }));
    fs.writeFileSync(desktop, JSON.stringify({ mcpServers: {} }));
    fs.writeFileSync(toml, `[mcp_servers.aos]\nurl = "${harness.GATEWAY_URL}"\n`);
    const servers = { github: { command: 'npx' }, memb_mcp: { command: 'x' } };
    assert.deepStrictEqual(Object.keys(withoutGatewayServers(servers, withAos)), ['memb_mcp']);
    assert.deepStrictEqual(Object.keys(withoutGatewayServers(servers, toml)), ['memb_mcp']);
    assert.deepStrictEqual(Object.keys(withoutGatewayServers(servers, desktop)), ['github', 'memb_mcp']);
    assert.deepStrictEqual(Object.keys(withoutGatewayServers(servers, path.join(dir, 'missing.json'))), ['github', 'memb_mcp']);
    assert.deepStrictEqual(Object.keys(servers), ['github', 'memb_mcp'], 'the shared list itself is never stripped');
});

test('A/B end to end, platform 2: the mirror skips the gateway servers in ~/.claude.json (aos) and keeps them in the desktop file', () => {
    const { mirrorMcpServersTo } = require('../installer.js');
    const claudeJson = path.join(HOME, '.claude.json');
    const desktop = path.join(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    fs.mkdirSync(path.dirname(desktop), { recursive: true });
    fs.writeFileSync(claudeJson, JSON.stringify({ mcpServers: { aos: harness.entryFor('claude', TOKEN) } }));
    fs.writeFileSync(desktop, JSON.stringify({ mcpServers: {} }));
    const generated = JSON.stringify({ mcpServers: { github: shipped.github, deja: { command: 'deja', args: ['mcp'] } } });
    mirrorMcpServersTo([claudeJson, desktop], generated);
    const cj = JSON.parse(fs.readFileSync(claudeJson, 'utf8')).mcpServers;
    const dk = JSON.parse(fs.readFileSync(desktop, 'utf8')).mcpServers;
    assert.ok(cj.aos && cj.deja && !cj.github, `~/.claude.json: ${Object.keys(cj)}`);
    assert.ok(dk.github && dk.deja && !dk.aos, `desktop: ${Object.keys(dk)}`);
});

test('G: run from HOME, ~/.agents/mcp_config.json (the server template) is not a harness file', () => {
    const home = tmp('aos-f7g-');
    const fromHome = harnessMcpFiles(home, {}, 'linux', home).map((f) => f.file);
    assert.ok(!fromHome.includes(path.join(home, '.agents', 'mcp_config.json')));
    const repo = tmp('aos-f7g-repo-');
    assert.ok(harnessMcpFiles(home, {}, 'linux', repo).map((f) => f.file).includes(path.join(repo, '.agents', 'mcp_config.json')));
});

test('F: a real install puts the server templates the gateway reads into ~/.agents (container only)', { skip: process.env.AOS_TEST_SANDBOX !== 'container' }, () => {
    const { spawnSync } = require('child_process');
    const home = tmp('aos-f7f-home-');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'installer.js'), '--hooks-only', '-y', '--no-intro'], {
        cwd: home, env: { ...process.env, HOME: home, USERPROFILE: home, AOS_PLUGIN_CLI: 'off' }, encoding: 'utf8', timeout: 120000,
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const agents = path.join(home, '.agents');
    assert.ok(fs.existsSync(path.join(agents, 'mcp_config.json')) && fs.existsSync(path.join(agents, 'mcp_picks.json')));
    assert.ok(Object.keys(shippedServers(agents)).includes('github'), 'shippedServers(~/.agents) is not empty');
});
