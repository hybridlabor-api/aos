// A planted FIFO (or an oversized file) at any agent-writable path on the go-gate decision path
// must never hang the hook (a hook timeout fails open). Each row plants the FIFO, runs the hook
// as a child with a 15 s timeout and compares the decision with the same fixture without it.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync, execFileSync } = require('child_process');

const GATE = path.resolve(__dirname, '..', '.claude', 'hooks', 'go-gate.mjs');
const TOKEN = path.resolve(__dirname, '..', '.claude', 'hooks', 'go-token.mjs');

process.env.AOS_TEST_SANDBOX = '1';
process.env.GIT_CONFIG_NOSYSTEM = '1';
for (const k of Object.keys(process.env)) if (/^GIT_/.test(k) && k !== 'GIT_CONFIG_NOSYSTEM') delete process.env[k];

let haveFifo = true;
try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-fifo-probe-'));
    execFileSync('mkfifo', [path.join(d, 'p')]);
} catch { haveFifo = false; }
const skip = haveFifo ? false : 'mkfifo unavailable';

const DENIED = 'git push https://user:pw@github.com/x/y.git main';
const RUN = 'bash ./run.sh';
const mkfifo = (p) => execFileSync('mkfifo', [p]);
// Fixture dirs are left under os.tmpdir() on purpose (no recursive deletes in tests).

// plant(kind, p): 'fifo' | 'big' | undefined (absent)
function fixture(site, kind, command = DENIED) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-fifo-'));
    const work = path.join(home, 'work');
    const gateDir = path.join(home, '.aos', 'gate');
    const goDir = path.join(home, '.aos', 'go');
    for (const d of [path.join(work, '.git'), gateDir, goDir, path.join(home, '.claude')]) fs.mkdirSync(d, { recursive: true });
    const t = path.join(home, 'session.jsonl');
    const paths = {
        state: path.join(gateDir, 'sess-f.json'),
        block: path.join(gateDir, 'sess-f.block'),
        log: path.join(gateDir, 'sess-f.log'),
        transcript: t,
        consumed: path.join(goDir, '.consumed'),
        token: path.join(goDir, 'worker-7.token'),
        config: path.join(work, '.git', 'config'),
        head: path.join(work, '.git', 'HEAD'),
        script: path.join(work, 'run.sh'),
    };
    const defaults = {
        head: 'ref: refs/heads/feat/work\n', config: '', transcript: '',
        script: 'echo hi\n',
    };
    if (site === 'consumed') {
        fs.writeFileSync(t, JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'GO worker-7' } }) + '\n');
        fs.writeFileSync(paths.token, JSON.stringify({ target: 'worker-7', issued_at: new Date().toISOString(), master_transcript: t }));
    }
    for (const k of ['head', 'config', 'transcript', 'script']) {
        if (k === site) continue;
        if (k === 'transcript' && site === 'consumed') continue;
        fs.writeFileSync(paths[k], defaults[k]);
    }
    if (kind === 'fifo') mkfifo(paths[site]);
    else if (kind === 'big') fs.writeFileSync(paths[site], Buffer.alloc(site === 'log' ? 17 << 20 : 4 << 20, 'x'));
    const r = spawnSync(process.execPath, [GATE], {
        input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: site === 'script' ? RUN : command }, transcript_path: t, session_id: 'sess-f', cwd: work }),
        env: { ...process.env, HOME: home, XDG_DATA_HOME: '', XDG_CONFIG_HOME: path.join(home, '.config'), AOS_SESSION_NAME: 'worker-7', AOS_ACP_CLIENT: '', AOS_GATE_PROTECTED_BRANCHES: '' },
        encoding: 'utf8', timeout: 15000,
    });
    return r;
}
const done = (r) => assert.ok(r.status !== null && !r.error, `hook hung or failed to terminate: ${r.error || r.signal}`);

