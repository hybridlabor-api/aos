// WP-8: every deny appends a structured record to <gate dir>/<key>.req.json (last 20, 0600,
// atomic, best effort). Offline: temp HOME, empty transcript. The gate only classifies the
// strings below; nothing here executes them.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const GATE = path.resolve(__dirname, '..', '.claude', 'hooks', 'go-gate.mjs');

process.env.AOS_TEST_SANDBOX = '1';
process.env.GIT_CONFIG_NOSYSTEM = '1';
for (const k of Object.keys(process.env)) if (/^GIT_/.test(k) && k !== 'GIT_CONFIG_NOSYSTEM') delete process.env[k];

let home, work, t, gateDir, reqFile;
beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-req-'));
    work = path.join(home, 'work');
    fs.mkdirSync(path.join(work, '.git'), { recursive: true });
    fs.writeFileSync(path.join(work, '.git', 'HEAD'), 'ref: refs/heads/feat/work\n');
    fs.writeFileSync(path.join(work, '.git', 'config'), '');
    for (const d of ['.claude', '.aos']) fs.mkdirSync(path.join(home, d), { recursive: true });
    t = path.join(home, 'session.jsonl');
    fs.writeFileSync(t, '');
    gateDir = path.join(home, '.aos', 'gate');
    reqFile = path.join(gateDir, 'sess-req.req.json');
});

const env = () => ({ ...process.env, HOME: home, USERPROFILE: home, XDG_DATA_HOME: '', XDG_CONFIG_HOME: path.join(home, '.config'), AOS_SESSION_NAME: 'worker-7', AOS_ACP_CLIENT: '', AOS_GATE_PROTECTED_BRANCHES: '' });
const runGate = (command) => spawnSync(process.execPath, [GATE], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, transcript_path: t, session_id: 'sess-req', cwd: work }), env: env(), encoding: 'utf8',
});
const records = () => JSON.parse(fs.readFileSync(reqFile, 'utf8'));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

