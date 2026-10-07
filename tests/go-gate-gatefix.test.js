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
// (b) `docker -e` / `--env` only as KEY=literal.
// ---------------------------------------------------------------------------
describe('(b) docker -e only as KEY=literal', () => {
    const run = (envFlag) => `docker run --rm -v {P}:/src ${envFlag} node:24 npm test`;
    test('null: a bare NAME forwards the HOST variable into the container', () => {
        scopes(run('-e GH_TOKEN'), null);
        scopes(run('--env NPM_TOKEN'), null);
        scopes(run('-e'), null); // dangling
        scopes(run('--env-file .env'), null);
        scopes(run('-e GH_TOKEN -e AOS_TEST_SANDBOX=container'), null);
    });
    test('null: anything but a plain KEY=literal value', () => {
        scopes(run('-e KEY=~home'), null);
        scopes(run('-e KEY=$X'), null); // expansion before the image (pre-existing)
        scopes(run('-e "X=$(id)"'), null); // pre-existing
    });
    test('container-test: the official test template keeps working', () => {
        scopes(run('-e AOS_TEST_SANDBOX=container'), CT);
        scopes(run('-e CI=1'), CT);
        scopes(run('-e FOO=bar=baz'), CT); // only the first = separates KEY from value
        scopes(run('--env=CI=1'), CT);
        scopes(run("--env 'CI=1'"), CT);
    });
    test('hook: benign literal envs are covered by a grant, bare names are not', () => {
        typed('gogate grant container-test 2h');
        add(human('go on'));
        ok(run('-e AOS_TEST_SANDBOX=container'));
        blocked(run('-e NPM_TOKEN'));
    });
});

// ---------------------------------------------------------------------------
// (c) `$`-assembled verbs in opaque text fail closed.
// ---------------------------------------------------------------------------
describe('(c) computed verbs in opaque text fail closed', () => {
    test('null (plain GO) for computed command names in sh -c / eval', () => {
        scopes("sh -c '$x push'", null);
        scopes('sh -c "g=git; $g push origin main"', null);
        scopes('eval "$(echo git) push"', null);
        scopes("bash -c '${F} push'", null);
        scopes("bash -c 'x; $y push'", null);
        scopes("sh -c 'sudo $x push'", null);
        scopes(`bash -c '$D ${RMRF}'`, null);
        scopes("bash -c '`echo -n git` push origin main'", null);
    });
    test("today's decision for args of a computed head: sh -c 'echo $HOME' stays []", () => {
        scopes("sh -c 'echo $HOME'", []);
        scopes("bash -c 'VAR=x echo hi'", []);
        scopes("sh -c 'echo $x; echo oops'", []);
        scopes("bash -c 'npm test'", []);
        scopes("sh -c 'echo hi'", []);
    });
    test('hook: computed verbs are blocked without GO and allowed after GO', () => {
        add(human('go on'));
        blocked("sh -c '$x push'");
        blocked('sh -c "g=git; $g push origin main"');
        add(human('GO'));
        ok("sh -c '$x push'");
    });
});

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

// ---------------------------------------------------------------------------
// (c2) whole quoted bodies: `;` inside sh -c '...' must not split the $-head rule away.
// ---------------------------------------------------------------------------
describe('(c2) opaque bodies are judged whole, not by the fragments the split leaves', () => {
    test('null: $-head rule sees the whole sh -c / eval body', () => {
        scopes("sh -c 'g=git; p=push; $g $p origin HEAD:main'", null);
        scopes(`docker run --rm -v {P}:/src node:24 sh -c 'g=git; p=push; $g $p origin main'`, null);
        scopes(`docker run --rm -v {P}:/src:ro node:24 sh -c 'g=git; p=push; $g $p origin main'`, null);
        scopes("eval 'g=git; $g push origin main'", null);
    });
    test('[] unchanged: bodies without a $-word in command position stay free', () => {
        scopes(`docker run --rm -v {P}:/src:ro node:24 sh -c 'echo ok'`, []);
        scopes(`docker run --rm -v {P}:/src:ro node:24 sh -c 'cd /src && node --test'`, []);
        scopes("sh -c 'g=git; p=push; echo skipped'", []);
    });
    test('hook: the assembled push needs a plain GO', () => {
        typed('gogate grant container-test 2h');
        add(human('go on'));
        blocked(`docker run --rm -v {P}:/src node:24 sh -c 'g=git; p=push; $g $p origin main'`);
        add(human('GO'));
        ok(`docker run --rm -v {P}:/src node:24 sh -c 'g=git; p=push; $g $p origin main'`);
    });
});

// ---------------------------------------------------------------------------
// (d) command-position joiners cover every wrapper: `g=git p=push sh -c 'time $g ...'`.
// ---------------------------------------------------------------------------
describe('(d) every wrapper starts a command position for the $-head rule', () => {
    test('null: a $-head after a wrapper inside opaque text fails closed', () => {
        scopes(`g=git p=push sh -c 'time $g $p origin main'`, null);
        scopes(`g=git sh -c 'nohup $g push origin main'`, null);
        scopes(`g=git sh -c 'nice $g push origin main'`, null);
        scopes(`g=git bash -c 'timeout 5 $g push origin main'`, null);
        scopes(`g=git sh -c 'builtin $g push origin main'`, null);
        scopes(`g=git sh -c 'stdbuf -o0 $g push origin main'`, null);
        scopes(`g=git sh -c 'caffeinate $g push origin main'`, null);
        scopes(`g=git sh -c 'doas $g push origin main'`, null);
        scopes(`g=git sh -c 'script -q /dev/null $g push'`, null);
        scopes(`sh -c '! $g push origin main'`, null);
        scopes(`sh -c '{ $g push origin main; }'`, null);
    });
    test('[] unchanged: same words as arguments keep today\'s decision', () => {
        scopes(`sh -c 'echo time nice builtin'`, []);
        scopes(`sh -c 'time echo hi'`, []);
    });
});

module.exports = {};
