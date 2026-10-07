// go-gate: the `workspace` grant scope (Tim, approved `gogate grant workspace,container-test 8h`).
// Spec: production_artifacts/installer-v5/11_gate-workspace.md
// Fails until the gate change is implemented. Not listed in package.json on purpose.
// Offline: temp HOME, synthetic transcripts. Every command here is only CLASSIFIED
// (commandScopes) or fed to the hook on stdin; nothing in this file executes a command string
// from a shell.
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

let home, work, t, n, ctx, flat;
beforeEach(() => {
    home = fs.mkdtempSync(path.join(BASE, 'aos-gws-'));
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
    // a repo at depth 1 inside home (NOT a workspace boundary)
    flat = path.join(home, 'flat');
    fs.mkdirSync(path.join(flat, '.git'), { recursive: true });
    fs.writeFileSync(path.join(flat, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(path.join(flat, '.git', 'config'), '');
});

// {P} session repo (2 levels inside home), {F} depth-1 repo, {H} home
const fill = (s) => s.split('{P}').join(work).split('{F}').join(flat).split('{H}').join(home);
const env = () => ({ ...process.env, HOME: home, XDG_DATA_HOME: '', AOS_SESSION_NAME: '', AOS_ACP_CLIENT: '', AOS_GATE_PROTECTED_BRANCHES: '' });
const ts = (agoMs = 0) => new Date(Date.now() - agoMs).toISOString();
const add = (e) => fs.appendFileSync(t, JSON.stringify(e) + '\n');
const user = (text, extra = {}) => ({ type: 'user', uuid: `u${++n}`, timestamp: ts(), message: { role: 'user', content: text }, ...extra });
const human = (text, extra = {}) => user(text, { origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human', ...extra });
const wrapper = (name, args) => user(`<command-name>/${name}</command-name>\n<command-message>${name}</command-message>\n<command-args>${args}</command-args>`);
const runGate = (command, cwd = work) => spawnSync(process.execPath, [GATE], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: fill(command) }, transcript_path: t, session_id: 's1', cwd }), env: env(), encoding: 'utf8',
});
const runGrant = (prompt) => spawnSync(process.execPath, [GRANT], { input: JSON.stringify({ prompt, transcript_path: t, session_id: 's1', hook_event_name: 'UserPromptSubmit' }), env: env(), encoding: 'utf8' });
const typed = (prompt) => { const r = runGrant(prompt); add(human(prompt)); return r; };
const ok = (c) => assert.equal(runGate(c).status, 0, `expected allowed: ${fill(c)}`);
const blocked = (c) => assert.equal(runGate(c).status, 2, `expected blocked: ${fill(c)}`);
const statePath = () => path.join(home, '.aos', 'gate', 's1.json');
const sc = (c, c2 = ctx) => { g.setGateContext(c2); return g.commandScopes(fill(c)); };
const scopes = (c, want, c2 = ctx) => {
    const got = sc(c, c2);
    assert.deepEqual(got && [...got].sort(), want && [...want].sort(), fill(c));
};

// put(rel, body) writes a script file; bodies never contain a shell-executed string anyway.
const put = (rel, body, root = work) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); return f; };
// Strings are assembled so no literal destructive/push command appears in the file.
const RMRF = ['r' + 'm', '-r' + 'f', 'build'].join(' ');
const RMSYNC = 'r' + 'm' + 'Sync';
const EVAL = 'ev' + 'al';
const PUSH = ['git', 'push', 'origin', 'feat:feat'].join(' ');
const delBody = (target) => `require('node:fs').${RMSYNC}(${JSON.stringify(target)}, { recursive: true });\n`;
const HARD_BODY = (homePath) => `const os = require('node:os');\nrequire('node:fs').${RMSYNC}(os.homedir() + ${JSON.stringify(homePath)}, { recursive: true });\n`;
const OUT_BODY = delBody('/tmp/aos-ws-target/x');
const EVAL_BODY = `const code = ${JSON.stringify('console.log(1)')};\n${EVAL}(code);\n`;
const CLEAN_BODY = `require('node:fs').${RMSYNC}('build');\nrequire('node:fs').writeFileSync('build/x', 'c');\n`;
// build/manifest script as the real-world motivator
const WS_SCRIPT = 'scripts/build-plugin-manifest.mjs';
const nodeCmd = (rel) => `node ${rel}`;
const WS = ['workspace'];
const hardened = () => {
    put(WS_SCRIPT, delBody('build'));
    return nodeCmd(WS_SCRIPT);
};

