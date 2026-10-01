// The OpenCode plugin is a thin adapter over the shared .claude/hooks pure functions:
// per-session GO state, shared commit/env rules, trail events, one-shot memB identity.
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { DatabaseSync } = require('node:sqlite');

const PLUGIN = path.join(__dirname, '..', '.opencode', 'plugins', 'bdb-aos.js');
const ENV_KEYS = ['HOME', 'AOS_SESSION_NAME', 'AOS_ACP_CLIENT', 'XDG_DATA_HOME', 'AGENTTRAIL_PORT'];

let home, saved, server, trail;
beforeEach(async () => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-oc-adapter-'));
    for (const k of ENV_KEYS.slice(1)) delete process.env[k];
    process.env.HOME = home;
    trail = [];
    server = http.createServer((req, res) => {
        let b = '';
        req.on('data', (c) => { b += c; });
        req.on('end', () => { try { trail.push(JSON.parse(b)); } catch {} res.end('ok'); });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    process.env.AGENTTRAIL_PORT = String(server.address().port);
});
afterEach(async () => {
    await new Promise((r) => server.close(r));
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    fs.rmSync(home, { recursive: true, force: true });
});

const load = async () => {
    const mod = await import(`file://${PLUGIN}`);
    const client = { session: { messages: async () => ({ data: [] }), get: async () => ({ data: { title: '' } }), prompt: async () => ({}) } };
    return { mod, hooks: await mod.default({ directory: home, client, $: null }) };
};
const say = (hooks, sessionID, text, messageID = 'msg_1') =>
    hooks['chat.message']({ sessionID, messageID }, { parts: [{ type: 'text', text }] });
const bash = (hooks, sessionID, command) =>
    hooks['tool.execute.before']({ tool: 'bash', sessionID, callID: `c-${Math.random()}` }, { args: { command } });
const edit = (hooks, tool, filePath) =>
    hooks['tool.execute.before']({ tool, sessionID: 's1', callID: `c-${Math.random()}` }, { args: { filePath } });
const waitFor = async (pred) => {
    for (let i = 0; i < 50 && !pred(); i++) await new Promise((r) => setTimeout(r, 20));
};

describe('OpenCode adapter', () => {
    test('module exposes only the default export', async () => {
        const { mod } = await load();
        assert.deepEqual(Object.keys(mod), ['default']);
    });

    test('GO is per session', async () => {
        const { hooks } = await load();
        await say(hooks, 's1', 'GO');
        await assert.rejects(bash(hooks, 's2', 'git push origin main'), /Blocked by BDB go-gate/);
        await bash(hooks, 's1', 'git push origin main');
    });

    test('a later non-GO prompt closes the gate again', async () => {
        const { hooks } = await load();
        await say(hooks, 's1', 'GO');
        await say(hooks, 's1', 'hello there', 'msg_2');
        await assert.rejects(bash(hooks, 's1', 'git push origin main'), /Blocked by BDB go-gate/);
    });

    test('session.messages fallback reads the SDK {info, parts} shape', async () => {
        const { mod } = await load();
        const client = { session: { get: async () => ({ data: { title: '' } }), messages: async () => ({ data: [{ info: { role: 'user' }, parts: [{ type: 'text', text: 'GO' }] }] }) } };
        const hooks = await mod.default({ directory: home, client });
        await bash(hooks, 's9', 'git push origin main');
    });

    test('env files are protected, templates and sources pass', async () => {
        const { hooks } = await load();
        await assert.rejects(edit(hooks, 'write', '/srv/app/.env'), /env-file-protection/);
        await edit(hooks, 'edit', '/srv/app/.env.example');
        await edit(hooks, 'write', '/srv/app/src/a.js');
    });

    test('conventional commits are enforced, other bash passes', async () => {
        const { hooks } = await load();
        await assert.rejects(bash(hooks, 's1', 'git commit -m "added stuff"'), /conventional-commits/);
        await bash(hooks, 's1', 'git commit -m "fix: x"');
        await bash(hooks, 's1', 'ls -la');
    });

    test('session events reach the trail', async () => {
        const { hooks } = await load();
        await hooks.event({ event: { type: 'session.created', properties: { info: { id: 'root' } } } });
        await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'root' } } });
        await hooks.event({ event: { type: 'session.created', properties: { info: { id: 'kid', parentID: 'root' } } } });
        await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'kid' } } });
        await hooks.event({ event: { type: 'permission.updated', properties: { sessionID: 'root', title: 'run it' } } });
        await waitFor(() => trail.length >= 5);
        const names = trail.map((e) => `${e.session_id}:${e.hook_event_name}`);
        assert.deepEqual(names.sort(), ['kid:SessionStart', 'kid:SubagentStop', 'root:Notification', 'root:SessionStart', 'root:Stop']);
        assert.ok(trail.every((e) => e.agent === 'opencode'));
    });

    test('memB identity is injected once per session', async () => {
        fs.mkdirSync(path.join(home, '.MemBDB'));
        fs.writeFileSync(path.join(home, '.MemBDB', 'ambient-persona.txt'), 'Persona line for tests\n');
        const db = new DatabaseSync(path.join(home, '.MemBDB', 'memb.db'));
        db.exec('CREATE TABLE memb_vectors(id TEXT PRIMARY KEY, collection TEXT, vector BLOB, payload TEXT, created_at TEXT)');
        db.close();
        const { hooks } = await load();
        const parts = async (sid, text) => {
            const out = { parts: [{ type: 'text', text }] };
            await hooks['chat.message']({ sessionID: sid, messageID: 'm' }, out);
            return out.parts.filter((p) => p.synthetic && p.text.includes('Persona line for tests'));
        };
        assert.equal((await parts('s1', 'hi')).length, 1);
        assert.equal((await parts('s1', 'hi again')).length, 0);
        assert.equal((await parts('s2', 'hi')).length, 1);
    });

    test('GO <name> mints an OpenCode token, never from an ACP worker', async () => {
        const { hooks } = await load();
        await say(hooks, 's1', 'GO worker-1', 'msg_1');
        const file = path.join(home, '.aos', 'go', 'worker-1.token');
        const tok = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.deepEqual([tok.issuer, tok.master_session_id, tok.master_message_id], ['opencode', 's1', 'msg_1']);
        fs.rmSync(file);
        process.env.AOS_ACP_CLIENT = '1';
        await say(hooks, 's1', 'GO worker-1', 'msg_2');
        assert.equal(fs.existsSync(file), false);
    });
});
