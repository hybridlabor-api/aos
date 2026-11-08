import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { costText, gatewayStatus } from '../bin/aos-gateway.mjs';

test('costText: process count, RAM hint, heavy names and the remove command (#255)', () => {
    assert.equal(costText([]), null);
    const t = costText([{ name: 'github' }, { name: 'bdb_unreal_mcp', heavy: true }]);
    assert.match(t, /^2 upstreams, each its own process from gateway start \(measured 55-170 MB each\)/);
    assert.match(t, /heavy opt-in: bdb_unreal_mcp;/);
    assert.match(t, /aos-gateway remove <name>$/);
    assert.doesNotMatch(costText([{ name: 'github' }]), /heavy/);
});

test('gatewayStatus marks heavy opt-in upstreams from mcp.json (gateway not running, throwaway dir)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gwlean-'));
    fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({ mcpServers: { github: {}, bdb_blender_mcp: {}, my_adopted: {} } }));
    // Closed loopback ports: nothing real is contacted, every upstream reports "gateway not running".
    const s = await gatewayStatus({ dir, port: 1, upstreamPort: 2 });
    assert.equal(s.running, false);
    const byName = Object.fromEntries(s.upstreams.map((u) => [u.name, u]));
    assert.equal(byName.bdb_blender_mcp.heavy, true);
    assert.equal(byName.github.heavy, undefined);
    assert.equal(byName.my_adopted.heavy, undefined);
});
