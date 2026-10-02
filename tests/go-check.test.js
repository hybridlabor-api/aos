const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const CHECK = path.join(REPO, 'bin', 'go-check.mjs');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gocheck-'));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
test.after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));
const installer = require('../installer.js');

const jsonl = (...e) => e.map((x) => JSON.stringify(x)).join('\n') + '\n';
const goDir = path.join(tmpHome, '.aos', 'go');
const tokenPath = (n) => path.join(goDir, `${n}.token`);
function writeToken(name, over = {}) {
    const master = path.join(tmpHome, `master-${name}.jsonl`);
    fs.writeFileSync(master, jsonl({ type: 'user', uuid: `u-${name}-${Math.random()}`, message: { role: 'user', content: `GO ${name}` } }));
    fs.mkdirSync(goDir, { recursive: true });
    fs.writeFileSync(tokenPath(name), JSON.stringify({ target: name, issued_at: new Date().toISOString(), master_transcript: master, ...over }));
}
const clean = () => { fs.rmSync(goDir, { recursive: true, force: true }); fs.rmSync(path.join(tmpHome, '.aos', 'gate'), { recursive: true, force: true }); };

function check(args, env = {}, bin = CHECK) {
    const r = spawnSync(process.execPath, [bin, ...args], { env: { PATH: process.env.PATH, HOME: tmpHome, ...env }, encoding: 'utf8', timeout: 10000 });
    let out = null;
    try { out = JSON.parse(r.stdout); } catch { /* asserted by callers */ }
    return { code: r.status, out, stderr: r.stderr };
}
const ask = (session, command, extra = [], env) => check(['--session', session, '--command', command, ...extra], env);

test('unguarded command is allowed without a token', () => {
    clean();
    const r = ask('w1', 'ls -la && git status');
    assert.equal(r.code, 0);
    assert.deepEqual(r.out, { guarded: false, ok: true, scope: [], reason: '' });
});

test('guarded command without a token exits 1 with its scope', () => {
    clean();
    const r = ask('w1', 'git push origin main');
    assert.equal(r.code, 1);
    assert.equal(r.out.guarded, true);
    assert.equal(r.out.ok, false);
    assert.deepEqual(r.out.scope, ['push-main']);
    assert.match(r.out.reason, /no GO token/);
});

test('a valid token allows; --consume uses it exactly once', () => {
    clean();
    writeToken('w1');
    const peek = ask('w1', 'gh pr merge 117 --squash');
    assert.equal(peek.code, 0);
    assert.equal(peek.out.ok, true);
    assert.ok(fs.existsSync(tokenPath('w1')), 'verify without --consume keeps the token');
    const saved = fs.readFileSync(tokenPath('w1'), 'utf8');
    const use = ask('w1', 'git push origin feat/x', ['--consume']);
    assert.equal(use.code, 0);
    assert.match(use.out.reason, /consumed/);
    assert.equal(fs.existsSync(tokenPath('w1')), false);
    assert.equal(ask('w1', 'git push origin feat/x', ['--consume']).code, 1);
    fs.writeFileSync(tokenPath('w1'), saved);
    const replay = ask('w1', 'git push', ['--consume']);
    assert.equal(replay.code, 1);
    assert.match(replay.out.reason, /already used/);
});

test('token for another session, expired token, stale master: exit 1', () => {
    clean();
    writeToken('w2');
    assert.equal(ask('w1', 'npm publish').code, 1);
    writeToken('w1', { issued_at: new Date(Date.now() - 11 * 60000).toISOString() });
    assert.match(ask('w1', 'npm publish').out.reason, /expired/);
    writeToken('w1');
    fs.appendFileSync(path.join(tmpHome, 'master-w1.jsonl'), jsonl({ type: 'user', message: { role: 'user', content: 'wait' } }));
    assert.equal(ask('w1', 'npm publish').code, 1);
});

test('errors exit 2: no command, no session on a guarded command, unknown flag', () => {
    clean();
    assert.equal(check(['--session', 'w1']).code, 2);
    assert.equal(check(['--session', 'w1', '--command', '  ']).code, 2);
    assert.equal(check(['--command', 'git push']).code, 2);
    assert.equal(check(['--session', '///', '--command', 'git push']).code, 2);
    const bad = check(['--nope']);
    assert.equal(bad.code, 2);
    assert.equal(bad.out.ok, false);
    assert.equal(check(['--session', 'w1', '--command']).code, 2);
});