describe('go-gate request records (WP-8)', () => {
    test('a denied command writes exactly one record with the right fields and no secret', () => {
        const cmd = 'GH_TOKEN=ghp_abcdefghijklmnop1234 git push https://user:hunter2@github.com/x/y.git main # Authorization: zzsecret987';
        const r = runGate(cmd);
        assert.equal(r.status, 2);
        const recs = records();
        assert.equal(recs.length, 1);
        const rec = recs[0];
        assert.deepEqual(Object.keys(rec).sort(), ['click', 'cmd_hash', 'cmd_preview', 'cwd', 'hard', 'id', 'scopes', 'session_key', 'session_name', 'ts'].sort());
        assert.ok(rec.id && typeof rec.id === 'string');
        assert.ok(Math.abs(Date.parse(rec.ts) - Date.now()) < 60000);
        assert.equal(rec.session_key, 'sess-req');
        assert.equal(rec.session_name, 'worker-7');
        assert.equal(rec.cwd, work);
        assert.equal(rec.hard, false);
        assert.equal(rec.click, false, 'a command with secrets is never click-approvable');
        assert.equal(rec.cmd_hash, sha(cmd.replace(/\s+/g, ' ').trim()));
        assert.ok(Array.isArray(rec.scopes) || rec.scopes === null);
        assert.ok(rec.cmd_preview.length <= 200);
        assert.ok(rec.cmd_preview.includes('git push'));
        for (const secret of ['ghp_abcdefghijklmnop1234', 'hunter2', 'zzsecret987']) assert.ok(!rec.cmd_preview.includes(secret), secret);
        assert.ok(!fs.readFileSync(reqFile, 'utf8').includes('hunter2'));
        const log = fs.readFileSync(path.join(gateDir, 'sess-req.log'), 'utf8');
        for (const secret of ['ghp_abcdefghijklmnop1234', 'hunter2', 'zzsecret987']) assert.ok(!log.includes(secret), `log: ${secret}`);
    });

    test('a hard block sets hard:true', () => {
        assert.equal(runGate('rm -rf ~').status, 2);
        const recs = records();
        assert.equal(recs.length, 1);
        assert.equal(recs[0].hard, true);
        assert.equal(recs[0].click, false);
    });

    test('click is true only for a short, printable-ASCII, normal-form command without secrets', () => {
        const click = (cmd) => { assert.equal(runGate(cmd).status, 2); const r = records(); return r[r.length - 1].click; };
        assert.equal(click('git push origin main'), true);
        assert.equal(click('git push  origin main'), false, 'double space');
        assert.equal(click('git push origin main\n'), false, 'newline');
        assert.equal(click('git push origin café'), false, 'non-ASCII');
        assert.equal(click(`git push origin ${'x'.repeat(200)}`), false, 'longer than 200');
        assert.equal(click('git push origin main --token abc123'), false, 'secret masked in the preview');
    });

    test('keeps only the last 20 records, oldest dropped', () => {
        for (let i = 0; i < 23; i++) assert.equal(runGate(`git push origin br${i}`).status, 2);
        const recs = records();
        assert.equal(recs.length, 20);
        assert.match(recs[0].cmd_preview, /br3$/);
        assert.match(recs[19].cmd_preview, /br22$/);
        assert.equal(new Set(recs.map((x) => x.id)).size, 20);
    });

    test('file is a regular 0600 file and no tmp file is left behind', () => {
        runGate('git push origin main');
        const st = fs.lstatSync(reqFile);
        assert.ok(st.isFile());
        if (process.platform !== 'win32') assert.equal(st.mode & 0o777, 0o600); // Windows reports 0666
        assert.deepEqual(fs.readdirSync(gateDir).filter((f) => f.endsWith('.tmp')), []);
    });

    test('a write failure (req path is a directory) leaves decision and output unchanged', () => {
        const ok = runGate('git push origin main');
        fs.rmSync(gateDir, { recursive: true });
        fs.mkdirSync(reqFile, { recursive: true });
        const bad = runGate('git push origin main');
        assert.equal(bad.status, ok.status);
        assert.equal(bad.status, 2);
        assert.equal(bad.stdout, ok.stdout);
        assert.equal(bad.stderr, ok.stderr);
        assert.ok(fs.lstatSync(reqFile).isDirectory());
    });

    test('a read-only gate dir still denies with the same output', (ctx) => {
        if (process.getuid && process.getuid() === 0) return ctx.skip('root ignores chmod');
        const ok = runGate('git push origin main');
        fs.rmSync(gateDir, { recursive: true });
        fs.mkdirSync(gateDir, { recursive: true, mode: 0o700 });
        fs.chmodSync(gateDir, 0o500);
        try {
            const bad = runGate('git push origin main');
            assert.equal(bad.status, ok.status);
            assert.equal(bad.stdout, ok.stdout);
            assert.equal(bad.stderr, ok.stderr);
        } finally { fs.chmodSync(gateDir, 0o700); }
    });

    test('an allowed command writes nothing', () => {
        assert.equal(runGate('ls -la').status, 0);
        assert.equal(runGate('git status').status, 0);
        assert.ok(!fs.existsSync(reqFile));
    });

    test('cmd_hash is stable for the same command and ignores whitespace noise', () => {
        runGate('git push origin main');
        runGate('git   push origin  main');
        runGate('git push origin other');
        const [a, b, c] = records();
        assert.equal(a.cmd_hash, b.cmd_hash);
        assert.notEqual(a.cmd_hash, c.cmd_hash);
        assert.notEqual(a.id, b.id);
    });

    test('listStateKeys skips *.req.json', async () => {
        runGate('git push origin main');
        fs.writeFileSync(path.join(gateDir, 'other.json'), '{}');
        const out = spawnSync(process.execPath, ['--input-type=module', '-e', `import('${pathToFileURL(GATE).href}').then(m => console.log(JSON.stringify(m.listStateKeys())))`], { env: env(), encoding: 'utf8' });
        const keys = JSON.parse(out.stdout.trim().split('\n').pop());
        assert.ok(keys.includes('other'));
        assert.ok(!keys.some((k) => k.includes('req')));
    });

    test('a >16K command still yields cmd_preview <= 200', () => {
        assert.equal(runGate('git push origin main # ' + 'x'.repeat(20000)).status, 2);
        assert.ok(records()[0].cmd_preview.length <= 200);
    });

    test('a planted oversized or non-array req file does not change the decision', () => {
        const ok = runGate('git push origin main');
        for (const planted of ['[' + '0,'.repeat(40000) + '0]', '{"a":1}']) {
            fs.writeFileSync(reqFile, planted);
            const bad = runGate('git push origin main');
            assert.equal(bad.status, ok.status);
            assert.equal(bad.stdout, ok.stdout);
            assert.equal(bad.stderr, ok.stderr);
            if (planted.startsWith('{')) {
                const recs = records();
                assert.ok(Array.isArray(recs) && recs.length === 1);
            }
        }
    });

    test('a session key ending in .req does not overwrite another session state', () => {
        const victim = path.join(gateDir, 'foo.json');
        fs.mkdirSync(gateDir, { recursive: true });
        fs.writeFileSync(victim, '{"keep":true}');
        const r = spawnSync(process.execPath, [GATE], {
            input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push origin main' }, transcript_path: t, session_id: 'foo.req', cwd: work }), env: env(), encoding: 'utf8',
        });
        assert.equal(r.status, 2);
        assert.equal(fs.readFileSync(victim, 'utf8'), '{"keep":true}');
        assert.ok(!fs.existsSync(path.join(gateDir, 'foo.req.json')));
    });

    test('sessionKey remaps .req/.revoke suffixes and trail-credential', () => {
        const out = spawnSync(process.execPath, ['--input-type=module', '-e', `import('${pathToFileURL(GATE).href}').then(m => console.log(JSON.stringify(['foo.req', 'foo.revoke', 'trail-credential', 'foo'].map(m.sessionKey))))`], { env: env(), encoding: 'utf8' });
        const [a, b, c, d] = JSON.parse(out.stdout.trim().split('\n').pop());
        for (const [raw, k] of [['foo.req', a], ['foo.revoke', b], ['trail-credential', c]]) {
            assert.notEqual(k, raw);
            assert.ok(!/\.(req|revoke)$/.test(k), k);
        }
        assert.equal(d, 'foo');
    });

    test('a deny for session foo.req leaves foo records intact and records under its own key', () => {
        fs.mkdirSync(gateDir, { recursive: true });
        const mine = path.join(gateDir, 'foo.req.json');
        fs.writeFileSync(mine, '[{"id":"keep"}]');
        const r = spawnSync(process.execPath, [GATE], {
            input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push origin main' }, transcript_path: t, session_id: 'foo.req', cwd: work }), env: env(), encoding: 'utf8',
        });
        assert.equal(r.status, 2);
        assert.equal(fs.readFileSync(mine, 'utf8'), '[{"id":"keep"}]');
        const other = fs.readdirSync(gateDir).filter((f) => f.endsWith('.req.json') && f !== 'foo.req.json');
        assert.equal(other.length, 1);
        assert.match(other[0], /^foo\.req-[0-9a-f]{12}\.req\.json$/);
        assert.equal(JSON.parse(fs.readFileSync(path.join(gateDir, other[0]), 'utf8')).length, 1);
    });

    test('a FIFO planted as the log file does not hang the hook', (ctx) => {
        fs.mkdirSync(gateDir, { recursive: true });
        try { execFileSync('mkfifo', [path.join(gateDir, 'sess-req.log')]); } catch { return ctx.skip('no mkfifo'); }
        const r = spawnSync(process.execPath, [GATE], {
            input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push origin main' }, transcript_path: t, session_id: 'sess-req', cwd: work }), env: env(), encoding: 'utf8', timeout: 15000,
        });
        assert.equal(r.status, 2);
    });

    test('a FIFO planted as the req file does not hang the hook', (ctx) => {
        fs.mkdirSync(gateDir, { recursive: true });
        try { execFileSync('mkfifo', [reqFile]); } catch { return ctx.skip('no mkfifo'); }
        const r = spawnSync(process.execPath, [GATE], {
            input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push origin main' }, transcript_path: t, session_id: 'sess-req', cwd: work }), env: env(), encoding: 'utf8', timeout: 15000,
        });
        assert.equal(r.status, 2);
        assert.ok(fs.lstatSync(reqFile).isFIFO());
    });
});
