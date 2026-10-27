// Gateway P0 items: (1) keep rule for fresh install vs update, (2) direct-only servers,
// (3) unverified harness rows. Test with temp HOME to ensure settings isolation.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cfg = require('../lib/gateway/config.js');
const selection = require('../lib/gateway/selection.js');
const profile = require('../lib/v5/profile.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-p0-'));

// P0 #1: keep rule - fresh install should not preserve all currently running servers
test('P0#1 keep rule: fresh install derives from base + detected apps, not from current upstreams', () => {
    const home = tmp();
    const dir = cfg.gatewayDir(home);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Simulate an old installation running many servers
    fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({
        mcpServers: {
            github: { type: 'stdio', command: 'npx', args: ['x'], tags: ['aos', 'github'] },
            bdb_unreal_mcp: { type: 'stdio', command: 'node', args: ['u.js'], tags: ['aos', 'bdb_unreal_mcp'] },
            bdb_davinci_mcp: { type: 'stdio', command: 'node', args: ['d.js'], tags: ['aos', 'bdb_davinci_mcp'] },
            adobe_uxp_mcp: { type: 'stdio', command: 'node', args: ['a.js'], tags: ['aos', 'adobe_uxp_mcp'] },
        },
    }, null, 2) + '\n', { mode: 0o600 });

    // No stored selection yet (first migration)
    const st = {};
    profile.writeSettings(home, st);

    // Fresh install: derive WITHOUT keep (detectCreatorServers will be empty since apps don't exist in temp)
    const r = selection.resolveGatewayServers({
        settingServers: st.gateway && st.gateway.servers,
        media: false, // no Pro MEDIA tier in this test
        creator: [], // no apps detected in temp dir
        keep: [], // NOT including current upstreams
    });

    // Should get only base servers, not the old unreal/davinci/adobe
    assert.deepEqual(r.servers, selection.SERVER_GROUPS.base);
    assert.equal(r.fromSetting, false); // derived, not from stored setting
    assert.deepEqual(r.kept, []); // nothing was "kept" since we didn't pass keep
    assert.ok(!r.servers.includes('bdb_unreal_mcp'));
    assert.ok(!r.servers.includes('bdb_davinci_mcp'));
    assert.ok(!r.servers.includes('adobe_uxp_mcp'));
});

// P0 #1: with keepCurrent flag (--yes mode for CI), preserve current servers
test('P0#1 keep rule: --yes mode preserves current servers for CI', () => {
    const home = tmp();
    const dir = cfg.gatewayDir(home);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({
        mcpServers: {
            github: { type: 'stdio', command: 'npx', args: ['x'], tags: ['aos', 'github'] },
            bdb_unreal_mcp: { type: 'stdio', command: 'node', args: ['u.js'], tags: ['aos', 'bdb_unreal_mcp'] },
        },
    }, null, 2) + '\n', { mode: 0o600 });

    const st = {};
    profile.writeSettings(home, st);

    // With keepCurrent=true, we include current upstreams
    const current = ['github', 'bdb_unreal_mcp'];
    const r = selection.resolveGatewayServers({
        settingServers: st.gateway && st.gateway.servers,
        media: false,
        creator: [],
        keep: current, // WITH keep for --yes mode
    });

    // Should keep the current unreal server
    assert.ok(r.servers.includes('bdb_unreal_mcp'));
    assert.ok(r.servers.includes('github'));
    assert.deepEqual(r.kept, ['bdb_unreal_mcp']); // reported as kept
});

// P0 #2: direct-only servers should be in DIRECT_SERVERS, not GATEWAY_SERVERS
test('P0#2 direct-only servers: desktop/computer-use/remoteos are in DIRECT_SERVERS, not GATEWAY_SERVERS', () => {
    // These servers stay direct by design (per-session state)
    assert.ok(cfg.DIRECT_SERVERS.includes('zavora_computer_use'));
    assert.ok(cfg.DIRECT_SERVERS.includes('bdb_windows_computer_use'));
    assert.ok(cfg.DIRECT_SERVERS.includes('bdb_remoteos_mcp'));

    // They should NOT be in GATEWAY_SERVERS
    assert.ok(!cfg.GATEWAY_SERVERS.includes('zavora_computer_use'));
    assert.ok(!cfg.GATEWAY_SERVERS.includes('bdb_windows_computer_use'));
    assert.ok(!cfg.GATEWAY_SERVERS.includes('bdb_remoteos_mcp'));
});

