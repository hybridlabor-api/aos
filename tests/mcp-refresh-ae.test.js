// AE MCP swap: the shipped bdb_after_effects_mcp is now the pinned npm package; the old node server stays
// as a _legacy rollback entry, and an old-shape on-disk entry is still recognised as AOS-owned.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const secrets = require('../lib/mcp-secrets.js');
const cfg = require('../lib/gateway/config.js');

const shipped = secrets.shippedServers(ROOT);
const legacyShape = { command: 'node', args: ['__MCPS_DIR__/after-effects-mcp/build/index.js'] };

describe('shipped AE entry', () => {
    test('bdb_after_effects_mcp is the pinned npx package at 0.3.1', () => {
        assert.deepEqual(shipped.bdb_after_effects_mcp, { command: 'npx', args: ['-y', '@kumoproductions/mcp-aftereffects@0.3.1'] });
        assert.ok(!JSON.stringify(shipped.bdb_after_effects_mcp).includes('@latest'));
    });

    test('bdb_after_effects_mcp_legacy keeps the old node command, fallback unchanged', () => {
        assert.deepEqual(shipped.bdb_after_effects_mcp_legacy, legacyShape);
        assert.deepEqual(shipped.bdb_after_effects_mcp_fallback, { command: 'go', args: ['-C', '__MCPS_DIR__/ae-mcp', 'run', './cmd/ae-mcp'] });
    });
});

describe('gateway routing', () => {
    test('bdb_after_effects_mcp goes to the gateway set, _legacy and fallback stay direct', () => {
        const { gateway, direct } = cfg.splitServers(shipped);
        assert.ok(gateway.bdb_after_effects_mcp);
        assert.ok(direct.bdb_after_effects_mcp_legacy);
        assert.ok(direct.bdb_after_effects_mcp_fallback);
        for (const n of cfg.DIRECT_SERVERS) assert.ok(!cfg.GATEWAY_SERVERS.includes(n), n);
    });

    test('tool-name budget: longest gateway tool name fits the 64-char limit', () => {
        const name = 'mcp__aos__bdb_after_effects_mcp_1mcp_ae_project_import_json';
        assert.ok(name.length <= 64, name.length);
    });
});

describe('ownership of the old shape', () => {
    test('an old node entry is recognised as AOS-owned and gets replaced', () => {
        assert.ok(secrets.isAosOwned('bdb_after_effects_mcp', { command: 'node', args: ['/home/u/.gemini/config/mcps/after-effects-mcp/build/index.js'] }, { command: 'npx', args: ['-y', '@kumoproductions/mcp-aftereffects@0.3.1'] }, shipped));
    });

    test('an old node entry still passive: unrelated command is not owned', () => {
        assert.ok(!secrets.isAosOwned('bdb_after_effects_mcp', { command: 'node', args: ['/my/own/ae.js'] }, shipped.bdb_after_effects_mcp, shipped));
    });
});
