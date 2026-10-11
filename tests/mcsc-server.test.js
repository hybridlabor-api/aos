const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const hasDeps = fs.existsSync(path.join(root, 'mcps', 'mcsc', 'node_modules', '@modelcontextprotocol'));

function mcpClient(child) {
    const lines = [];
    let buf = '';
    child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
    return {
        send: (m) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n'),
        reply: async (id) => { for (let i = 0; i < 240; i++) { const m = lines.find((l) => l.id === id); if (m) return m; await new Promise((r) => setTimeout(r, 50)); } throw new Error(`no reply ${id}`); },
    };
}


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

// --- WP-MCSC: delegate_* route through `aos-a2a send --role` when a live peer exists ---

function fakeA2a(dir, body) {
    fs.writeFileSync(path.join(dir, 'aos-a2a'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

const COMPLETED = JSON.stringify({
    taskId: 't1', contextId: 'c1', state: 'TASK_STATE_COMPLETED',
    artifacts: [{ name: 'result', text: 'a2a says hi' }], statusMessage: null,
});

async function startServerWithA2a(envExtras) {
    const child = spawn(process.execPath, ['mcps/mcsc/server.js'], {
        cwd: root, env: { ...process.env, AGENTTRAIL_PORT: '1', ...envExtras }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const client = mcpClient(child);
    client.send({ id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
    await client.reply(1);
    client.send({ method: 'notifications/initialized' });
    return { child, client };
}

async function callDelegate(client, name, args) {
    client.send({ id: 2, method: 'tools/call', params: { name, arguments: args } });
    return (await client.reply(2)).result;
}

test('delegate_opencode prefers aos-a2a send --role with an args array and no proxy env', { skip: hasDeps ? false : 'mcps/mcsc/node_modules missing' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcsc-a2a-'));
    const log = path.join(dir, 'log');
    fakeA2a(dir, `for a in "$@"; do echo "ARG=$a" >> "$A2A_LOG"; done;
printf '%s\\n' "SIDECAR=$AOS_A2A_SIDECAR" >> "$A2A_LOG";
printf '%s\\n' "PROXY=$HTTPS_PROXY|$HTTP_PROXY|$https_proxy|$ALL_PROXY" >> "$A2A_LOG";
echo '${COMPLETED}'`);
    const saved = { PATH: process.env.PATH };
    try {
        const shimPath = `${dir}:${saved.PATH}`;
        process.env.PATH = shimPath;
        const { child, client } = await startServerWithA2a({ PATH: shimPath, A2A_LOG: log });
        try {
            const result = await callDelegate(client, 'delegate_opencode', { prompt: 'hello' });
            assert.equal(result.isError, undefined);
            assert.equal(result.content[0].text, 'a2a says hi');
        } finally { child.kill(); }
        const logLines = fs.readFileSync(log, 'utf8').trim().split('\n');
        const args = logLines.filter((l) => l.startsWith('ARG=')).map((l) => l.slice(4));
        assert.equal(args[0], 'send');
        assert.deepEqual(args.slice(1, 4), ['--role', 'opencode', '--from']);
        assert.equal(args[args.length - 3], '--timeout');
        assert.equal(args[args.length - 1], 'hello');
        assert.equal(args.filter((a) => a === '--from').length, 1, 'one --from flag');
        assert.ok(!args.some((a) => /\s/.test(a)), 'every argv entry is a single argument (no shell-joined string)');
        assert.equal(logLines[logLines.length - 2], 'SIDECAR=off');
        assert.ok(/PROXY=\|\|\|$/.test(logLines[logLines.length - 1]), 'no proxy env reaches the aos-a2a child');
    } finally {
        process.env.PATH = saved.PATH;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('delegate_opencode maps a non-COMPLETED a2a state to an error result', { skip: hasDeps ? false : 'mcps/mcsc/node_modules missing' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcsc-a2a-'));
    fakeA2a(dir, `echo '{"taskId":"t2","contextId":"c2","state":"TASK_STATE_WORKING","artifacts":[],"statusMessage":"still running"}'; exit 1`);
    const saved = { PATH: process.env.PATH };
    try {
        const shimPath = `${dir}:${saved.PATH}`;
        process.env.PATH = shimPath;
        const { child, client } = await startServerWithA2a({ PATH: shimPath });
        try {
            const result = await callDelegate(client, 'delegate_codex', { prompt: 'hello' });
            assert.equal(result.isError, true);
        } finally { child.kill(); }
    } finally {
        process.env.PATH = saved.PATH;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('no live peer: aos-a2a reports none and the native adapter takes over', { skip: hasDeps ? false : 'mcps/mcsc/node_modules missing' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcsc-a2a-'));
    fakeA2a(dir, `echo 'aos-a2a: no live registry entry with skill id "codex"' >&2; exit 2`);
    fs.writeFileSync(path.join(dir, 'codex'), '#!/bin/sh\necho \'{"type":"turn.completed","last_agent_message":"native says hi"}\'\n', { mode: 0o755 });
    const saved = { PATH: process.env.PATH };
    try {
        const shimPath = `${dir}:${saved.PATH}`;
        process.env.PATH = shimPath;
        const { child, client } = await startServerWithA2a({ PATH: shimPath });
        try {
            const result = await callDelegate(client, 'delegate_codex', { prompt: 'hello' });
            assert.equal(result.isError, undefined, JSON.stringify(result));
            assert.equal(result.content[0].text, 'native says hi');
        } finally { child.kill(); }
    } finally {
        process.env.PATH = saved.PATH;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});