// ---------------------------------------------------------------------------
// Scope list and grant parsing.
// ---------------------------------------------------------------------------
describe('scope list and grant parsing', () => {
    test('workspace is a scope; the seven old ones stay', () => {
        for (const s of ['push-feature', 'push-main', 'merge', 'publish', 'destructive', 'github-write', 'container-test', 'workspace']) assert.ok(g.SCOPES.includes(s), s);
    });
    test('gogate grant workspace parses (8h, comma list, session); unknown scopes still fail', () => {
        const p = g.parseGogate('gogate grant workspace,container-test 8h');
        assert.deepEqual(p, { cmd: 'grant', scopes: ['workspace', 'container-test'], ms: 8 * 3600e3, session: false, form: 'plain' });
        assert.equal(g.parseGogate('gogate grant workspace session').session, true);
        assert.match(g.parseGogate('gogate grant workspaces 2h').error, /unknown scope/);
        assert.match(g.parseGogate('gogate grant workspace 25h').error, /24h/);
    });
});

// ---------------------------------------------------------------------------
// Regression: what is ALREADY free before this change (no scope, no GO).
// ---------------------------------------------------------------------------
describe('already free before this change: clone, worktree add, commit, workers, harmless scripts', () => {
    test('scopes [] for clone / worktree add / local add+commit', () => {
        scopes('git clone https://host.invalid/team/one.git wt-clone', []);
        scopes('git worktree add ../wt-work main', []);
        scopes('git add . && git commit -m "feat: x"', []);
    });
    test('scopes [] for aos-acp and opencode workers', () => {
        scopes('aos-acp start', []);
        scopes('opencode run "check the manifest"', []);
    });
    test('scopes [] for npm run and for a node script WITHOUT deletes', () => {
        scopes('npm run build', []);
        scopes('npm test', []);
        put('scripts/copy.mjs', "require('node:fs').copyFileSync('package.json', 'x.json');\n");
        scopes(nodeCmd('scripts/copy.mjs'), []);
    });
    test('hook: all of it passes without GO or grant', () => {
        add(human('clone and work'));
        ok('git clone https://host.invalid/team/one.git wt-clone');
        ok('git add . && git commit -m "feat: x"');
        ok('opencode run "check the manifest"');
    });
});

// ---------------------------------------------------------------------------
// Change 11: scope workspace covers the script analysis of IN-REPO scripts.
// ---------------------------------------------------------------------------
describe('in-repo scripts with deletes are workspace-scoped', () => {
    test('node scripts/build-plugin-manifest.mjs (rmSync build recursive) = [workspace]', () => {
        put(WS_SCRIPT, delBody('build'));
        scopes(nodeCmd(WS_SCRIPT), WS); // the real pain point: [destructive] or null before
    });
    test('relative script path resolves against the session cwd', () => {
        put(WS_SCRIPT, delBody('build'));
        scopes('node scripts/build-plugin-manifest.mjs', WS);
    });
    test('non-recursive delete inside the repo was never guarded (no change)', () => {
        put('scripts/clean.js', CLEAN_BODY);
        scopes(nodeCmd('scripts/clean.js'), []);
    });
    test('npm run stays unguarded (its body is still not read: pre-existing hole)', () => {
        put('package.json', JSON.stringify({ scripts: { 'build:manifest': `node ${WS_SCRIPT}` } }));
        put(WS_SCRIPT, delBody('build'));
        scopes('npm run build:manifest', []);
    });
    test('combined with free parts still only workspace', () => {
        put(WS_SCRIPT, delBody('build'));
        scopes(`${nodeCmd(WS_SCRIPT)} && git add . && git commit -m "feat: x"`, WS);
    });
    test('a push after the script keeps push-feature, a host rm -rf stays destructive', () => {
        put(WS_SCRIPT, delBody('build'));
        scopes(`${nodeCmd(WS_SCRIPT)} && ${PUSH}`, [...WS, 'push-feature']);
        scopes(`${nodeCmd(WS_SCRIPT)}; ${RMRF}`, [...WS, 'destructive']);
    });
});

