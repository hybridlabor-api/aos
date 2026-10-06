// mcpPicks: one MCP per app. versionGte, detectApps with a fake fsImpl, applyPicks, and the shipped
// template contract. Pure node:test, no network, no shell.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { versionGte, detectApps, applyPicks } = require('../lib/mcp-pick');
const secrets = require('../lib/mcp-secrets');
const cfg = require('../lib/gateway/config');

const cfgJson = JSON.parse(require('fs').readFileSync(path.join(ROOT, 'mcp_config.json'), 'utf8'));

describe('versionGte', () => {
    test('equal and shorter vs longer', () => {
        assert.equal(versionGte('5.1', '5.1'), true);
        assert.equal(versionGte('5.1', '5.1.2'), false);
        assert.equal(versionGte('5.1.2', '5.1'), true);
        assert.equal(versionGte('5.2', '5.1'), true);
        assert.equal(versionGte('5.0', '5.1'), false);
        assert.equal(versionGte('4.2', '5.1'), false);
    });
    test('comparing by part, not lexicographically', () => {
        assert.equal(versionGte('5.10', '5.2'), true);
        assert.equal(versionGte('10', '9'), true);
    });
    test('non-numeric -> false', () => {
        assert.equal(versionGte('5.1', 'beta'), false);
        assert.equal(versionGte('5.x', '5.1'), false);
    });
});

describe('detectApps with fake fsImpl', () => {
    const fsFrom = (map) => ({
        existsSync: (p) => !!map[String(p)],
        readdirSync: (p) => { if (!(String(p) in map)) throw new Error('ENOENT'); return map[String(p)]; },
    });

    test('darwin blender: highest dotted entry wins', () => {
        const f = fsFrom({ '/Applications/Blender.app/Contents/Resources': ['4.2', '5.1', 'icons'] });
        const detect = detectApps({ platform: 'darwin', env: {}, fsImpl: f });
        assert.deepEqual(detect('blender'), { version: '5.1' });
    });
    test('win32 blender: Blender Foundation dirs', () => {
        const f = fsFrom({ 'C:\\Program Files\\Blender Foundation': ['Blender 4.2', 'Blender 5.1', 'Other'] });
        const detect = detectApps({ platform: 'win32', env: { ProgramFiles: 'C:\\Program Files' }, fsImpl: f });
        assert.deepEqual(detect('blender'), { version: '5.1' });
    });
    test('linux: null', () => {
        const detect = detectApps({ platform: 'linux', env: {}, fsImpl: fsFrom({}) });
        assert.equal(detect('blender'), null);
        assert.equal(detect('resolume'), null);
    });
    test('resolume darwin: path when bundled server exists', () => {
        const f = { existsSync: (p) => String(p) === '/Applications/Resolume Arena/mcp/resolume_arena_mcp_server', readdirSync: () => { throw new Error('n/a'); } };
        const detect = detectApps({ platform: 'darwin', env: {}, fsImpl: f });
        assert.deepEqual(detect('resolume'), { path: '/Applications/Resolume Arena/mcp/resolume_arena_mcp_server' });
    });
    test('resolume win32 with default ProgramFiles and env override', () => {
        const mk = (pf) => ({ existsSync: (p) => String(p) === `${pf}\\Resolume Arena\\mcp\\resolume_arena_mcp_server.exe`, readdirSync: () => { throw new Error('n/a'); } });
        assert.deepEqual(detectApps({ platform: 'win32', fsImpl: mk('C:\\Program Files') })('resolume'),
            { path: 'C:\\Program Files\\Resolume Arena\\mcp\\resolume_arena_mcp_server.exe' });
        assert.deepEqual(detectApps({ platform: 'win32', env: { ProgramFiles: 'D:\\PF' }, fsImpl: mk('D:\\PF') })('resolume'),
            { path: 'D:\\PF\\Resolume Arena\\mcp\\resolume_arena_mcp_server.exe' });
    });
    test('fs errors -> null, never throws', () => {
        const f = { existsSync: () => { throw new Error('boom'); }, readdirSync: () => { throw new Error('boom'); } };
        const detect = detectApps({ platform: 'darwin', env: {}, fsImpl: f });
        assert.equal(detect('blender'), null);
        assert.equal(detect('resolume'), null);
    });
    test('empty Resources dir -> null', () => {
        const f = fsFrom({ '/Applications/Blender.app/Contents/Resources': [] });
        const detect = detectApps({ platform: 'darwin', env: {}, fsImpl: f });
        assert.equal(detect('blender'), null);
    });
});

