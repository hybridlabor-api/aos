// Minimal stdio MCP server: one tool named after argv[2].
const name = process.argv[2];
let buf = '';
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
process.stdin.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const m = JSON.parse(line);
        if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name, version: '1.0.0' } } });
        else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: `${name}_tool`, description: name, inputSchema: { type: 'object', properties: {} } }] } });
        else if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, result: {} });
    }
});