// ---------------------------------------------------------------------------
// The boundary: what must NOT be covered, before and after the change.
// ---------------------------------------------------------------------------
describe('workspace boundary: not covered by workspace (unchanged: destructive scope or plain GO)', () => {
    // These keep exactly the behaviour they had before the scope existed: a recursive delete in a script is `destructive`
    // (a destructive grant or a GO covers it); `workspace` never claims a target outside the repo or a repo outside the rules.
    test('delete target outside the repo (absolute path)', () => {
        put(WS_SCRIPT, OUT_BODY);
        scopes(nodeCmd(WS_SCRIPT), ['destructive']);
    });
    test('deleting the repo root itself or its .git is not workspace', () => {
        put(WS_SCRIPT, delBody('.'));
        scopes(nodeCmd(WS_SCRIPT), ['destructive']);
        put(WS_SCRIPT, delBody('.git'));
        scopes(nodeCmd(WS_SCRIPT), ['destructive']);
        put(WS_SCRIPT, delBody('../other'));
        scopes(nodeCmd(WS_SCRIPT), ['destructive']);
    });
    test('script reached through a symlink that leaves the repo', () => {
        fs.symlinkSync(path.join(home, '.claude'), path.join(work, 'out-link'));
        put(path.join('.claude', 'hiddenq.mjs'), delBody('build'), home);
        scopes(nodeCmd('{P}/out-link/hiddenq.mjs'), ['destructive']);
    });
    test('repo at depth 1 inside home is not a workspace', () => {
        put('scripts/build-plugin-manifest.mjs', delBody('build'), flat);
        scopes(nodeCmd('scripts/build-plugin-manifest.mjs'), ['destructive'], { ...ctx, cwd: flat });
    });
    test('missing script file stays null (fail closed)', () => scopes(nodeCmd('scripts/missing.mjs'), null));
    test('eval/exec markers in a script stay null (code that hides what it runs)', () => {
        put(WS_SCRIPT, EVAL_BODY);
        scopes(nodeCmd(WS_SCRIPT), null);
    });
    test('hard delete in a script stays unconditional (never grantable)', () => {
        put(WS_SCRIPT, HARD_BODY('/.config/dir-wipe'));
        typed('gogate grant workspace 8h');
        add(human('go on'));
        blocked(nodeCmd(WS_SCRIPT));
    });
});

// ---------------------------------------------------------------------------
// Grant semantics at the hook.
// ---------------------------------------------------------------------------
// Hardening from the defensive review: a script only gets `workspace` when every target is literal, strictly inside the repo
// and the repo is the session's own.
describe('workspace hardening', () => {
    const DS = ['require', "('node:fs')"].join('');
    const body = (target) => `${DS}.${['r', 'mSync'].join('')}(${target}, { recursive: true });\n`;
    test('a dynamic suffix, a glob or a trailing slash is not workspace', () => {
        for (const t of ['"build" + process.argv[2]', '"build/*"', '"build/"']) {
            put(WS_SCRIPT, body(t));
            scopes(nodeCmd(WS_SCRIPT), ['destructive']);
        }
    });
    test('.git in any segment or case is not workspace', () => {
        for (const t of ['"sub/.git"', '".GIT"', '"build/.git/hooks"']) {
            put(WS_SCRIPT, body(t));
            scopes(nodeCmd(WS_SCRIPT), ['destructive']);
        }
    });
    test('a script that changes its working directory is not workspace', () => {
        put(WS_SCRIPT, `process.chdir('/');\n${body('"build"')}`);
        scopes(nodeCmd(WS_SCRIPT), ['destructive']);
    });
    test('a repo that is not the session repo (cwd outside it) is not workspace', () => {
        put(WS_SCRIPT, body('"build"'));
        scopes(`node {P}/${WS_SCRIPT}`, ['destructive'], { ...ctx, cwd: home });
        scopes(nodeCmd(WS_SCRIPT), WS);
    });
});

