// One MCP per app, wired into the installer: winners written, losers retired from harness configs,
// ownership judged against shippedAll. Installer-touching cases run in a child process with a temp HOME and
// only inside the container sandbox (AOS_TEST_SANDBOX=container).
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const secrets = require('../lib/mcp-secrets');
const records = require('../lib/uninstall-records');

const blender51 = (app) => (app === 'blender' ? { version: '5.1' } : null);
const nothing = () => null;
const inContainer = process.env.AOS_TEST_SANDBOX === 'container';

describe('picks and ownership (pure)', () => {
    test('nothing detected: ours wins, official entries are retired', () => {
        const r = secrets.shippedPicks(ROOT, { detect: nothing, env: {} });
        assert.ok(r.servers.bdb_blender_mcp);
        assert.ok(r.servers.bdb_resolume_mcp);
        assert.ok(!r.servers.bdb_blender_official_mcp);
        assert.ok(r.retired.includes('bdb_blender_official_mcp'));
        assert.ok(r.retired.includes('bdb_resolume_official_mcp'));
    });

    test('blender >= 5.1: official wins and our entry is retired', () => {
        const r = secrets.shippedPicks(ROOT, { detect: blender51, env: {} });
        assert.ok(r.servers.bdb_blender_official_mcp);
        assert.ok(!r.servers.bdb_blender_mcp);
        assert.ok(r.retired.includes('bdb_blender_mcp'));
    });

    test('AOS_AE_MCP=legacy opts in to the legacy After Effects entry and retires ours', () => {
        const on = secrets.shippedPicks(ROOT, { detect: nothing, env: { AOS_AE_MCP: 'legacy' } });
        assert.ok(on.servers.bdb_after_effects_mcp_legacy);
        assert.ok(!on.servers.bdb_after_effects_mcp);
        assert.ok(on.retired.includes('bdb_after_effects_mcp'));
        const off = secrets.shippedPicks(ROOT, { detect: nothing, env: {} });
        assert.ok(off.servers.bdb_after_effects_mcp);
        assert.ok(!off.servers.bdb_after_effects_mcp_legacy);
        assert.ok(off.retired.includes('bdb_after_effects_mcp_legacy'));
    });

    test('ownership uses shippedAll: a picked official entry is AOS-owned, shippedServers alone misses it', () => {
        const official = secrets.shippedPicks(ROOT, { detect: blender51, env: {} }).servers.bdb_blender_official_mcp;
        assert.equal(secrets.isAosOwned('bdb_blender_official_mcp', official, null, secrets.shippedAll(ROOT)), true);
        assert.equal(secrets.isAosOwned('bdb_blender_official_mcp', official, null, secrets.shippedServers(ROOT)), false);
        const userOwn = { command: 'my-blender', args: [] };
        assert.equal(secrets.isAosOwned('bdb_blender_official_mcp', userOwn, null, secrets.shippedAll(ROOT)), false);
    });

    test('resolume official with the detected path is AOS-owned', () => {
        const entry = { command: '/Applications/Resolume Arena/mcp/resolume_arena_mcp_server', args: [] };
        assert.equal(secrets.isAosOwned('bdb_resolume_official_mcp', entry, null, secrets.shippedAll(ROOT)), true);
        assert.equal(secrets.isAosOwned('bdb_resolume_official_mcp', { command: 'other', args: [] }, null, secrets.shippedAll(ROOT)), false);
    });

    test('uninstall records know both candidates of each pick group', () => {
        const names = records.aosMcpNames();
        for (const n of ['bdb_blender_mcp', 'bdb_blender_official_mcp', 'bdb_resolume_mcp', 'bdb_resolume_official_mcp']) assert.ok(names.includes(n), n);
    });
});

