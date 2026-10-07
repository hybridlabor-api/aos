// Gate fixes (Tim approved, 2026-10-07): (a) read-only docker mounts must not skip the
// in-container catchAll read, (b) `docker -e` only as KEY=literal, (c) `$`-assembled verbs
// in opaque text fail closed.
// Offline: temp HOME, synthetic transcripts. The gate only CLASSIFIES the strings below
// (commandScopes) or reads them from hook stdin; nothing here executes a command string.
const { test, describe, beforeEach, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const REPO = path.resolve(__dirname, '..');
const HOOKS = path.join(REPO, '.claude', 'hooks');
const GATE = path.join(HOOKS, 'go-gate.mjs');
const GRANT = path.join(HOOKS, 'go-grant.mjs');
const BASE = String(process.env.HOME || '').startsWith('/private/tmp/') ? process.env.HOME : os.tmpdir();

let g;
before(async () => { g = await import(pathToFileURL(GATE).href); });

process.env.AOS_TEST_SANDBOX = '1';
process.env.GIT_CONFIG_NOSYSTEM = '1';
for (const k of Object.keys(process.env)) if (/^GIT_/.test(k) && k !== 'GIT_CONFIG_NOSYSTEM') delete process.env[k];

let home, work, t, n, ctx;
beforeEach(() => {
    home = fs.mkdtempSync(path.join(BASE, 'aos-gfx-'));
    work = path.join(home, 'projects', 'work');
    fs.mkdirSync(path.join(work, '.git'), { recursive: true });
    fs.writeFileSync(path.join(work, '.git', 'HEAD'), 'ref: refs/heads/feat/work\n');
    fs.writeFileSync(path.join(work, '.git', 'config'), '');
    for (const d of ['.claude', '.gemini', '.codex', '.aos']) fs.mkdirSync(path.join(home, d), { recursive: true });
    t = path.join(home, 'session.jsonl');
    fs.writeFileSync(t, '');
    n = 0;
    process.env.AOS_GATE_TEST_REALHOME = home;
    process.env.XDG_CONFIG_HOME = path.join(home, '.config');
    ctx = { cwd: work, blockTs: 0, home, realHome: home, claudeDir: path.join(home, '.claude') };
    g.setGateContext(ctx);
});

const fill = (s) => s.split('{P}').join(work).split('{H}').join(home);
const env = () => ({ ...process.env, HOME: home, XDG_DATA_HOME: '', AOS_SESSION_NAME: '', AOS_ACP_CLIENT: '', AOS_GATE_PROTECTED_BRANCHES: '' });
const ts = (agoMs = 0) => new Date(Date.now() - agoMs).toISOString();
const add = (e) => fs.appendFileSync(t, JSON.stringify(e) + '\n');
const human = (text, extra = {}) => ({ type: 'user', uuid: `u${++n}`, timestamp: ts(), message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human', ...extra });
const runGate = (command) => spawnSync(process.execPath, [GATE], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: fill(command) }, transcript_path: t, session_id: 's1', cwd: work }), env: env(), encoding: 'utf8',
});
const runGrant = (prompt) => spawnSync(process.execPath, [GRANT], { input: JSON.stringify({ prompt, transcript_path: t, session_id: 's1', hook_event_name: 'UserPromptSubmit' }), env: env(), encoding: 'utf8' });
const typed = (prompt) => { const r = runGrant(prompt); add(human(prompt)); return r; };
const ok = (c) => assert.equal(runGate(c).status, 0, `expected allowed: ${fill(c)}`);
const blocked = (c) => assert.equal(runGate(c).status, 2, `expected blocked: ${fill(c)}`);
const sc = (c) => { g.setGateContext(ctx); return g.commandScopes(fill(c)); };
const scopes = (c, want) => {
    const got = sc(c);
    assert.deepEqual(got && [...got].sort(), want && [...want].sort(), fill(c));
};

const SAFE = "docker run --rm -v {P}:/src node:24 bash -c 'npm test'";
const RMRF = ['r' + 'm', '-r' + 'f', 'build'].join(' '); // assembled: no literal destructive command in the file
const CT = ['container-test'];

// ---------------------------------------------------------------------------
// (a) Read-only docker mounts must not skip the in-container check.
// ---------------------------------------------------------------------------
describe('(a) ro mounts: the text after the image is still read for guarded words', () => {
    const ro = (body) => `docker run --rm -v {P}:/src:ro node:24 ${body}`;
    test('null (plain GO): a guarded command inside a read-only container', () => {
        scopes(ro('npm publish'), null);
        scopes(ro("bash -c 'git push origin main'"), null);
        scopes(ro("sh -c 'gh pr merge 5'"), null);
        scopes(ro(`bash -c '${RMRF}'`), null);
        scopes(ro('npm version patch'), null);
    });
    test('[] (rule 16 keeps its freedom): benign read-only runs stay free', () => {
        scopes('docker run --rm -v {P}:/src:ro node:24 npm test', []);
        scopes(`docker run --rm -v {P}:/src:ro -e AOS_TEST_SANDBOX=container node:24-bookworm bash -c 'cd /src && node --test'`, []);
        scopes(ro("sh -c 'echo ok'"), []);
        scopes('docker run --rm -v {P}:/src:ro node:24 node --test tests/x.test.js', []);
    });
    test('other rule 16 shards unchanged: writable mounts are container-test as before', () => {
        scopes(SAFE, CT);
    });
    test('hook: an active container-test grant never covers a guarded in-container word', () => {
        typed('gogate grant container-test 2h');
        add(human('go on'));
        ok('docker run --rm -v {P}:/src:ro node:24 npm test');
        blocked(ro('npm publish'));
        blocked(`docker run --rm -v {P}:/src:ro node:24 bash -c 'git push origin main'`);
    });
});

module.exports = {};
