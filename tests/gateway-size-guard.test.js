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

test('gatewaySizeMetrics does the session handshake against a stub gateway that rejects sessionless tools/list', async () => {
    const http = require('http');
    const seen = [];
    const srv = http.createServer((req, res) => {
        let b = '';
        req.on('data', (c) => { b += c; });
        req.on('end', () => {
            const m = JSON.parse(b);
            seen.push(m.method);
            if (m.method === 'initialize') { res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sid1' }); return res.end('{"jsonrpc":"2.0","id":2,"result":{}}'); }
            if (req.headers['mcp-session-id'] !== 'sid1') { res.writeHead(400); return res.end('no session'); }
            if (m.method === 'tools/list') { res.writeHead(200, { 'content-type': 'text/event-stream' }); return res.end(`data: ${JSON.stringify({ result: { tools: [{ name: 'a_1mcp_x' }, { name: 'a_1mcp_y' }] } })}\n\n`); }
            res.writeHead(202); res.end();
        });
    });
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    try {
        const res = await gatewaySizeMetrics({ port: srv.address().port, token: 'tok' });
        assert.strictEqual(res.ok, true);
        assert.deepStrictEqual(res.counts, { a: 2 });
        assert.deepStrictEqual(seen, ['tools/list', 'initialize', 'notifications/initialized', 'tools/list']);
    } finally { srv.close(); }
});

test('gatewaySizeMetrics reports the real failure, not a generic one', async () => {
    const res = await gatewaySizeMetrics({ port: 7790, token: 'tok', fetchFn: async () => ({ status: 401, text: async () => 'unauthorized' }) });
    assert.strictEqual(res.ok, false);
    assert.match(res.error, /HTTP 401/);
});
