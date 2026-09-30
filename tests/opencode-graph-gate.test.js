// W-5 / W-6: the OpenCode graph gate.
//
// Two behaviours, tested through the public plugin surface rather than through
// internals, so the test tracks what OpenCode actually calls:
//
//   W-5  chat.message recognises the AOS pipeline group, not just
//        /startcycle-graph. Before the fix the regex was anchored to that one
//        name, so /startcycle and /startcycle-graph-user got nothing.
//
//   W-6  the session.idle loop-keeper. Claude Code blocks the exit in
//        .claude/hooks/graph-gate.mjs; OpenCode has no Stop event, so an open
//        graph gate is kept alive by prompting the idle session instead. It
//        must fail open, must never write state.json, and must stop nudging.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO_ROOT = path.resolve(__dirname, '..');
const PLUGIN_PATH = path.join(REPO_ROOT, '.opencode', 'plugins', 'bdb-aos.js');
const STATE_REL = path.join('production_artifacts', 'state.json');

async function loadPlugin(directory) {
    const mod = await import(`file://${PLUGIN_PATH}?t=${Date.now()}${Math.random()}`);
    const prompts = [];
    const client = {
        session: {
            prompt: async (args) => { prompts.push(args); return { data: {} }; },
            messages: async () => ({ data: [] }),
        },
    };
    const hooks = await mod.default({ directory, client });
    return { hooks, prompts, client };
}

function writeState(directory, state) {
    const p = path.join(directory, STATE_REL);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, typeof state === 'string' ? state : JSON.stringify(state, null, 2));
    return p;
}

function msgParts() {
    return [];
}

describe('OpenCode graph plugin: W-5 pipeline command matcher', () => {
    let dir;
    let hooks;

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-graph-'));
        ({ hooks } = await loadPlugin(dir));
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    async function send(text) {
        const parts = msgParts();
        await hooks['chat.message']({ sessionID: 's1', messageID: 'm1' }, { parts });
        parts.length = 0;
        parts.push({ type: 'text', text });
        await hooks['chat.message']({ sessionID: 's1', messageID: 'm2' }, { parts });
        return parts.filter(p => p.synthetic).map(p => p.text).join('\n');
    }

    for (const name of ['startcycle', 'startcycle-graph', 'startcycle-graph-user']) {
        test(`/${name} injects the graph instructions`, async () => {
            const out = await send(`/${name} build the thing`);
            assert.ok(out.includes('production_artifacts/state.json'),
                `/${name} must name the persisted state file`);
            assert.ok(out.includes('.agents/nodes.json'),
                `/${name} must name the node registry`);
            assert.ok(out.includes('build the thing'), `/${name} must carry the goal through`);
        });
    }

    test('the goal is preserved verbatim for /startcycle-graph', async () => {
        const goal = 'ship a multi-agent pipeline for opencode';
        const out = await send(`/startcycle-graph ${goal}`);
        assert.ok(out.includes(goal));
    });

    test('an unrelated slash command injects nothing', async () => {
        const out = await send('/teamwork-preview');
        // Honest: teamwork-preview is backed by .claude/workflows/teamwork-dispatch.mjs,
        // a Claude Code Dynamic Workflow. Claiming it works on OpenCode would be a lie.
        assert.ok(!out.includes('production_artifacts/state.json'),
            'must not claim a graph state contract for a command it cannot run');
    });

    test('ordinary prose injects nothing', async () => {
        const out = await send('please startcycle the whole project graph');
        assert.ok(!out.includes('production_artifacts/state.json'));
    });
});