describe('workspace grant semantics', () => {
    const COVERED = [
        ['the pain point', () => nodeCmd(WS_SCRIPT)],
        ['relative spelling', 'node scripts/build-plugin-manifest.mjs'],
        ['with local add+commit', `${nodeCmd(WS_SCRIPT)} && git add . && git commit -m "feat: x"`],
        ['clone and worktree add', 'git clone https://host.invalid/team/one.git wt-clone && cd wt-clone && git worktree add wt2 main'],
        ['worker launch', 'opencode run "check the manifest"'],
    ];
    test('no grant: the covered run needs a GO', () => {
        put(WS_SCRIPT, delBody('build'));
        add(human('build the manifest'));
        blocked(nodeCmd(WS_SCRIPT));
    });
    test('active workspace grant (8h): every covered shape is allowed', () => {
        put(WS_SCRIPT, delBody('build'));
        typed('gogate grant workspace,container-test 8h');
        add(human('go on'));
        for (const [, c] of COVERED) ok(typeof c === 'function' ? c() : c);
    });
    test('not covered with workspace only: push, publish, merge, host rm -rf', () => {
        put(WS_SCRIPT, delBody('build'));
        typed('gogate grant workspace 8h');
        add(human('go on'));
        blocked(`${nodeCmd(WS_SCRIPT)} && ${PUSH}`);
        blocked(`${nodeCmd(WS_SCRIPT)}; ${RMRF}`);
        blocked(['npm', 'publish'].join(' '));
        blocked('gh pr merge 5');
        blocked('git reset --hard HEAD~1');
        blocked('git worktree remove ../wt');
    });
    test('a grant of another scope does not cover the workspace script', () => {
        put(WS_SCRIPT, delBody('build'));
        for (const s of ['push-feature', 'push-main', 'merge', 'publish', 'github-write', 'container-test']) {
            typed(`gogate grant ${s} 2h`);
            add(human('go on'));
            blocked(nodeCmd(WS_SCRIPT));
        }
    });
    test('a destructive grant keeps covering a repo script that deletes (compatibility)', () => {
        put(WS_SCRIPT, delBody('build'));
        typed('gogate grant destructive 2h');
        add(human('go on'));
        ok(nodeCmd(WS_SCRIPT));
    });
    test('hard revokes; soft does not bring it back; a new grant works', () => {
        put(WS_SCRIPT, delBody('build'));
        typed('gogate grant workspace 2h');
        add(human('go on'));
        ok(nodeCmd(WS_SCRIPT));
        typed('gogate hard');
        blocked(nodeCmd(WS_SCRIPT));
        typed('gogate soft');
        blocked(nodeCmd(WS_SCRIPT));
        typed('gogate grant workspace 2h');
        add(human('go on'));
        ok(nodeCmd(WS_SCRIPT));
    });
    test('an expired workspace grant covers nothing', () => {
        put(WS_SCRIPT, delBody('build'));
        const prompt = 'gogate grant workspace 15m';
        runGrant(prompt);
        const st = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
        st.grants[0].source.issued_at = ts(3600e3);
        fs.writeFileSync(statePath(), JSON.stringify(st));
        add(human(prompt, { timestamp: ts(3600e3) }));
        add(human('go on'));
        blocked(nodeCmd(WS_SCRIPT));
    });
    test('the slash form is ignored; a loop-typed grant is ignored', () => {
        put(WS_SCRIPT, delBody('build'));
        runGrant('/bdb-aos:gogate grant workspace 2h');
        add(wrapper('bdb-aos:gogate', 'grant workspace 2h'));
        add(human('go on'));
        blocked(nodeCmd(WS_SCRIPT));
        runGrant('gogate grant workspace 2h');
        add(user('gogate grant workspace 2h', { promptSource: 'system', isMeta: true, turnOrigin: 'system' }));
        add(human('go on'));
        blocked(nodeCmd(WS_SCRIPT));
    });
    test('cooldown: a script written after a block still needs a GO (fresh-script rule)', () => {
        put(WS_SCRIPT, delBody('build'));
        typed('gogate grant workspace 2h');
        add(human('go on'));
        blocked(PUSH); // first block writes the cooldown marker
        put('scripts/fresh.mjs', CLEAN_BODY); // written after the block
        blocked(nodeCmd('scripts/fresh.mjs'));
    });
    test('a plain GO still lifts an outside-target script (hard does not apply)', () => {
        put(WS_SCRIPT, OUT_BODY);
        add(human('run it'));
        blocked(nodeCmd(WS_SCRIPT));
        add(human('GO'));
        ok(nodeCmd(WS_SCRIPT));
    });
});
