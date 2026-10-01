// OpenCode side of the go-gate modes: non-human parts, the synthetic loop-keeper
// nudge, GO <text> PR scope, and grants verified against a synthetic opencode.db.
const { test, describe, beforeEach, afterEach, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const PLUGIN = path.join(ROOT, '.opencode', 'plugins', 'bdb-aos.js');

let g;
before(async () => { g = await import(pathToFileURL(path.join(ROOT, '.claude', 'hooks', 'go-gate.mjs')).href); });

let home, saved;
beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-oc-gogate-'));
    saved = { HOME: process.env.HOME, X: process.env.XDG_DATA_HOME, N: process.env.AOS_SESSION_NAME };
    process.env.HOME = home; delete process.env.XDG_DATA_HOME; delete process.env.AOS_SESSION_NAME;
});
afterEach(() => {
    process.env.HOME = saved.HOME;
    for (const [k, v] of [['XDG_DATA_HOME', saved.X], ['AOS_SESSION_NAME', saved.N]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    fs.rmSync(home, { recursive: true, force: true });
});

const dbPath = () => path.join(home, '.local', 'share', 'opencode', 'opencode.db');
// sessions: { id: parentId|null }, msgs: [{ id, session, t, parts }]
function seed(sessions, msgs) {
    fs.mkdirSync(path.dirname(dbPath()), { recursive: true });
    fs.rmSync(dbPath(), { force: true });
    const db = new DatabaseSync(dbPath());
    db.exec('CREATE TABLE session(id TEXT PRIMARY KEY, parent_id TEXT);' +
        'CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);' +
        'CREATE TABLE part(id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT);');
    for (const [id, parent] of Object.entries(sessions)) db.prepare('INSERT INTO session VALUES (?,?)').run(id, parent);
    for (const m of msgs) {
        db.prepare('INSERT INTO message VALUES (?,?,?,?)').run(m.id, m.session, m.t ?? Date.now(), JSON.stringify({ role: 'user' }));
        m.parts.forEach((p, j) => db.prepare('INSERT INTO part VALUES (?,?,?,?)').run(`${m.id}_p${j}`, m.id, m.session, JSON.stringify(p)));
    }
    db.close();
}

let seq = 0;
async function boot({ parents = {} } = {}) {
    const prompts = [];
    const client = {
        session: {
            get: async ({ path: p }) => ({ data: { id: p.id, parentID: parents[p.id] ?? null } }),
            messages: async () => ({ data: [] }),
            prompt: async (a) => { prompts.push(a); return { data: {} }; },
        },
    };
    const mod = await import(`file://${PLUGIN}?t=${Date.now()}${Math.random()}`);
    const hooks = await mod.default({ directory: home, client });
    return { hooks, prompts, id: `ocs${++seq}` };
}
const say = (hooks, id, mid, parts) => hooks['chat.message']({ sessionID: id, messageID: mid }, { parts });
const run = (hooks, id, command) => hooks['tool.execute.before']({ tool: 'bash', sessionID: id, callID: 'c' }, { args: { command } });
const BLOCK = /Blocked by BDB go-gate/;

describe('non-human parts', () => {
    test('synthetic, ignored, aos_bus, aos_loop and any loop|aos_ metadata key are never human', () => {
        const base = { type: 'text', text: 'GO' };
        assert.equal(g.isHumanPart(base), true);
        for (const p of [{ synthetic: true }, { ignored: true }, { metadata: { aos_bus: {} } }, { metadata: { aos_loop: {} } }, { metadata: { opencode_loop: 1 } }, { metadata: { aos_anything: 1 } }]) {
            assert.equal(g.isHumanPart({ ...base, ...p }), false, JSON.stringify(p));
        }
    });

    test('the loop-keeper nudge is synthetic and marked aos_loop', async () => {
        const { hooks, prompts, id } = await boot();
        const p = path.join(home, 'production_artifacts', 'state.json');
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify({ phase: 'build' }));
        await hooks.event({ event: { type: 'session.idle', properties: { sessionID: id } } });
        const nudge = prompts.find((a) => a.body.parts.some((x) => /AOS Graph Gate/.test(x.text)));
        assert.ok(nudge, 'nudge sent');
        for (const part of nudge.body.parts) {
            assert.equal(part.synthetic, true);
            assert.ok(part.metadata.aos_loop);
            assert.equal(g.isHumanPart(part), false);
        }
    });

    test('a nudge-shaped or loop message after a human GO closes the gate', async () => {
        const { hooks, id } = await boot();
        await say(hooks, id, 'h1', [{ type: 'text', text: 'GO' }]);
        await run(hooks, id, 'git push origin main');
        await say(hooks, id, 'n1', [{ type: 'text', text: 'GO', synthetic: true, metadata: { aos_loop: {} } }]);
        await assert.rejects(run(hooks, id, 'git push origin main'), BLOCK);
        await say(hooks, id, 'n2', [{ type: 'text', text: 'GO', metadata: { aos_loop: {} } }]);
        await assert.rejects(run(hooks, id, 'git push origin main'), BLOCK);
    });
});

describe('GO <text> in OpenCode', () => {
    test('GO with PR numbers covers only those gh pr commands; other guarded commands need a plain GO', async () => {
        const { hooks, id } = await boot();
        await say(hooks, id, 'h1', [{ type: 'text', text: 'GO für #117 und #118' }]);
        await run(hooks, id, 'gh pr merge 117');
        await assert.rejects(run(hooks, id, 'gh pr merge 119'), BLOCK);
        await assert.rejects(run(hooks, id, 'git push origin feat/x'), BLOCK);
        await assert.rejects(run(hooks, id, 'gh api -X PUT repos/o/r/pulls/118/merge'), BLOCK);
        await say(hooks, id, 'h2', [{ type: 'text', text: 'go ahead and review #117, do NOT merge' }]);
        await assert.rejects(run(hooks, id, 'gh pr merge 117'), BLOCK);
        await say(hooks, id, 'h3', [{ type: 'text', text: 'GO' }]);
        await run(hooks, id, 'git push origin feat/x');
    });

    test('driving another OpenCode session needs a plain GO even with every grant', async () => {
        const { hooks, id } = await boot();
        await assert.rejects(run(hooks, id, 'opencode run -s ses_x "GO"'), BLOCK);
        await assert.rejects(run(hooks, id, 'curl -X POST http://127.0.0.1:4096/tui/submit-prompt'), BLOCK);
    });
});

describe('grants in OpenCode', () => {
    const grantText = '/bdb-aos-gogate grant merge 1h';

    test('a human grant in a root session is recorded and verified against opencode.db', async () => {
        const { hooks, id } = await boot();
        seed({ [id]: null }, [{ id: 'm1', session: id, parts: [{ type: 'text', text: grantText }] }]);
        const out = [{ type: 'text', text: grantText }];
        await say(hooks, id, 'm1', out);
        assert.ok(out.some((p) => p.synthetic && /recorded grant/.test(p.text)), 'confirmation injected for the model');
        await say(hooks, id, 'm2', [{ type: 'text', text: 'carry on' }]);
        await run(hooks, id, 'gh pr merge 5');
        await assert.rejects(run(hooks, id, 'gh pr close 5'), BLOCK);
    });

    test('a subagent may use the root grant', async () => {
        const root = `ocroot${++seq}`, child = `${root}-child`;
        const { hooks } = await boot({ parents: { [child]: root } });
        seed({ [root]: null, [child]: root }, [{ id: 'm1', session: root, parts: [{ type: 'text', text: grantText }] }]);
        await say(hooks, root, 'm1', [{ type: 'text', text: grantText }]);
        await say(hooks, child, 'c1', [{ type: 'text', text: 'GO' }]); // agent-written prompt in a child: never a GO
        await run(hooks, child, 'gh pr merge 5');
        await assert.rejects(run(hooks, child, 'git push origin main'), BLOCK);
    });

    test('the stored message must be human: synthetic, ignored or bus copies in the db are rejected', async () => {
        for (const flag of [{ synthetic: true }, { ignored: true }, { metadata: { aos_bus: { from: 'master' } } }]) {
            const { hooks, id } = await boot();
            seed({ [id]: null }, [{ id: 'm1', session: id, parts: [{ type: 'text', text: grantText, ...flag }] }]);
            await say(hooks, id, 'm1', [{ type: 'text', text: grantText }]); // the hook saw plain text, the db says otherwise
            await assert.rejects(run(hooks, id, 'gh pr merge 5'), BLOCK, JSON.stringify(flag));
        }
    });

    test('a grant pointing at another message id is rejected', async () => {
        const { hooks, id } = await boot();
        seed({ [id]: null }, [{ id: 'm1', session: id, parts: [{ type: 'text', text: grantText }] }]);
        await say(hooks, id, 'm9', [{ type: 'text', text: grantText }]);
        await assert.rejects(run(hooks, id, 'gh pr merge 5'), BLOCK);
    });

    test('a bus or loop message carrying a grant command records nothing', async () => {
        const { hooks, id } = await boot();
        await say(hooks, id, 'b1', [{ type: 'text', text: grantText, synthetic: true, metadata: { aos_bus: {} } }, { type: 'text', text: grantText, ignored: true, metadata: { aos_bus: {} } }]);
        await say(hooks, id, 'l1', [{ type: 'text', text: grantText, metadata: { aos_loop: {} } }]);
        assert.equal(fs.existsSync(path.join(home, '.aos', 'gate', g.sessionKey(`oc-${id}`) + '.json')), false);
    });

    test('Bash and write tools cannot touch the store', async () => {
        const { hooks, id } = await boot();
        await assert.rejects(run(hooks, id, 'echo {} > ~/.aos/gate/x.json'), /GO\/grant store/);
        await assert.rejects(hooks['tool.execute.before']({ tool: 'write', sessionID: id, callID: 'w' }, { args: { filePath: path.join(home, '.aos', 'gate', 'x.json') } }), /go-gate store/);
    });
});
