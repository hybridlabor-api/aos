const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cfg = require('../lib/gateway/config.js');
const { SERVER_GROUPS } = require('../lib/gateway/selection.js');
const { shippedServers } = require('../lib/mcp-secrets.js');
const { migrateMemoryDirect } = require('../lib/gateway/migrate-memory.js');
const profile = require('../lib/v5/profile.js');
const { writeMigration, readMigration } = require('../lib/gateway/harness.js');
const { fakeComponents } = require('./helpers/memdirect-env.js');

const ROOT = path.resolve(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-mem-absent-'));

test('memb_mcp and deja are absent from gateway definitions and upstreams', () => {
    // 1. GATEWAY_SERVERS does not include memory
    assert.ok(!cfg.GATEWAY_SERVERS.includes('memb_mcp'), 'memb_mcp not in GATEWAY_SERVERS');
    assert.ok(!cfg.GATEWAY_SERVERS.includes('deja'), 'deja not in GATEWAY_SERVERS');

    // 2. DIRECT_SERVERS includes memory
    assert.ok(cfg.DIRECT_SERVERS.includes('memb_mcp'), 'memb_mcp in DIRECT_SERVERS');
    assert.ok(cfg.DIRECT_SERVERS.includes('deja'), 'deja in DIRECT_SERVERS');

    // 3. SERVER_GROUPS.base does not include memory
    assert.ok(!SERVER_GROUPS.base.includes('memb_mcp'), 'memb_mcp not in SERVER_GROUPS.base');
    assert.ok(!SERVER_GROUPS.base.includes('deja'), 'deja not in SERVER_GROUPS.base');

    // 4. splitServers classifies them as direct
    const shipped = shippedServers(ROOT);
    const split = cfg.splitServers(shipped);
    assert.ok(!('memb_mcp' in split.gateway), 'memb_mcp not in split.gateway');
    assert.ok(!('deja' in split.gateway), 'deja not in split.gateway');
    assert.ok('memb_mcp' in split.direct, 'memb_mcp in split.direct');
    assert.ok('deja' in split.direct, 'deja in split.direct');

    // 5. buildUpstreams drops them even if passed in shipped
    const up = cfg.buildUpstreams({ shipped, home: '/tmp/test', launcher: 'node', pathEnv: 'p' });
    assert.strictEqual(up.memb_mcp, undefined);
    assert.strictEqual(up.deja, undefined);
});

test('migrateMemoryDirect strips memb_mcp and deja from gateway mcp.json with backup and cleans settings/migration', () => {
    const home = tmp();
    const gDir = cfg.gatewayDir(home);
    fs.mkdirSync(gDir, { recursive: true });

    // Initial mcp.json with memb_mcp and deja
    const mcpFile = path.join(gDir, 'mcp.json');
    const initialMcp = {
        mcpServers: {
            github: { type: 'stdio', command: 'npx' },
            memb_mcp: { type: 'stdio', command: 'node' },
            deja: { type: 'stdio', command: 'deja' },
        },
    };
    fs.writeFileSync(mcpFile, JSON.stringify(initialMcp, null, 2) + '\n');

    // Initial settings with memb_mcp and deja in gateway.servers
    profile.writeSettings(home, { gateway: { servers: ['github', 'memb_mcp', 'deja'] } });

    // Initial migration records with memb_mcp
    writeMigration(home, [
        { file: path.join(home, '.claude.json'), key: 'github', original: '{}', now: 1 },
        { file: path.join(home, '.claude.json'), key: 'memb_mcp', original: '{}', now: 1 },
    ]);

    const rep = migrateMemoryDirect({ home, aosRoot: ROOT, now: 9999, env: fakeComponents(home) });
    assert.strictEqual(rep.gatewayCleaned, true);
    assert.strictEqual(rep.recordsCleaned, 1);

    // Verify mcp.json was updated
    const nextMcp = JSON.parse(fs.readFileSync(mcpFile, 'utf8'));
    assert.ok(nextMcp.mcpServers.github);
    assert.strictEqual(nextMcp.mcpServers.memb_mcp, undefined);
    assert.strictEqual(nextMcp.mcpServers.deja, undefined);

    // Verify backup exists
    const bakFile = `${mcpFile}.aos-memdirect-bak-9999`;
    assert.ok(fs.existsSync(bakFile));
    const bakData = JSON.parse(fs.readFileSync(bakFile, 'utf8'));
    assert.ok(bakData.mcpServers.memb_mcp && bakData.mcpServers.deja);

    // Verify settings cleaned
    const st = profile.readSettings(home, () => {});
    assert.deepStrictEqual(st.gateway.servers, ['github']);

    // Verify migration cleaned
    const records = readMigration(home);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].key, 'github');
});