describe('applyPicks with fake detect', () => {
    const servers = {
        bdb_blender_official_mcp: { command: 'uvx', args: ['--from', 'git+x@ff54e4d#subdirectory=mcp', 'blender-mcp'] },
        bdb_blender_mcp: { command: 'uv', args: ['--directory', '__MCPS_DIR__/blender-mcp', 'run', '-m', 'blender_mcp.server'] },
        bdb_resolume_official_mcp: { command: '__RESOLUME_MCP__', args: [] },
        bdb_resolume_mcp: { command: 'uv', args: ['run', '__MCPS_DIR__/resolume_mcp.py'] },
        github: { command: 'npx', args: ['-y', 'pkg'] },
    };
    const picks = cfgJson.mcpPicks;

    test('blender 5.1: official kept, ours retired', () => {
        const detect = (app) => (app === 'blender' ? { version: '5.1' } : null);
        const r = applyPicks(servers, picks, detect);
        assert.ok(r.servers.bdb_blender_official_mcp);
        assert.ok(!r.servers.bdb_blender_mcp);
        assert.deepEqual(r.retired.sort(), ['bdb_blender_mcp', 'bdb_resolume_official_mcp']);
        assert.ok(r.servers.bdb_resolume_mcp); // nothing detected for resolume
        assert.ok(r.servers.github);
    });
    test('blender 5.0 / 4.2 / none: ours kept, official retired', () => {
        for (const v of ['5.0', '4.2', undefined]) {
            const detect = (app) => (app === 'blender' ? (v === undefined ? null : { version: v }) : null);
            const r = applyPicks(servers, picks, detect);
            assert.ok(r.servers.bdb_blender_mcp, `${v}`);
            assert.ok(!r.servers.bdb_blender_official_mcp, `${v}`);
            assert.ok(r.retired.includes('bdb_blender_official_mcp'), `${v}`);
        }
    });
    test('resolume detected: official kept with command replaced, ours retired', () => {
        const detect = (app) => (app === 'resolume' ? { path: '/opt/arena/mcp/resolume_arena_mcp_server' } : null);
        const r = applyPicks(servers, picks, detect);
        assert.deepEqual(r.servers.bdb_resolume_official_mcp, { command: '/opt/arena/mcp/resolume_arena_mcp_server', args: [] });
        assert.ok(!r.servers.bdb_resolume_mcp);
        assert.deepEqual(r.retired.sort(), ['bdb_blender_official_mcp', 'bdb_resolume_mcp']);
    });
    test('resolume placeholder without path: not satisfied, ours stays', () => {
        const detect = () => null;
        const r = applyPicks(servers, picks, detect);
        assert.deepEqual(r.servers.bdb_resolume_mcp, servers.bdb_resolume_mcp);
        assert.ok(!r.servers.bdb_resolume_official_mcp);
    });
    test('both apps detected: exactly one per group', () => {
        const detect = (app) => (app === 'blender' ? { version: '5.1' } : app === 'resolume' ? { path: '/x' } : null);
        const r = applyPicks(servers, picks, detect);
        assert.ok(!!r.servers.bdb_blender_official_mcp !== !!r.servers.bdb_blender_mcp);
        assert.ok(!!r.servers.bdb_resolume_official_mcp !== !!r.servers.bdb_resolume_mcp);
    });
    test('input never mutated', () => {
        const before = JSON.stringify(servers);
        applyPicks(servers, picks, () => ({ version: '9', path: '/x' }));
        assert.equal(JSON.stringify(servers), before);
    });
});

describe('shipped template contract', () => {
    test('every candidate name exists in mcpServers', () => {
        for (const g of cfgJson.mcpPicks) {
            for (const c of g.candidates) assert.ok(cfgJson.mcpServers[c.name], c.name);
        }
    });
    test('blender official git ref pinned to a commit', () => {
        const args = cfgJson.mcpServers.bdb_blender_official_mcp.args;
        assert.ok(args.join(' ').match(/@[0-9a-f]{7,40}#/));
        assert.ok(!args.join(' ').match(/@latest|@[^0-9a-f]/));
    });
    test('resolume official uses placeholder', () => {
        assert.equal(cfgJson.mcpServers.bdb_resolume_official_mcp.command, '__RESOLUME_MCP__');
    });
    test('real shippedServers default: ours stay, official dropped', () => {
        const s = secrets.shippedServers(ROOT);
        assert.ok(s.bdb_blender_mcp);
        assert.ok(s.bdb_resolume_mcp);
        assert.ok(!s.bdb_blender_official_mcp);
        assert.ok(!s.bdb_resolume_official_mcp);
    });
    test('real shippedServers with detect: picks applied', () => {
        const detect = (app) => (app === 'blender' ? { version: '5.1' } : null);
        const s = secrets.shippedServers(ROOT, { detect });
        assert.ok(s.bdb_blender_official_mcp);
        assert.ok(!s.bdb_blender_mcp);
        assert.ok(s.bdb_resolume_mcp);
    });
    test('shippedPicks reports retired', () => {
        const detect = (app) => (app === 'blender' ? { version: '5.1' } : null);
        const r = secrets.shippedPicks(ROOT, { detect });
        assert.ok(r.retired.includes('bdb_blender_mcp'));
        assert.deepEqual(r.servers.bdb_blender_official_mcp, cfgJson.mcpServers.bdb_blender_official_mcp);
    });
    test('gateway routing: official entries direct, not gateway', () => {
        assert.ok(cfg.DIRECT_SERVERS.includes('bdb_blender_official_mcp'));
        assert.ok(cfg.DIRECT_SERVERS.includes('bdb_resolume_official_mcp'));
        assert.ok(!cfg.GATEWAY_SERVERS.includes('bdb_blender_official_mcp'));
        assert.ok(!cfg.GATEWAY_SERVERS.includes('bdb_resolume_official_mcp'));
    });
});
