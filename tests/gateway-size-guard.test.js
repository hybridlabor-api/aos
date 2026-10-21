const { test } = require('node:test');
const assert = require('node:assert');
const { countJsonNodes, gatewaySizeMetrics, SIZE_TOOL_LIMIT, SIZE_NODE_LIMIT, SIZE_HINT } = require('../lib/gateway/doctor.js');

test('countJsonNodes accurately counts JSON AST nodes for primitives, objects, and arrays', () => {
    assert.strictEqual(countJsonNodes(null), 1);
    assert.strictEqual(countJsonNodes(undefined), 1);
    assert.strictEqual(countJsonNodes('hello'), 1);
    assert.strictEqual(countJsonNodes(123), 1);
    assert.strictEqual(countJsonNodes(true), 1);

    // Object with 2 keys: 1 (object) + 2 * (1 key + 1 value) = 5 nodes
    // { a: 1, b: 2 } -> node for object (1), keys 'a', 'b' (2), values 1, 2 (2) -> 5
    assert.strictEqual(countJsonNodes({ a: 1, b: 2 }), 5);

    // Array of 3 primitives: 1 (array) + 3 (elements) = 4 nodes
    assert.strictEqual(countJsonNodes([1, 2, 3]), 4);

    // Nested: { tools: [{ name: 't1' }, { name: 't2' }] }
    // root (1) + key 'tools' (1) + array (1) + 2 obj items (2 * (1 + 1 key + 1 val = 3)) = 3 + 6 = 9
    const nested = { tools: [{ name: 't1' }, { name: 't2' }] };
    assert.strictEqual(countJsonNodes(nested), 9);
});

test('gatewaySizeMetrics returns tool count, node count and no warning when within limits', async () => {
    const mockTools = Array.from({ length: 50 }, (_, i) => ({
        name: `tool_${i}`,
        description: `Description of tool ${i}`,
        inputSchema: { type: 'object', properties: { p: { type: 'string' } } },
    }));

    let capturedHeaders = null;
    const mockFetch = async (url, opts) => {
        capturedHeaders = opts && opts.headers;
        return {
            status: 200,
            text: async () => JSON.stringify({ tools: mockTools }),
        };
    };

    const res = await gatewaySizeMetrics({
        port: 7790,
        token: 'super-secret-token-12345',
        fetchFn: mockFetch,
    });

    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.toolCount, 50);
    assert.ok(res.nodeCount > 50 && res.nodeCount < SIZE_NODE_LIMIT);
    assert.strictEqual(res.warning, null);

    // Verify token was sent in authorization header but is NEVER present in result
    assert.strictEqual(capturedHeaders['Authorization'], 'Bearer super-secret-token-12345');
    assert.ok(!JSON.stringify(res).includes('super-secret-token-12345'));
});

test('gatewaySizeMetrics triggers warning when tool count exceeds limit', async () => {
    const mockTools = Array.from({ length: 205 }, (_, i) => ({
        name: `tool_${i}`,
    }));

    const mockFetch = async () => ({
        status: 200,
        text: async () => JSON.stringify({ tools: mockTools }),
    });

    const res = await gatewaySizeMetrics({
        port: 7790,
        token: 'token',
        fetchFn: mockFetch,
    });

    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.toolCount, 205);
    assert.ok(res.warning);
    assert.ok(res.warning.includes('exceeds safe limit (200)'));
    assert.ok(res.warning.includes(SIZE_HINT));
});

test('gatewaySizeMetrics triggers warning when JSON node count exceeds limit', async () => {
    // Generate a payload with few tools but massive deeply nested schemas
    const bigProperties = {};
    for (let i = 0; i < 1500; i++) {
        bigProperties[`prop_${i}`] = { type: 'string', description: `field ${i}` };
    }
    const mockTools = [
        {
            name: 'massive_tool',
            description: 'A tool with massive schema',
            inputSchema: {
                type: 'object',
                properties: bigProperties,
            },
        },
    ];

    const mockFetch = async () => ({
        status: 200,
        text: async () => JSON.stringify({ tools: mockTools }),
    });

    const res = await gatewaySizeMetrics({
        port: 7790,
        token: 'token',
        fetchFn: mockFetch,
    });

    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.toolCount, 1);
    assert.ok(res.nodeCount > SIZE_NODE_LIMIT, `node count ${res.nodeCount} should exceed ${SIZE_NODE_LIMIT}`);
    assert.ok(res.warning);
    assert.ok(res.warning.includes('JSON AST nodes exceeds safe limit (8000)'));
    assert.ok(res.warning.includes(SIZE_HINT));
});

test('gatewaySizeMetrics handles offline / unreachable gateway safely without throwing', async () => {
    const mockFetch = async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:7790');
    };

    const res = await gatewaySizeMetrics({
        port: 7790,
        token: 'token',
        fetchFn: mockFetch,
    });

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.toolCount, null);
    assert.strictEqual(res.nodeCount, null);
    assert.strictEqual(res.warning, null);
    assert.ok(res.error.includes('ECONNREFUSED'));
    assert.ok(!res.error.includes('token'));
});
