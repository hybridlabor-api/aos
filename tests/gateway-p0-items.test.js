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

// P0 #1: keep rule - first migration preserves currently running servers
test('P0#1 keep rule: first migration keeps running upstreams, regardless of --yes', () => {
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

    // First migration: WITH keep (current running upstreams)
    const current = ['github', 'bdb_unreal_mcp', 'bdb_davinci_mcp', 'adobe_uxp_mcp'];
    const r = selection.resolveGatewayServers({
        settingServers: st.gateway && st.gateway.servers,
        media: false, // no Pro MEDIA tier in this test
        creator: [], // no apps detected in temp dir
        keep: current, // Always pass current upstreams to keep them
    });

    // Should keep the currently running servers
    assert.ok(r.servers.includes('bdb_unreal_mcp'));
    assert.ok(r.servers.includes('bdb_davinci_mcp'));
    assert.ok(r.servers.includes('adobe_uxp_mcp'));
    assert.ok(r.servers.includes('github'));
    assert.equal(r.fromSetting, false); // derived, not from stored setting
    assert.deepEqual(r.kept, ['adobe_uxp_mcp', 'bdb_davinci_mcp', 'bdb_unreal_mcp']); // reported as kept (sorted)
});

// P0 #1: with stored selection, never re-add servers
test('P0#1 keep rule: once a selection is stored, it is the whole truth (never re-adds deselected)', () => {
    const home = tmp();
    const dir = cfg.gatewayDir(home);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({
        mcpServers: {
            github: { type: 'stdio', command: 'npx', args: ['x'], tags: ['aos', 'github'] },
            bdb_unreal_mcp: { type: 'stdio', command: 'node', args: ['u.js'], tags: ['aos', 'bdb_unreal_mcp'] },
        },
    }, null, 2) + '\n', { mode: 0o600 });

    const st = { gateway: { servers: ['github'] } }; // User selected only github
    profile.writeSettings(home, st);

    // Even with keep including unreal, it should NOT be added back
    const current = ['github', 'bdb_unreal_mcp'];
    const r = selection.resolveGatewayServers({
        settingServers: st.gateway.servers,
        media: false,
        creator: [],
        keep: current, // keep is ignored when there's a stored selection
    });

    // Should respect the stored selection (github only)
    assert.ok(r.servers.includes('github'));
    assert.ok(!r.servers.includes('bdb_unreal_mcp'));
    assert.equal(r.fromSetting, true); // from stored setting
    assert.deepEqual(r.kept, []); // nothing kept since selection exists
});

// P0 #2: desktop/computer-use servers are in GATEWAY_SERVERS as opt-in via `aos-gateway add`
test('P0#2 desktop servers: computer-use/remoteos are in GATEWAY_SERVERS as opt-in (desktop group)', () => {
    // These servers are offered through the gateway as opt-in
    assert.ok(cfg.GATEWAY_SERVERS.includes('zavora_computer_use'));
    assert.ok(cfg.GATEWAY_SERVERS.includes('bdb_windows_computer_use'));
    assert.ok(cfg.GATEWAY_SERVERS.includes('bdb_remoteos_mcp'));

    // They are in the desktop SERVER_GROUPS
    assert.ok(selection.SERVER_GROUPS.desktop.includes('zavora_computer_use'));
    assert.ok(selection.SERVER_GROUPS.desktop.includes('bdb_windows_computer_use'));
    assert.ok(selection.SERVER_GROUPS.desktop.includes('bdb_remoteos_mcp'));
});

// P0 #2: all genuinely direct-only servers are accounted for
test('P0#2 direct-only servers: per-session and native-only servers stay direct', () => {
    const expected = [
        'mcsc',
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

test('P0#1 kept-servers message names the running servers carried over', () => {
    const { resolveAndSaveSelection } = require('../lib/v5/pkg-gateway.js');
    const home = tmp();
    const dir = cfg.gatewayDir(home);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({ mcpServers: {
        github: { type: 'stdio', command: 'npx', args: ['x'], tags: ['aos', 'github'] },
        bdb_unreal_mcp: { type: 'stdio', command: 'node', args: ['u.js'], tags: ['aos', 'bdb_unreal_mcp'] },
    } }, null, 2) + '\n', { mode: 0o600 });
    const lines = [];
    const ctx = { home, aosRoot: home, platform: 'linux', env: {} };
    resolveAndSaveSelection(ctx, (m) => lines.push(m));
    assert.ok(lines.some((m) => /keeping running upstreams \(github, bdb_unreal_mcp\)/.test(m)), lines.join('\n'));
});
