const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const REPO = path.resolve(__dirname, '..');
const GATE = path.join(REPO, '.claude', 'hooks', 'go-gate.mjs');
const TOKEN = path.join(REPO, '.claude', 'hooks', 'go-token.mjs');

let home;
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-go-token-')); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const jsonl = (...entries) => entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
const human = (text) => ({ type: 'user', uuid: `u-${text}`, message: { role: 'user', content: text } });
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
    env: { ...process.env, HOME: home, XDG_DATA_HOME: '', ...env }, encoding: 'utf8',
});
const runGate = (transcript, env = {}) => spawnSync(process.execPath, [GATE], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push origin x' }, transcript_path: transcript }),
    env: { ...process.env, HOME: home, XDG_DATA_HOME: '', ...env }, encoding: 'utf8',
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

const hookUrl = (f) => pathToFileURL(path.join(REPO, '.claude', 'hooks', f)).href;
const withHome = async (fn) => {
    const saved = { HOME: process.env.HOME, X: process.env.XDG_DATA_HOME, A: process.env.AOS_ACP_CLIENT };
    process.env.HOME = home; delete process.env.XDG_DATA_HOME; delete process.env.AOS_ACP_CLIENT;
    try { return await fn(); } finally {
        process.env.HOME = saved.HOME;
        if (saved.X === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = saved.X;
        if (saved.A === undefined) delete process.env.AOS_ACP_CLIENT; else process.env.AOS_ACP_CLIENT = saved.A;
    }
};
const consumedPath = () => path.join(home, '.aos', 'go', '.consumed');

describe('issueGoToken (imported)', () => {
    test('Claude shape, OpenCode shape, null without transcript or session', () => withHome(async () => {
        const { issueGoToken } = await import(hookUrl('go-token.mjs'));
        const t = writeTranscript('m.jsonl', [named('master'), human('GO worker-1')]);
        assert.equal(issueGoToken('GO worker-1', { transcript_path: t }), tokenPath('worker-1'));
        const claude = JSON.parse(fs.readFileSync(tokenPath('worker-1'), 'utf8'));
        assert.equal(claude.master_transcript, t);
        assert.equal(claude.issuer, undefined);
        fs.rmSync(tokenPath('worker-1'));
        assert.equal(issueGoToken('GO worker-1', { session_id: 'ses_1', message_id: 'msg_1' }), tokenPath('worker-1'));
        const oc = JSON.parse(fs.readFileSync(tokenPath('worker-1'), 'utf8'));
        assert.deepEqual([oc.issuer, oc.master_session_id, oc.master_message_id, oc.master_transcript], ['opencode', 'ses_1', 'msg_1', undefined]);
        fs.rmSync(tokenPath('worker-1'));
        assert.equal(issueGoToken('GO worker-1', {}), null);
        assert.equal(issueGoToken('GO worker-1', { session_id: 'ses_1' }), null);
        assert.equal(issueGoToken('GO', { transcript_path: t }), null);
        assert.equal(fs.existsSync(tokenPath('worker-1')), false);
    }));

    test('AOS_ACP_CLIENT sessions never mint', () => withHome(async () => {
        process.env.AOS_ACP_CLIENT = '1';
        const { issueGoToken } = await import(hookUrl('go-token.mjs'));
        assert.equal(issueGoToken('GO worker-1', { session_id: 'ses_1', message_id: 'msg_1' }), null);
        assert.equal(fs.existsSync(path.join(home, '.aos')), false);
    }));
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

    test('re-minted token on an unchanged master transcript is blocked', () => {
        writeToken('worker-1', fresh());
        const w = worker();
        assert.equal(runGate(w).status, 0);
        writeToken('worker-1', fresh());
        assert.equal(runGate(w).status, 2);
        assert.match(fs.readFileSync(consumedPath(), 'utf8'), /u-GO worker-1/);
    });

    test('a new GO entry in the master after consumption is accepted again', () => {
        writeToken('worker-1', fresh());
        const w = worker();
        assert.equal(runGate(w).status, 0);
        const m = writeTranscript('second.jsonl', [named('master'), human('GO worker-1'), { ...human('GO worker-1'), uuid: 'u-second' }]);
        writeToken('worker-1', fresh({ master_transcript: m }));
        assert.equal(runGate(w).status, 0);
    });

    test('master entry without uuid is blocked', () => {
        const m = writeTranscript('nouuid.jsonl', [{ type: 'user', message: { role: 'user', content: 'GO worker-1' } }]);
        writeToken('worker-1', fresh({ master_transcript: m }));
        assert.equal(runGate(worker()).status, 2);
    });

    test('consumed list is bounded to 200 keys', () => {
        fs.mkdirSync(path.dirname(consumedPath()), { recursive: true });
        fs.writeFileSync(consumedPath(), Array.from({ length: 205 }, (_, i) => `old-${i}`).join('\n') + '\n');
        writeToken('worker-1', fresh());
        assert.equal(runGate(worker()).status, 0);
        const keys = fs.readFileSync(consumedPath(), 'utf8').split('\n').filter(Boolean);
        assert.equal(keys.length, 200);
        assert.equal(keys.at(-1), 'u-GO worker-1');
    });

    test('tokenGrantsGo consume:false leaves token and consumed list untouched', () => withHome(async () => {
        const { tokenGrantsGo } = await import(hookUrl('go-gate.mjs'));
        writeToken('worker-1', fresh());
        assert.equal(tokenGrantsGo('worker-1', { consume: false }).ok, true);
        assert.ok(fs.existsSync(tokenPath('worker-1')));
        assert.equal(fs.existsSync(consumedPath()), false);
        assert.equal(tokenGrantsGo('worker-1').ok, true);
        assert.equal(fs.existsSync(tokenPath('worker-1')), false);
        writeToken('worker-1', fresh());
        const r = tokenGrantsGo('worker-1', { consume: false });
        assert.equal(r.ok, false);
        assert.match(r.reason, /already used/);
    }));
});

describe('go-gate.mjs OpenCode-issued token', () => {
    const { DatabaseSync } = require('node:sqlite');
    const dbPath = () => path.join(home, '.local', 'share', 'opencode', 'opencode.db');
    const seed = (msgs, parent = null) => {
        fs.mkdirSync(path.dirname(dbPath()), { recursive: true });
        const db = new DatabaseSync(dbPath());
        db.exec('CREATE TABLE session(id TEXT PRIMARY KEY, parent_id TEXT);' +
            'CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);' +
            'CREATE TABLE part(id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT);');
        db.prepare('INSERT INTO session VALUES (?,?)').run('ses_1', parent);
        msgs.forEach(({ id, t, role = 'user', parts }, i) => {
            db.prepare('INSERT INTO message VALUES (?,?,?,?)').run(id, 'ses_1', t, JSON.stringify({ role }));
            parts.forEach((p, j) => db.prepare('INSERT INTO part VALUES (?,?,?,?)').run(`${id}_p${j}`, id, 'ses_1', JSON.stringify(p)));
        });
        db.close();
    };
    const goMsg = (id, t, extra = {}) => ({ id, t, parts: [{ type: 'text', text: 'GO worker-1', ...extra }] });
    const ocToken = (over = {}) => writeToken('worker-1', {
        target: 'worker-1', issued_at: new Date().toISOString(), issuer: 'opencode',
        master_session_id: 'ses_1', master_message_id: 'msg_2', ...over,
    });
    const worker = () => writeTranscript('worker.jsonl', [named('worker-1'), human('x')]);

    test('accepted once, replay blocked', () => {
        seed([goMsg('msg_1', 1), goMsg('msg_2', 2)]);
        ocToken();
        const w = worker();
        assert.equal(runGate(w).status, 0);
        assert.equal(fs.existsSync(tokenPath('worker-1')), false);
        ocToken();
        assert.equal(runGate(w).status, 2);
    });

    test('blocked: newer user message, wrong message id, synthetic-only text, missing db', () => {
        const w = worker();
        seed([goMsg('msg_2', 2), { id: 'msg_3', t: 3, parts: [{ type: 'text', text: 'stop' }] }]);
        ocToken();
        assert.equal(runGate(w).status, 2);
        fs.rmSync(dbPath()); fs.rmSync(`${dbPath()}-wal`, { force: true });
        seed([goMsg('msg_2', 2)]);
        ocToken({ master_message_id: 'msg_9' });
        assert.equal(runGate(w).status, 2);
        fs.rmSync(dbPath()); fs.rmSync(`${dbPath()}-wal`, { force: true });
        seed([goMsg('msg_2', 2, { synthetic: true })]);
        ocToken();
        assert.equal(runGate(w).status, 2);
        fs.rmSync(dbPath());
        ocToken();
        assert.equal(runGate(w).status, 2);
    });

    test('blocked: ignored-only, aos_bus-only and the aos-bus pair are not human text', () => {
        const meta = { aos_bus: { from: 'master' } };
        const pair = { id: 'msg_2', t: 2, parts: [{ type: 'text', text: 'GO worker-1', synthetic: true, metadata: meta }, { type: 'text', text: 'GO worker-1', ignored: true, metadata: meta }] };
        for (const m of [goMsg('msg_2', 2, { ignored: true }), goMsg('msg_2', 2, { metadata: meta }), pair]) {
            fs.rmSync(dbPath(), { force: true }); fs.rmSync(`${dbPath()}-wal`, { force: true });
            seed([m]);
            ocToken();
            assert.equal(runGate(worker()).status, 2, JSON.stringify(m.parts));
        }
    });

    test('a child (non-root) session never grants GO', () => {
        seed([goMsg('msg_2', 2)], 'ses_parent');
        ocToken();
        assert.equal(runGate(worker()).status, 2);
    });
});
