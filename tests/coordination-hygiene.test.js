const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HOOKS = path.join(ROOT, '.claude', 'hooks');
const TOKEN = path.join(HOOKS, 'go-token.mjs');
const BUS = path.join(HOOKS, 'aos-bus.mjs');

let home;
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-hyg-')); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const goDir = () => path.join(home, '.aos', 'go');
const putToken = (name, issued) => {
    fs.mkdirSync(goDir(), { recursive: true });
    fs.writeFileSync(path.join(goDir(), `${name}.token`), typeof issued === 'string' && issued.startsWith('{') ? issued : JSON.stringify({ target: name, issued_at: issued }));
};
const run = (file, args, input, env = {}) => spawnSync(process.execPath, [file, ...args], {
    input, env: { ...process.env, HOME: home, XDG_DATA_HOME: '', ...env }, encoding: 'utf8',
});

test('go-token deletes expired and unreadable tokens when it writes a new one, keeps fresh ones', () => {
    putToken('old', new Date(Date.now() - 11 * 60000).toISOString());
    putToken('fresh', new Date(Date.now() - 60000).toISOString());
    putToken('junk', '{not json');
    putToken('nodate', '{"target":"x"}');
    fs.writeFileSync(path.join(goDir(), '.consumed'), 'k1\n');
    const transcript = path.join(home, 'm.jsonl');
    fs.writeFileSync(transcript, JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'GO worker-1' } }) + '\n');
    const r = run(TOKEN, [], JSON.stringify({ prompt: 'GO worker-1', transcript_path: transcript }));
    assert.equal(r.status, 0);
    assert.deepEqual(fs.readdirSync(goDir()).sort(), ['.consumed', 'fresh.token', 'worker-1.token']);
});

test('go-token deletes nothing when it writes no token', () => {
    putToken('old', new Date(Date.now() - 11 * 60000).toISOString());
    run(TOKEN, [], JSON.stringify({ prompt: 'hello', transcript_path: path.join(home, 'x') }));
    assert.deepEqual(fs.readdirSync(goDir()), ['old.token']);
});

test('aos-bus list prunes dead, stale and corrupt registrations and keeps live ones', () => {
    const sessions = path.join(home, '.aos', 'bus', 'sessions');
    fs.mkdirSync(sessions, { recursive: true, mode: 0o700 });
    const reg = (n, o) => fs.writeFileSync(path.join(sessions, `${n}.json`), typeof o === 'string' ? o : JSON.stringify({ name: n, pid: process.pid, cwd: home, ...o }));
    reg('live', {});
    reg('dead', { pid: 2 ** 22 + 12345 });
    reg('stale', {});
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(path.join(sessions, 'stale.json'), old, old);
    reg('corrupt', '{nope');
    const inbox = path.join(home, '.aos', 'bus', 'inbox', 'dead');
    fs.mkdirSync(inbox, { recursive: true });

    const r = run(BUS, ['list']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^live\t/);
    assert.equal(r.stdout.trim().split('\n').length, 1);
    assert.deepEqual(fs.readdirSync(sessions), ['live.json']);
    assert.ok(fs.existsSync(inbox), 'inboxes are never pruned');
});
