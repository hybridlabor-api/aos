// Gate fixes, third review round (Tim approved, 2026-10-07): statement-glued opaque bodies,
// shell option scans, escaped bodies, wrapper argument command positions, computed heads and
// verbs outside opaque text, xargs stdin commands, docker subcommands, wrapper additions and
// catchAll linearity. Offline: temp HOME, synthetic transcripts. The gate only CLASSIFIES the
// strings below (commandScopes) or runs the hooks as child processes; nothing here executes a
// command string.
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
    home = fs.mkdtempSync(path.join(BASE, 'aos-gfx2-'));
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

// ---------------------------------------------------------------------------
// (1) `;`-glued and ${IFS}-glued statements inside an opaque body.
// ---------------------------------------------------------------------------
describe('(1) opaque bodies are split statement-wise, not by whitespace only', () => {
    test('null: a $ head in command position of a later statement fails closed', () => {
        scopes("sh -c 'true;g=git;p=push;$g $p origin HEAD:main'", null);
        scopes("sh -c 'g=git;p=push;$g${IFS}$p${IFS}origin${IFS}HEAD:main'", null);
        scopes(`docker run --rm -v {P}:/src node:24 sh -c 'true;g=git;p=push;$g $p origin main'`, null);
    });
    test('[] unchanged: statements without a command-position $ stay free', () => {
        scopes("sh -c 'true;g=git;p=push;echo skipped'", []);
        scopes("sh -c 'g=git;p=push;echo $HOME'", []);
        scopes(`docker run --rm -v {P}:/src:ro node:24 sh -c 'cd /src && node --test'`, []);
    });
    test('hook: the glued body needs a plain GO', () => {
        typed('gogate grant container-test 2h');
        add(human('go on'));
        blocked("sh -c 'true;g=git;p=push;$g $p origin HEAD:main'");
        add(human('GO'));
        ok("sh -c 'true;g=git;p=push;$g $p origin HEAD:main'");
    });
});

// ---------------------------------------------------------------------------
// (2) the option scan reaches -c past earlier options and their values.
// ---------------------------------------------------------------------------
describe('(2) shell options are scanned until -c', () => {
    test('null: -c after -o/--rcfile and their values is found', () => {
        scopes("bash -o pipefail -c 'g=git; p=push; $g $p origin HEAD:main'", null);
        scopes("bash --rcfile /x/r -c 'g=git; p=push; $g $p origin HEAD:main'", null);
        scopes("sh -O globstar -c 'g=git; p=push; $g $p origin HEAD:main'", null);
    });
    test('[] unchanged: bodies behind such options stay free without a $ head', () => {
        scopes("bash -o pipefail -c 'echo hi'", []);
        scopes("bash --rcfile /x/r -c 'echo hi'", []);
    });
    test('hook: the option-hidden body needs a plain GO', () => {
        typed('gogate grant container-test 2h');
        add(human('go on'));
        blocked("bash -o pipefail -c 'g=git; p=push; $g $p origin HEAD:main'");
        add(human('GO'));
        ok("bash -o pipefail -c 'g=git; p=push; $g $p origin HEAD:main'");
    });
});

module.exports = {};