describe('OpenCode graph plugin: W-6 session.idle loop-keeper', () => {
    let dir;
    let hooks;
    let prompts;

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gate-'));
        const loaded = await loadPlugin(dir);
        hooks = loaded.hooks;
        prompts = loaded.prompts;
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    const idle = (sessionID = 's1') => hooks.event({
        event: { type: 'session.idle', properties: { sessionID } },
    });

    test('no state.json -- no prompt (fails open)', async () => {
        await idle();
        assert.strictEqual(prompts.length, 0, 'a project without a graph must stay quiet');
    });

    test('malformed state.json -- no prompt, no throw (fails open)', async () => {
        writeState(dir, '{ not json at all ');
        await idle();
        assert.strictEqual(prompts.length, 0);
    });

    test('a non-terminal phase prompts the session to continue', async () => {
        writeState(dir, { phase: 'build', findings: [] });
        await idle();
        assert.strictEqual(prompts.length, 1, 'an unfinished run must be nudged');
        const text = prompts[0].body.parts[0].text;
        assert.ok(text.includes('phase is "build"'), `prompt must name the reason: ${text}`);
        assert.ok(text.includes('escalated'), 'prompt must offer the escalation exit');
    });

    test('phase done -- no prompt', async () => {
        writeState(dir, { phase: 'done', findings: [] });
        await idle();
        assert.strictEqual(prompts.length, 0);
    });

    test('phase escalated -- no prompt (handed back to the human)', async () => {
        writeState(dir, { phase: 'escalated', findings: [] });
        await idle();
        assert.strictEqual(prompts.length, 0);
    });

    test('an open blocking finding prompts, naming the id', async () => {
        writeState(dir, {
            phase: 'review',
            findings: [
                { id: 'F-1', severity: 'blocking', node: 'engineering', status: 'open' },
                { id: 'F-2', severity: 'advisory', node: 'ui_ux', status: 'open' },
            ],
        });
        await idle();
        assert.strictEqual(prompts.length, 1);
        const text = prompts[0].body.parts[0].text;
        assert.ok(text.includes('F-1'), 'must name the blocking finding');
        assert.ok(!text.includes('F-2'), 'an advisory finding does not block');
    });

    test('a fixed or wont_fix blocking finding does not prompt', async () => {
        // phase is terminal on purpose: it isolates the finding logic, so a
        // prompt here could only come from the finding's own status.
        for (const status of ['fixed', 'wont_fix']) {
            const loaded = await loadPlugin(dir);
            writeState(dir, {
                phase: 'done',
                findings: [{ id: 'F-1', severity: 'blocking', node: 'engineering', status }],
            });
            await loaded.hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's-' + status } } });
            assert.strictEqual(loaded.prompts.length, 0, `status=${status} must not block`);
        }
    });

    test('a failing quality gate prompts', async () => {
        writeState(dir, {
            phase: 'ship',
            gate: { lint: 'pass', typecheck: 'pass', tests: 'fail' },
        });
        await idle();
        assert.strictEqual(prompts.length, 1);
        assert.ok(prompts[0].body.parts[0].text.includes('gate.tests'));
    });

    test('the nudge is bounded -- an unchanged stalled run goes quiet', async () => {
        writeState(dir, { phase: 'build', findings: [] });
        for (let i = 0; i < 8; i++) await idle();
        assert.ok(prompts.length > 0, 'must nudge at least once');
        assert.ok(prompts.length <= 3,
            `nudged ${prompts.length} times for an unchanged state, expected the ceiling to hold`);
    });

    test('a changed state re-opens the gate', async () => {
        writeState(dir, { phase: 'build', findings: [] });
        await idle();
        const afterBuild = prompts.length;
        writeState(dir, { phase: 'review', findings: [] });
        await idle();
        assert.ok(prompts.length > afterBuild, 'a new phase must be able to nudge again');
    });

    test('the plugin never writes state.json', async () => {
        const statePath = writeState(dir, { phase: 'build', findings: [] });
        const before = fs.readFileSync(statePath, 'utf8');
        await idle();
        await idle();
        assert.strictEqual(fs.readFileSync(statePath, 'utf8'), before,
            'the gate reads state; the dispatcher owns writing it');
    });

    test('non-idle events are ignored', async () => {
        writeState(dir, { phase: 'build' });
        await hooks.event({ event: { type: 'session.updated', properties: { sessionID: 's1' } } });
        await hooks.event({ event: { type: 'session.error', properties: { sessionID: 's1' } } });
        assert.strictEqual(prompts.length, 0);
    });

    test('a missing client does not throw', async () => {
        const mod = await import(`file://${PLUGIN_PATH}?t=${Date.now()}x`);
        const bare = await mod.default({ directory: dir });
        await bare.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
    });

    test('a rejected client call is swallowed', async () => {
        const mod = await import(`file://${PLUGIN_PATH}?t=${Date.now()}y`);
        const client = { session: { prompt: async () => { throw new Error('network down'); } } };
        const flaky = await mod.default({ directory: dir, client });
        writeState(dir, { phase: 'build' });
        await flaky.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
    });
});