// P0 #2: all direct-only servers are accounted for
test('P0#2 direct-only servers: all expected servers are marked direct', () => {
    const expected = [
        'mcsc',
        'zavora_computer_use',
        'bdb_windows_computer_use',
        'bdb_remoteos_mcp',
        'bdb_rhino_mcp',
        'bdb_td_minddesigner',
        'rea_mcp',
        'tauri-pilot',
    ];
    for (const name of expected) {
        assert.ok(cfg.DIRECT_SERVERS.includes(name), `${name} should be in DIRECT_SERVERS`);
        assert.ok(!cfg.GATEWAY_SERVERS.includes(name), `${name} should NOT be in GATEWAY_SERVERS`);
    }
});

// P0 #2: openwiki is direct by design (stays in PER_SESSION regex, not in either list)
test('P0#2 direct-only servers: openwiki is direct by design (not in GATEWAY_SERVERS or DIRECT_SERVERS list)', () => {
    assert.ok(!cfg.GATEWAY_SERVERS.includes('openwiki'));
    assert.ok(!cfg.DIRECT_SERVERS.includes('openwiki'));
    // Openwiki is matched by PER_SESSION regex instead
    assert.ok(cfg.PER_SESSION.test('openwiki'));
});

// P0 #3: UNVERIFIED harness rows should not be switched to gateway
test('P0#3 unverified harness rows: should be listed in doctor/docs as unsupported', () => {
    // This test documents the expected behavior: UNVERIFIED harness rows are left untouched
    // and should be reported in doctor and docs as "not managed by the gateway (unverified)"
    const harnesses = require('../lib/harnesses.json');
    const unverified = harnesses.filter((h) => !h.verified);
    assert.ok(unverified.length > 0, 'there should be some unverified harnesses');
    // Examples of unverified: claude-desktop, cursor-app, windsurf, aider, cline, vscode, agy-cli
    const unverifiedIds = unverified.map((h) => h.id).sort();
    assert.ok(unverifiedIds.includes('claude-desktop'));
    assert.ok(unverifiedIds.includes('cursor-app'));
    assert.ok(unverifiedIds.includes('windsurf-legacy'));
    assert.ok(!unverifiedIds.includes('windsurf'));
});

test('P0#3 doctor lists every unverified harness row as not managed by the gateway', () => {
    const doctor = require('../lib/gateway/doctor.js');
    const home = tmp();
    const row = doctor.gatewayChecks({ home, files: [], platform: 'linux' }).find((c) => c.name === 'not managed by the gateway (unverified)');
    assert.ok(row, 'row present');
    const unverifiedIds = require('../lib/harnesses.json').filter((h) => !h.verified).map((h) => h.id);
    for (const id of unverifiedIds) assert.ok(row.detail.split(', ').includes(id), id);
    assert.ok(!row.detail.split(', ').includes('claude'));
});

test('P0#2 doctor reports a direct-by-design server as direct by design, not as a duplicate', () => {
    const doctor = require('../lib/gateway/doctor.js');
    const home = tmp();
    const file = path.join(home, '.claude.json');
    fs.writeFileSync(file, JSON.stringify({ mcpServers: {
        aos: { type: 'http', url: 'http://127.0.0.1:7790/mcp' },
        bdb_blender_official_mcp: { command: 'node', args: ['b.js'] },
    } }));
    const checks = doctor.gatewayChecks({ home, files: [{ file, kind: 'claude' }], platform: 'linux' });
    const dup = checks.find((c) => c.name === `gateway duplicates in ${file}`);
    const byDesign = checks.find((c) => c.name === `gateway direct by design in ${file}`);
    assert.equal(dup.ok, true);
    assert.doesNotMatch(dup.detail, /bdb_blender_official_mcp/);
    assert.equal(byDesign.ok, true);
    assert.match(byDesign.detail, /bdb_blender_official_mcp/);
});

test('P0#1 dropped-servers message names the running servers not carried over', () => {
    const { resolveAndSaveSelection } = require('../lib/v5/pkg-gateway.js');
    const home = tmp();
    const dir = cfg.gatewayDir(home);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({ mcpServers: {
        github: { type: 'stdio', command: 'npx', args: ['x'], tags: ['aos', 'github'] },
        bdb_unreal_mcp: { type: 'stdio', command: 'node', args: ['u.js'], tags: ['aos', 'bdb_unreal_mcp'] },
    } }, null, 2) + '\n', { mode: 0o600 });
    const lines = [];
    const ctx = { home, aosRoot: home, platform: 'linux', env: {}, keepCurrentOnUpdate: false };
    resolveAndSaveSelection(ctx, (m) => lines.push(m));
    assert.ok(lines.includes('gateway: first selection = base + detected apps; not carried over: bdb_unreal_mcp (add back with "aos-gateway add <name>")'), lines.join('\n'));
    assert.ok(!lines.some((m) => /not carried over: github/.test(m)));
});
