const { test } = require('node:test');
const assert = require('node:assert');
const sec = require('../lib/mcp-secrets.js');
const { absoluteCommands } = require('../lib/gateway/migrate-memory.js');

const resolve = (servers) => Object.fromEntries(Object.entries(servers).map(([n, d]) => [n, { ...d, args: (d.args || []).map((a) => String(a).replace(/__MCPS_DIR__/g, 'C:/h/AppData/Roaming/Claude/mcps')) }]));

test('every shipped server stays AOS-owned after absoluteCommands rewrites node and deja to absolute paths', () => {
    const shipped = sec.shippedAll();
    const env = { PATH: '' };
    for (const [platform, execPath] of [['win32', 'C:\\Program Files\\nodejs\\node.exe'], ['darwin', '/usr/local/bin/node']]) {
        const written = absoluteCommands(resolve(sec.shippedServers()), { env, platform, execPath });
        for (const [name, entry] of Object.entries(written)) {
            if (!/node(\.exe)?$/i.test(entry.command) && name !== 'deja') continue;
            assert.ok(sec.isAosOwned(name, entry, null, shipped), `${platform}: ${name} ${entry.command}`);
        }
    }
});

test('a deja shim path and a node path are owned only with the shipped arguments', () => {
    const shipped = sec.shippedAll();
    assert.ok(sec.isAosOwned('deja', { command: 'cmd', args: ['/c', 'C:\\Users\\x\\AppData\\Roaming\\npm\\deja.cmd', 'mcp'] }, null, shipped));
    assert.ok(!sec.isAosOwned('deja', { command: 'cmd', args: ['/c', 'C:\\x\\evil.cmd', 'mcp'] }, null, shipped));
    assert.ok(!sec.isAosOwned('mcsc', { command: 'C:\\Program Files\\nodejs\\node.exe', args: ['C:/mine/server.js'] }, null, shipped));
    assert.ok(!sec.isAosOwned('mcsc', { command: 'C:\\tools\\other.exe', args: ['C:/h/mcps/mcsc/server.js'] }, null, shipped));
});