// Runs `body` inside a child with HOME pointing at a fresh temp dir; the body gets { inst, secrets, ROOT, home, args }.
function inChild(home, args, body) {
    const script = `
        const ROOT = ${JSON.stringify(ROOT)};
        const home = process.env.HOME;
        const args = JSON.parse(process.env.AOS_T_ARGS);
        const inst = require(ROOT + '/installer.js');
        const secrets = require(ROOT + '/lib/mcp-secrets.js');
        const fs = require('fs');
        (${body.toString()})({ inst, secrets, ROOT, home, args, fs });
    `;
    const r = spawnSync(process.execPath, ['-e', script], {
        env: { ...process.env, HOME: home, USERPROFILE: home, AOS_T_ARGS: JSON.stringify(args) },
        encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    return r;
}

describe('installer wiring (container only)', { skip: !inContainer && 'needs AOS_TEST_SANDBOX=container' }, () => {
    test('official wins: our AOS entry leaves the config, a same-named user entry stays', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-picks-'));
        const ours = JSON.parse(JSON.stringify(secrets.shippedAll(ROOT).bdb_blender_mcp).replace(/__MCPS_DIR__/g, `${home}/mcps`));
        const aosFile = path.join(home, 'aos-owned.json');
        const userFile = path.join(home, 'user-owned.json');
        fs.writeFileSync(aosFile, JSON.stringify({ mcpServers: { bdb_blender_mcp: ours, keep_me: { command: 'x', args: [] } } }));
        fs.writeFileSync(userFile, JSON.stringify({ mcpServers: { bdb_blender_mcp: { command: 'my-blender', args: ['--mine'] } } }));

        inChild(home, { aosFile, userFile }, ({ inst, secrets: s, ROOT: root, args }) => {
            const detect = (app) => (app === 'blender' ? { version: '5.1' } : null);
            inst.setMcpPickDetect(detect);
            const master = { mcpServers: s.shippedPicks(root, { detect, env: {} }).servers };
            inst.syncMcpConfigFile(args.aosFile, master);
            inst.syncMcpConfigFile(args.userFile, master);
        });

        const a = JSON.parse(fs.readFileSync(aosFile, 'utf8')).mcpServers;
        assert.ok(!a.bdb_blender_mcp, 'our retired entry is gone');
        assert.ok(a.bdb_blender_official_mcp, 'the official entry is written');
        assert.ok(a.keep_me, 'unrelated entries stay');
        const u = JSON.parse(fs.readFileSync(userFile, 'utf8')).mcpServers;
        assert.deepEqual(u.bdb_blender_mcp, { command: 'my-blender', args: ['--mine'] });
    });

    test('nothing detected: ours is written and no official entry appears', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-picks-'));
        const file = path.join(home, 'cfg.json');
        fs.writeFileSync(file, JSON.stringify({ mcpServers: {} }));
        inChild(home, { file }, ({ inst, secrets: s, ROOT: root, args }) => {
            inst.setMcpPickDetect(() => null);
            inst.syncMcpConfigFile(args.file, { mcpServers: s.shippedPicks(root, { detect: () => null, env: {} }).servers });
        });
        const m = JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers;
        assert.ok(m.bdb_blender_mcp);
        assert.ok(!m.bdb_blender_official_mcp);
    });

    test('flipping back to ours retires the official AOS entry', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-picks-'));
        const file = path.join(home, 'cfg.json');
        const official = secrets.shippedPicks(ROOT, { detect: blender51, env: {} }).servers.bdb_blender_official_mcp;
        fs.writeFileSync(file, JSON.stringify({ mcpServers: { bdb_blender_official_mcp: official } }));
        inChild(home, { file }, ({ inst, secrets: s, ROOT: root, args }) => {
            inst.setMcpPickDetect(() => null);
            inst.syncMcpConfigFile(args.file, { mcpServers: s.shippedPicks(root, { detect: () => null, env: {} }).servers });
        });
        const m = JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers;
        assert.ok(m.bdb_blender_mcp);
        assert.ok(!m.bdb_blender_official_mcp);
    });
});
