// Rust + Tauri package: tauri-pilot CLI via cargo (stubbed, never run) and the tauri-pilot MCP pick, which
// exists only while the package's skills are installed. Installer-touching cases run in a child process with a
// temp HOME and only inside the container sandbox (AOS_TEST_SANDBOX=container).
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const secrets = require('../lib/mcp-secrets');
const { detectApps } = require('../lib/mcp-pick');
const cfg = require('../lib/gateway/config');

const ENTRY = { command: 'tauri-pilot', args: ['mcp'] };
const CARGO = ['install', 'tauri-pilot-cli', '--version', '0.8.1', '--locked'];
const inContainer = process.env.AOS_TEST_SANDBOX === 'container';
const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-rustauri-'));
const plantSkill = (home) => {
    const d = path.join(home, '.agents', 'skills', 'tauri-pilot');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'SKILL.md'), '# tauri-pilot\n');
};

describe('tauri-pilot MCP pick (pure)', () => {
    test('without the package: no entry, and it is retired', () => {
        const home = tmpHome();
        const r = secrets.shippedPicks(ROOT, { detect: detectApps({ platform: process.platform, env: {}, home }), env: {} });
        assert.ok(!r.servers['tauri-pilot']);
        assert.ok(r.retired.includes('tauri-pilot'));
    });

    test('with the package: the direct stdio entry is picked', () => {
        const home = tmpHome();
        plantSkill(home);
        const r = secrets.shippedPicks(ROOT, { detect: detectApps({ platform: process.platform, env: {}, home }), env: {} });
        assert.deepEqual(r.servers['tauri-pilot'], ENTRY);
        assert.ok(!r.retired.includes('tauri-pilot'));
    });

    test('stays direct: never a gateway server', () => {
        assert.ok(cfg.DIRECT_SERVERS.includes('tauri-pilot'));
        assert.ok(!cfg.GATEWAY_SERVERS.includes('tauri-pilot'));
        assert.equal(cfg.gatewayCovered('tauri-pilot'), false);
    });
});

// Runs `body` in a child whose env holds only PATH and a temp HOME (no CODEX_HOME / CLAUDE_CONFIG_DIR leaks).
function inChild(home, args, body) {
    const script = `
        const ROOT = ${JSON.stringify(ROOT)};
        const args = JSON.parse(process.env.AOS_T_ARGS);
        const inst = require(ROOT + '/installer.js');
        const fs = require('fs');
        (${body.toString()})({ inst, args, fs });
    `;
    const r = spawnSync(process.execPath, ['-e', script], {
        env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, AOS_T_ARGS: JSON.stringify(args) },
        encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    return { ...r, out: `${r.stdout}${r.stderr}` };
}

// Stubbed exec: records calls; `tauri-pilot --version` answers `version` or throws when it is null.
function runInstall(home, { version, cargo }) {
    const out = path.join(home, 'result.json');
    const r = inChild(home, { out, version, cargo }, ({ inst, args, fs: f }) => {
        const calls = [];
        const exec = (cmd, a) => {
            calls.push([cmd, ...a]);
            if (cmd === 'tauri-pilot') { if (args.version === null) throw new Error('ENOENT'); return `tauri-pilot ${args.version}\n`; }
            return '';
        };
        const ok = inst.installRustauri({ exec, has: (b) => b === 'cargo' && args.cargo });
        f.writeFileSync(args.out, JSON.stringify({ ok, calls }));
    });
    return { ...JSON.parse(fs.readFileSync(out, 'utf8')), log: r.out };
}
const cargoCalls = (res) => res.calls.filter((c) => c[0] === 'cargo');
const skillInstalled = (home) => fs.existsSync(path.join(home, '.agents', 'skills', 'tauri-pilot', 'SKILL.md'));

describe('installRustauri (container only)', { skip: !inContainer && 'needs AOS_TEST_SANDBOX=container' }, () => {
    test('cargo present, CLI missing: runs cargo install with the pinned version', () => {
        const home = tmpHome();
        const res = runInstall(home, { version: null, cargo: true });
        assert.equal(res.ok, true);
        assert.deepEqual(cargoCalls(res), [['cargo', ...CARGO]]);
    });

    test('tauri-pilot 0.8.1 already installed: no cargo call', () => {
        const home = tmpHome();
        const res = runInstall(home, { version: '0.8.1', cargo: true });
        assert.equal(res.ok, true);
        assert.deepEqual(cargoCalls(res), []);
    });

    test('older CLI: reinstalls the pinned version', () => {
        const home = tmpHome();
        const res = runInstall(home, { version: '0.7.0', cargo: true });
        assert.deepEqual(cargoCalls(res), [['cargo', ...CARGO]]);
    });

    test('no cargo: warning with the manual command, skills still installed, package ok', () => {
        const home = tmpHome();
        const res = runInstall(home, { version: null, cargo: false });
        assert.equal(res.ok, true);
        assert.deepEqual(cargoCalls(res), []);
        assert.ok(skillInstalled(home));
        assert.ok(res.log.includes(`cargo ${CARGO.join(' ')}`), res.log);
    });

    test('package install registers the MCP entry in Claude Code and Codex, foreign entries stay', () => {
        const home = tmpHome();
        fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { mine: { command: 'x', args: [] } } }));
        fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
        fs.writeFileSync(path.join(home, '.codex', 'config.toml'), '[mcp_servers.mine]\ncommand = "x"\nargs = []\n');
        runInstall(home, { version: '0.8.1', cargo: true });
        const claude = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers;
        assert.deepEqual(claude['tauri-pilot'], ENTRY);
        assert.ok(claude.mine);
        const toml = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
        assert.match(toml, /\[mcp_servers\.tauri-pilot\]\ncommand = "tauri-pilot"\nargs = \["mcp"\]/);
        assert.match(toml, /\[mcp_servers\.mine\]/);
    });

    test('without the package a sync retires the AOS tauri-pilot entry', () => {
        const home = tmpHome();
        const file = path.join(home, '.claude.json');
        fs.writeFileSync(file, JSON.stringify({ mcpServers: { 'tauri-pilot': ENTRY } }));
        inChild(home, { file }, ({ inst, args }) => { inst.syncMcpConfigFile(args.file, { mcpServers: {} }); });
        assert.ok(!JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers['tauri-pilot']);
    });
});
