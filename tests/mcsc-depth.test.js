const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..');
const core = path.join(root, 'mcps', 'mcsc', 'packages', 'core', 'src');
const load = (rel) => import(pathToFileURL(path.join(core, rel)).href);

test('childEnv raises MCSC_DEPTH by one and sets the caller', async () => {
    const { childEnv, currentDepth, depthExceeded } = await load('depth.js');
    assert.equal(childEnv('agy', {}).MCSC_DEPTH, '1');
    assert.equal(childEnv('agy', { MCSC_DEPTH: '1' }).MCSC_DEPTH, '2');
    assert.equal(childEnv('codex', { MCSC_DEPTH: 'junk' }).MCSC_DEPTH, '1');
    assert.equal(childEnv('codex', { MCSC_DEPTH: '-4' }).MCSC_DEPTH, '1');
    assert.equal(childEnv('opencode', { A: 'b' }).A, 'b');
    assert.equal(childEnv('opencode', {}).MCSC_CALLER, 'opencode');
    assert.equal(currentDepth({}), 0);
    assert.equal(depthExceeded({}), false);
    assert.equal(depthExceeded({ MCSC_DEPTH: '0' }), false);
    assert.equal(depthExceeded({ MCSC_DEPTH: '1' }), true);
    assert.equal(depthExceeded({ MCSC_DEPTH: '3' }), true);
});

test('every adapter derives its child env from childEnv, never a raw MCSC_CALLER', () => {
    for (const a of ['agy', 'codex', 'opencode']) {
        const src = fs.readFileSync(path.join(core, 'adapters', `${a}.js`), 'utf8');
        assert.match(src, new RegExp(`childEnv\\('${a}'\\)`), a);
        assert.doesNotMatch(src, /MCSC_CALLER\s*:/, a);
    }
});

test('server refuses at depth in both handlers', () => {
    const src = fs.readFileSync(path.join(root, 'mcps', 'mcsc', 'packages', 'mcp', 'server.js'), 'utf8');
    assert.equal(src.match(/depthExceeded\(\)/g).length, 2);
});

function fakeBin(dir, name, body) {
    const f = path.join(dir, name);
    fs.writeFileSync(f, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

test('agy and opencode adapters hand their child depth+1; agy gets --mode accept-edits only for write', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcsc-depth-'));
    const saved = { PATH: process.env.PATH, AGENTTRAIL_PORT: process.env.AGENTTRAIL_PORT, MCSC_DEPTH: process.env.MCSC_DEPTH };
    try {
        fakeBin(dir, 'agy', 'echo "{\\"model\\":\\"m\\",\\"depth\\":\\"$MCSC_DEPTH\\",\\"args\\":\\"$*\\"}"');
        fakeBin(dir, 'opencode', 'echo "{\\"type\\":\\"text\\",\\"part\\":{\\"text\\":\\"depth=$MCSC_DEPTH caller=$MCSC_CALLER\\"}}"');
        process.env.PATH = `${dir}:${saved.PATH}`;
        process.env.AGENTTRAIL_PORT = '1';
        delete process.env.MCSC_DEPTH;
        const agy = await load('adapters/agy.js');
        const oc = await load('adapters/opencode.js');

        const ro = JSON.parse((await agy.delegate({ cwd: dir, prompt: 'p' })).output);
        assert.equal(ro.depth, '1');
        assert.ok(!ro.args.includes('accept-edits'));
        const rw = JSON.parse((await agy.delegate({ cwd: dir, prompt: 'p', write: true })).output);
        assert.match(rw.args, /--mode accept-edits/);

        assert.match((await oc.delegate({ cwd: dir, prompt: 'p' })).output, /depth=1 caller=opencode/);
        process.env.MCSC_DEPTH = '1';
        assert.equal(JSON.parse((await agy.delegate({ cwd: dir, prompt: 'p' })).output).depth, '2');
    } finally {
        for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

const hasDeps = fs.existsSync(path.join(root, 'mcps', 'mcsc', 'node_modules', '@modelcontextprotocol'));

test('server at MCSC_DEPTH=1 lists no tools and refuses a call', { skip: hasDeps ? false : 'mcps/mcsc/node_modules missing' }, async () => {
    const child = spawn(process.execPath, ['mcps/mcsc/server.js'], { cwd: root, env: { ...process.env, MCSC_DEPTH: '1', AGENTTRAIL_PORT: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = [];
    let buf = '';
    child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
    const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
    const reply = async (id) => { for (let i = 0; i < 160; i++) { const m = lines.find((l) => l.id === id); if (m) return m; await new Promise((r) => setTimeout(r, 50)); } throw new Error(`no reply ${id}`); };
    try {
        send({ id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
        await reply(1);
        send({ method: 'notifications/initialized' });
        send({ id: 2, method: 'tools/list', params: {} });
        assert.deepEqual((await reply(2)).result.tools, []);
        send({ id: 3, method: 'tools/call', params: { name: 'delegate_opencode', arguments: { prompt: 'x' } } });
        const r = (await reply(3)).result;
        assert.equal(r.isError, true);
        assert.match(r.content[0].text, /MCSC_DEPTH/);
    } finally { child.kill(); }
});
