const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const GATE = path.join(REPO, '.claude', 'hooks', 'go-gate.mjs');
const TOKEN = path.join(REPO, '.claude', 'hooks', 'go-token.mjs');

let home;
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-go-token-')); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const jsonl = (...entries) => entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
const human = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const named = (name) => ({ type: 'agent-name', agentName: name });

const writeTranscript = (name, entries) => {
    const p = path.join(home, name);
    fs.writeFileSync(p, jsonl(...entries));
    return p;
};
const tokenPath = (session) => path.join(home, '.aos', 'go', `${session}.token`);
const writeToken = (session, data) => {
    fs.mkdirSync(path.dirname(tokenPath(session)), { recursive: true });
    fs.writeFileSync(tokenPath(session), JSON.stringify(data));
};

const runToken = (prompt, transcript, env = {}) => spawnSync(process.execPath, [TOKEN], {
    input: JSON.stringify({ prompt, transcript_path: transcript }),
    env: { ...process.env, HOME: home, ...env }, encoding: 'utf8',
});
const runGate = (transcript, env = {}) => spawnSync(process.execPath, [GATE], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push origin x' }, transcript_path: transcript }),
    env: { ...process.env, HOME: home, ...env }, encoding: 'utf8',
});

describe('go-token.mjs (UserPromptSubmit)', () => {
    test('GO <session> writes the token', () => {
        const t = writeTranscript('m.jsonl', [named('master'), human('GO worker-1')]);
        const r = runToken('GO worker-1', t);
        assert.equal(r.status, 0);
        const tok = JSON.parse(fs.readFileSync(tokenPath('worker-1'), 'utf8'));
        assert.equal(tok.target, 'worker-1');
        assert.equal(tok.master_transcript, t);
        assert.equal(tok.master_session, 'master');
        assert.ok(Math.abs(Date.now() - Date.parse(tok.issued_at)) < 10000);
    });

    test('case-insensitive GO, trimmed', () => {
        const t = writeTranscript('m.jsonl', [human('go Worker-1')]);
        runToken('  go Worker-1 \n', t);
        assert.ok(fs.existsSync(tokenPath('worker-1')));
    });

    for (const prompt of ['GO', 'please GO worker-1', 'hello', 'GOWORKER']) {
        test(`writes nothing for ${JSON.stringify(prompt)}`, () => {
            const t = writeTranscript('m.jsonl', [human(prompt)]);
            const r = runToken(prompt, t);
            assert.equal(r.status, 0);
            assert.equal(fs.existsSync(path.join(home, '.aos')), false);
        });
    }
});

describe('go-gate.mjs token path', () => {
    const master = (name, file = 'master.jsonl') => writeTranscript(file, [named('master'), human(`GO ${name}`)]);
    const worker = () => writeTranscript('worker.jsonl', [named('worker-1'), human('[forwarded] GO')]);
    const fresh = (over = {}) => ({
        target: 'worker-1', issued_at: new Date().toISOString(),
        master_transcript: master('worker-1'), master_session: 'master', ...over,
    });

    test('literal GO path is unchanged', () => {
        const t = writeTranscript('w.jsonl', [human('GO')]);
        assert.equal(runGate(t).status, 0);
        const bad = writeTranscript('w2.jsonl', [human('go ahead')]);
        assert.equal(runGate(bad).status, 2);
    });

    test('valid token opens the gate and is consumed', () => {
        writeToken('worker-1', fresh());
        assert.equal(runGate(worker()).status, 0);
        assert.equal(fs.existsSync(tokenPath('worker-1')), false);
    });

    test('replay after consumption is blocked', () => {
        writeToken('worker-1', fresh());
        const w = worker();
        assert.equal(runGate(w).status, 0);
        assert.equal(runGate(w).status, 2);
    });

    test('expired token is blocked', () => {
        writeToken('worker-1', fresh({ issued_at: new Date(Date.now() - 11 * 60000).toISOString() }));
        assert.equal(runGate(worker()).status, 2);
    });

    test('future-dated token is blocked', () => {
        writeToken('worker-1', fresh({ issued_at: new Date(Date.now() + 60 * 60000).toISOString() }));
        assert.equal(runGate(worker()).status, 2);
    });

    test('token for another session is ignored', () => {
        writeToken('worker-2', fresh({ target: 'worker-2', master_transcript: master('worker-2') }));
        assert.equal(runGate(worker()).status, 2);
        assert.ok(fs.existsSync(tokenPath('worker-2')), 'foreign token stays untouched');
    });

    test('token whose target field disagrees with the file is blocked', () => {
        writeToken('worker-1', fresh({ target: 'worker-2' }));
        assert.equal(runGate(worker()).status, 2);
    });

    test('master transcript mismatch is blocked', () => {
        const m = writeTranscript('other.jsonl', [named('master'), human('GO worker-1'), human('actually wait')]);
        writeToken('worker-1', fresh({ master_transcript: m }));
        assert.equal(runGate(worker()).status, 2);
    });

    test('master transcript naming a different target is blocked', () => {
        writeToken('worker-1', fresh({ master_transcript: master('worker-2', 'other.jsonl') }));
        assert.equal(runGate(worker()).status, 2);
    });

    test('missing or unreadable master transcript is blocked', () => {
        writeToken('worker-1', fresh({ master_transcript: path.join(home, 'nope.jsonl') }));
        assert.equal(runGate(worker()).status, 2);
    });

    test('own name comes from the latest agent-name entry (renames win)', () => {
        writeToken('worker-1', fresh());
        const w = writeTranscript('worker.jsonl', [named('old'), named('worker-1'), human('x')]);
        assert.equal(runGate(w).status, 0);
    });

    test('custom-title is accepted when no agent-name exists', () => {
        writeToken('worker-1', fresh());
        const w = writeTranscript('worker.jsonl', [{ type: 'custom-title', customTitle: 'worker-1' }, human('x')]);
        assert.equal(runGate(w).status, 0);
    });

    test('AOS_SESSION_NAME is the fallback when the transcript carries no name', () => {
        writeToken('worker-1', fresh());
        const w = writeTranscript('worker.jsonl', [human('x')]);
        assert.equal(runGate(w).status, 2);
        assert.equal(runGate(w, { AOS_SESSION_NAME: 'worker-1' }).status, 0);
    });

    test('session names with spaces and case work end to end', () => {
        const m = writeTranscript('master.jsonl', [human('GO Aos Worker')]);
        runToken('GO Aos Worker', m);
        const w = writeTranscript('worker.jsonl', [named('aos worker'), human('x')]);
        assert.equal(runGate(w).status, 0);
    });

    test('a sidechain-free relayed message never opens the gate without a token', () => {
        assert.equal(runGate(worker()).status, 2);
    });
});
