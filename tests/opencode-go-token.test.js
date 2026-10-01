// The OpenCode plugin's go-gate accepts the master-session GO token
// (~/.aos/go/<session>.token) with the same rules as .claude/hooks/go-gate.mjs.
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN = path.join(__dirname, '..', '.opencode', 'plugins', 'bdb-aos.js');

let home, savedHome, savedName;
beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-oc-token-'));
    savedHome = process.env.HOME; savedName = process.env.AOS_SESSION_NAME;
    process.env.HOME = home; delete process.env.AOS_SESSION_NAME;
});
afterEach(() => {
    process.env.HOME = savedHome;
    if (savedName === undefined) delete process.env.AOS_SESSION_NAME; else process.env.AOS_SESSION_NAME = savedName;
    fs.rmSync(home, { recursive: true, force: true });
});

const jsonl = (...e) => e.map((x) => JSON.stringify(x)).join('\n') + '\n';
const master = (name, last = `GO ${name}`) => {
    const p = path.join(home, 'master.jsonl');
    fs.writeFileSync(p, jsonl({ type: 'user', message: { role: 'user', content: last } }));
    return p;
};
const tokenPath = (name) => path.join(home, '.aos', 'go', `${name}.token`);
const writeToken = (name, over = {}) => {
    fs.mkdirSync(path.dirname(tokenPath(name)), { recursive: true });
    fs.writeFileSync(tokenPath(name), JSON.stringify({ target: name, issued_at: new Date().toISOString(), master_transcript: master(name), ...over }));
};

async function guard(title) {
    const mod = await import(`file://${PLUGIN}?t=${Date.now()}${Math.random()}`);
    const client = { session: { messages: async () => ({ data: [] }), get: async () => ({ data: { title } }) } };
    const hooks = await mod.default({ directory: home, client });
    return () => hooks['tool.execute.before']({ tool: 'bash', sessionID: 's1', callID: 'c1' }, { args: { command: 'git push origin main' } });
}

describe('OpenCode plugin GO-token path', () => {
    test('blocked without token', async () => {
        await assert.rejects((await guard('worker-1'))(), /Blocked by BDB go-gate/);
    });

    test('token for the session title opens the gate once', async () => {
        writeToken('worker-1');
        const run = await guard('worker-1');
        await run();
        assert.equal(fs.existsSync(tokenPath('worker-1')), false, 'token consumed');
        await assert.rejects(run(), /Blocked/);
    });

    test('AOS_SESSION_NAME wins over the session title', async () => {
        process.env.AOS_SESSION_NAME = 'worker-2';
        writeToken('worker-2');
        await (await guard('worker-1'))();
    });

    test('other target, expired, stale master transcript: blocked, token untouched', async () => {
        writeToken('worker-9');
        await assert.rejects((await guard('worker-1'))(), /Blocked/);
        writeToken('worker-1', { issued_at: new Date(Date.now() - 11 * 60000).toISOString() });
        await assert.rejects((await guard('worker-1'))(), /Blocked/);
        writeToken('worker-1');
        master('worker-1', 'stop');
        await assert.rejects((await guard('worker-1'))(), /Blocked/);
        assert.ok(fs.existsSync(tokenPath('worker-1')));
    });

    test('literal GO path unchanged', async () => {
        const mod = await import(`file://${PLUGIN}?t=${Date.now()}${Math.random()}`);
        const hooks = await mod.default({ directory: home, client: { session: { messages: async () => ({ data: [] }) } } });
        await hooks['chat.message']({ sessionID: 's1' }, { parts: [{ type: 'text', text: 'GO' }] });
        await hooks['tool.execute.before']({ tool: 'bash', sessionID: 's1', callID: 'c1' }, { args: { command: 'git push' } });
    });
});
