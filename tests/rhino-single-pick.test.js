// One Rhino MCP per harness: the golem fallback is opt-in (AOS_RHINO_MCP=fallback) and a shipped copy is retired.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const secrets = require('../lib/mcp-secrets.js');

const ROOT = path.resolve(__dirname, '..');
const shippedAll = secrets.shippedAll(ROOT);

test('default: only bdb_rhino_mcp ships and the fallback is retired', () => {
    const r = secrets.shippedPicks(ROOT, { env: {} });
    assert.ok(r.servers.bdb_rhino_mcp);
    assert.equal(r.servers.bdb_rhino_mcp_fallback, undefined);
    assert.ok(r.retired.includes('bdb_rhino_mcp_fallback'));
});

test('AOS_RHINO_MCP=fallback swaps to the golem server', () => {
    const r = secrets.shippedPicks(ROOT, { env: { AOS_RHINO_MCP: 'fallback' } });
    assert.ok(r.servers.bdb_rhino_mcp_fallback);
    assert.equal(r.servers.bdb_rhino_mcp, undefined);
});

test('an installed shipped fallback entry is AOS-owned (removed), a user entry is not', () => {
    const t = shippedAll.bdb_rhino_mcp_fallback;
    assert.ok(t);
    const shipped = shippedAll;
    assert.ok(secrets.isAosOwned('bdb_rhino_mcp_fallback', { ...t, args: t.args.map((a) => a.replace('__MCPS_DIR__', '/home/u/.gemini/config/mcps')) }, null, shipped));
    assert.ok(!secrets.isAosOwned('bdb_rhino_mcp_fallback', { command: 'uv', args: ['run', '/my/own/rhino.py'] }, null, shipped));
});