describe('go-gate FIFO / oversize hardening', { skip }, () => {
    for (const site of ['state', 'log', 'transcript', 'config', 'head', 'script']) {
        test(`${site}: planted FIFO gives the same decision as an absent path`, () => {
            const base = fixture(site, undefined);
            const r = fixture(site, 'fifo');
            done(r);
            assert.equal(r.status, base.status);
        });
    }

    test('block marker: planted FIFO terminates and fails closed (cooldown on)', () => {
        const r = fixture('block', 'fifo');
        done(r);
        assert.equal(r.status, 2);
    });

    test('block marker: planted FIFO keeps the cooldown window open for a freshly written script', () => {
        const base = fixture('block', undefined, RUN);
        assert.equal(base.status, 0);
        const r = fixture('block', 'fifo', RUN);
        done(r);
        assert.equal(r.status, 2);
        assert.match(r.stderr, /freshly written script/);
    });

    test('block marker: planted FIFO window still holds 50 ms after the read', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-fifo-win-'));
        fs.mkdirSync(path.join(home, '.aos', 'gate'), { recursive: true });
        mkfifo(path.join(home, '.aos', 'gate', 'k.block'));
        const code = `import('${GATE}').then(async (m) => { const ts = m.readBlockTs('k'); await new Promise((r) => setTimeout(r, 50)); console.log(JSON.stringify([Date.now() - ts < m.COOLDOWN_MS, Date.now() - ts > 60000])); })`;
        const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 15000 });
        done(r);
        assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()), [true, true]);
    });

    test('block marker: absent marker is no cooldown (decision unchanged)', () => {
        const r = fixture('block', undefined);
        done(r);
        assert.equal(r.status, 2);
    });

    test('token: planted FIFO terminates and is denied', () => {
        const r = fixture('token', 'fifo');
        done(r);
        assert.equal(r.status, 2);
    });

    test('consumed list: planted FIFO terminates and is denied', () => {
        const r = fixture('consumed', 'fifo');
        done(r);
        assert.equal(r.status, 2);
    });

    for (const site of ['state', 'log', 'config']) {
        test(`${site}: oversized regular file terminates with the absent-path decision`, () => {
            const base = fixture(site, undefined);
            const r = fixture(site, 'big');
            done(r);
            assert.equal(r.status, base.status);
        });
    }

    test('go-token hook: a regular transcript above the old 256 MiB cap is still read', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-fifo-big-'));
        const t = path.join(home, 't.jsonl');
        const fd = fs.openSync(t, 'w');
        const blank = Buffer.alloc(1 << 20, 'a');
        blank[blank.length - 1] = 10;
        for (let i = 0; i < 257; i++) fs.writeSync(fd, blank);
        fs.writeSync(fd, JSON.stringify({ type: 'custom-title', customTitle: 'master-big' }) + '\n');
        fs.closeSync(fd);
        const r = spawnSync(process.execPath, [TOKEN], {
            input: JSON.stringify({ prompt: 'GO worker-7', transcript_path: t }),
            env: { ...process.env, HOME: home, AOS_SESSION_NAME: '', AOS_ACP_CLIENT: '' }, encoding: 'utf8', timeout: 15000,
        });
        done(r);
        const tok = JSON.parse(fs.readFileSync(path.join(home, '.aos', 'go', 'worker-7.token'), 'utf8'));
        assert.equal(tok.master_session, 'master-big');
    });

    test('transcript: a sparse 1.2 GiB file without newlines is denied quickly (line limit, fail closed)', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-fifo-sparse-'));
        const work = path.join(home, 'work');
        for (const d of [path.join(work, '.git'), path.join(home, '.aos', 'gate'), path.join(home, '.claude')]) fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(path.join(work, '.git', 'HEAD'), 'ref: refs/heads/feat/work\n');
        const t = path.join(home, 'session.jsonl');
        fs.writeFileSync(t, '');
        fs.truncateSync(t, 1200 * 1024 * 1024);
        const r = spawnSync(process.execPath, [GATE], {
            input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push origin feat/work' }, transcript_path: t, session_id: 'sess-s', cwd: work }),
            env: { ...process.env, HOME: home, XDG_DATA_HOME: '', AOS_SESSION_NAME: 'worker-7', AOS_ACP_CLIENT: '', AOS_GATE_PROTECTED_BRANCHES: '' }, encoding: 'utf8', timeout: 15000,
        });
        done(r);
        assert.equal(r.status, 2);
        assert.match(r.stderr, /scan limit/);
    });

    test('lastUserText: finds the last user entry across chunk boundaries and fails closed on an oversized line', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-fifo-lines-'));
        const entry = (text) => JSON.stringify({ type: 'user', uuid: 'u', message: { role: 'user', content: text } }) + '\n';
        const small = path.join(home, 'small.jsonl');
        fs.writeFileSync(small, entry('GO') + entry('x'.repeat(3 << 20)) + entry('later ' + 'y'.repeat(2 << 20)));
        const big = path.join(home, 'big.jsonl');
        fs.writeFileSync(big, entry('GO') + entry('z'.repeat(70 << 20)));
        const code = `import('${GATE}').then((m) => { const a = m.lastUserText('${small}'); const b = m.lastUserText('${big}'); const f = [...m.fileLines('${small}')].map((l) => l.length); console.log(JSON.stringify([a.text.slice(0, 6), a.text.length, !!b.error, f.length])); })`;
        const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 60000 });
        done(r);
        const [head, len, bigErr, lines] = JSON.parse(r.stdout.trim().split('\n').pop());
        assert.equal(head, 'later ');
        assert.equal(len, 6 + (2 << 20));
        assert.equal(bigErr, true);
        assert.equal(lines, 3);
    });

    test('scan limits do not depend on process age (long-lived importers keep scanning)', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-fifo-age-'));
        const t = path.join(home, 't.jsonl');
        fs.writeFileSync(t, JSON.stringify({ type: 'user', uuid: 'u', message: { role: 'user', content: 'GO' } }) + '\n');
        const code = `process.uptime = () => 99999; import('${GATE}').then((m) => { console.log(JSON.stringify([m.lastUserText('${t}').text, [...m.fileLines('${t}')].length])); })`;
        const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 15000 });
        done(r);
        assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()), ['GO', 1]);
    });

    test('go-token hook: FIFO transcript and FIFO token path do not hang the prompt hook', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-fifo-tok-'));
        const goDir = path.join(home, '.aos', 'go');
        fs.mkdirSync(goDir, { recursive: true });
        const t = path.join(home, 't.jsonl');
        mkfifo(t);
        mkfifo(path.join(goDir, 'worker-7.token'));
        const r = spawnSync(process.execPath, [TOKEN], {
            input: JSON.stringify({ prompt: 'GO worker-7', transcript_path: t }),
            env: { ...process.env, HOME: home, AOS_SESSION_NAME: 'master', AOS_ACP_CLIENT: '' }, encoding: 'utf8', timeout: 15000,
        });
        done(r);
        assert.equal(r.status, 0);
    });
});
