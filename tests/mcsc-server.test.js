const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const hasDeps = fs.existsSync(path.join(root, 'mcps', 'mcsc', 'node_modules', '@modelcontextprotocol'));

test('mcsc server answers initialize without crashing', {
    skip: hasDeps ? false : 'mcps/mcsc/node_modules missing (run npm install in mcps/mcsc)',
}, async () => {
    const child = spawn(process.execPath, ['mcps/mcsc/server.js'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    let exited = null;
    let out = '';
    let err = '';
    let timer;
    child.on('exit', (code, sig) => { exited = { code, sig }; });
    child.stderr.on('data', d => { err += d; });
    const response = new Promise(resolve => {
        child.stdout.on('data', d => {
            out += d;
            const line = out.split('\n').find(l => l.includes('"serverInfo"'));
            if (line) resolve(JSON.parse(line));
        });
    });
    try {
        child.stdin.write(JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'initialize',
            params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
        }) + '\n');
        const msg = await Promise.race([
            response,
            new Promise(r => { timer = setTimeout(() => r(null), 8000); }),
        ]);
        assert.ok(msg, `no initialize response; exited=${JSON.stringify(exited)} stderr=${err.slice(0, 500)}`);
        assert.ok(msg.result.serverInfo.name);
        assert.strictEqual(exited, null, `server exited early: ${err.slice(0, 500)}`);
    } finally {
        clearTimeout(timer);
        child.kill();
    }
});