test('mode soft grants and mode off in the gate store are never read', () => {
    clean();
    fs.mkdirSync(path.join(tmpHome, '.aos', 'gate'), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, '.aos', 'gate', 'w1.json'), JSON.stringify({ mode: 'off', modes: [{ mode: 'off' }], grants: [{ scope: 'push-main', until: new Date(Date.now() + 3600e3).toISOString(), session_key: 'w1' }] }));
    const r = ask('w1', 'git push origin main', [], { AOS_SESSION_NAME: 'w1' });
    assert.equal(r.code, 1);
    assert.equal(ask('w1', 'rm -rf build').code, 1);
});

test('AOS_ACP_CLIENT=1 never mints a token, even with a GO in a transcript', () => {
    clean();
    fs.writeFileSync(path.join(tmpHome, 'm.jsonl'), jsonl({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'GO w1' } }));
    const r = ask('w1', 'git push origin main', ['--consume'], { AOS_ACP_CLIENT: '1', AOS_SESSION_NAME: 'w1' });
    assert.equal(r.code, 1);
    assert.equal(fs.existsSync(tokenPath('w1')), false);
    assert.deepEqual(fs.existsSync(goDir) ? fs.readdirSync(goDir) : [], []);
});

test('a command that touches the GO store is refused, never consumed', () => {
    clean();
    writeToken('w1');
    const r = ask('w1', 'echo x > ~/.aos/go/w1.token', ['--consume']);
    assert.equal(r.code, 1);
    assert.ok(fs.existsSync(tokenPath('w1')));
});

test('the command is a shell string: wrappers and compounds are classified', () => {
    clean();
    assert.equal(ask('w1', 'cd repo && bash -c "git push origin main"').code, 1);
    assert.equal(ask('w1', 'sudo -u x npm publish').code, 1);
    assert.equal(ask('w1', 'echo hi | tee out.txt').code, 0);
});

test('answers fast (well under 1s)', () => {
    clean();
    ask('w1', 'ls');
    const t = process.hrtime.bigint();
    ask('w1', 'git push origin main');
    assert.ok(Number(process.hrtime.bigint() - t) / 1e6 < 1000);
});

test('guarded-patterns.json matches GUARDED_PATTERNS in go-gate.mjs', async () => {
    const { pathToFileURL } = require('url');
    const gate = await import(pathToFileURL(path.join(REPO, '.claude', 'hooks', 'go-gate.mjs')).href);
    const { patternsJson } = await import(pathToFileURL(CHECK).href);
    const onDisk = JSON.parse(fs.readFileSync(path.join(REPO, 'bin', 'guarded-patterns.json'), 'utf8'));
    assert.deepEqual(onDisk, patternsJson(gate), 'regenerate: node bin/go-check.mjs --write-patterns bin/guarded-patterns.json');
    for (const p of onDisk.patterns) new RegExp(p.source, p.flags);
});

test('installGoCheck places go-check, go-gate and the patterns, idempotently, and the copy works', () => {
    const home = fs.mkdtempSync(path.join(tmpHome, 'inst-'));
    assert.equal(installer.installGoCheck({ targetHome: home }), true);
    const bin = path.join(home, '.aos', 'bin');
    assert.deepEqual(fs.readdirSync(bin).sort(), ['go-check.mjs', 'go-gate.mjs', 'guarded-patterns.json']);
    const before = fs.readdirSync(bin).map((f) => fs.readFileSync(path.join(bin, f), 'utf8'));
    assert.equal(installer.installGoCheck({ targetHome: home }), true);
    assert.deepEqual(fs.readdirSync(bin).map((f) => fs.readFileSync(path.join(bin, f), 'utf8')), before);
    assert.equal(fs.readdirSync(bin).length, 3, 'no backup files on an unchanged re-run');
    assert.equal(fs.readFileSync(path.join(bin, 'guarded-patterns.json'), 'utf8'), fs.readFileSync(path.join(REPO, 'bin', 'guarded-patterns.json'), 'utf8'));
    const r = check(['--session', 'w1', '--command', 'git push'], { HOME: home }, path.join(bin, 'go-check.mjs'));
    assert.equal(r.code, 1);
    assert.equal(r.out.guarded, true);
    assert.equal(check(['--session', 'w1', '--command', 'ls'], { HOME: home }, path.join(bin, 'go-check.mjs')).code, 0);
});

test('codexGateSnippet is the go-gate PreToolUse stanza and the notice mentions trust and UNVERIFIED', () => {
    const s = installer.codexGateSnippet('/h/hooks');
    assert.match(s, /^\[\[hooks\.PreToolUse\]\]\nmatcher = /);
    assert.match(s, /command = "node \\"\/h\/hooks\/go-gate\.mjs\\""/);
    assert.match(installer.CODEX_GATE_NOTICE, /trust/);
    assert.match(installer.CODEX_GATE_NOTICE, /UNVERIFIED/);
});
