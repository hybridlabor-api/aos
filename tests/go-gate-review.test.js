// Regression tests for the C1 security review (scope escape, fail-closed main, scheduled
// origins, OpenCode session driving, store guard forms, wrapper/prefix coverage, log cap).
// Offline: temp HOME, synthetic transcripts, the real hooks run as child processes.
const { test, describe, beforeEach, afterEach, before } = require('node:test');
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
const ENVP = path.join(HOOKS, 'env-file-protection.mjs');

let g, envp;
before(async () => {
    g = await import(pathToFileURL(GATE).href);
    envp = await import(pathToFileURL(ENVP).href);
});

let home, t, n;
beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gogate-rv-'));
    t = path.join(home, 'session.jsonl');
    fs.writeFileSync(t, '');
    n = 0;
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const env = (extra = {}) => ({ ...process.env, HOME: home, XDG_DATA_HOME: '', AOS_SESSION_NAME: '', AOS_ACP_CLIENT: '', ...extra });
const add = (e, file = t) => fs.appendFileSync(file, JSON.stringify(e) + '\n');
const user = (text, extra = {}) => ({ type: 'user', uuid: `u${++n}`, timestamp: new Date().toISOString(), message: { role: 'user', content: text }, ...extra });
const human = (text, extra = {}) => user(text, { origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human', ...extra });
const gateRaw = (input) => spawnSync(process.execPath, [GATE], { input: typeof input === 'string' ? input : JSON.stringify(input), env: env(), encoding: 'utf8' });
const runGate = (command, { session = 's1', transcript = t } = {}) => gateRaw({ tool_name: 'Bash', tool_input: { command }, transcript_path: transcript, session_id: session });
const runGrant = (prompt, extra = {}) => spawnSync(process.execPath, [GRANT], { input: JSON.stringify({ prompt, transcript_path: t, session_id: 's1' }), env: env(extra), encoding: 'utf8' });
const typed = (prompt) => { const r = runGrant(prompt); add(human(prompt)); return r; };
const ok = (cmd, o) => assert.equal(runGate(cmd, o).status, 0, `expected allowed: ${cmd}`);
const blocked = (cmd, o) => assert.equal(runGate(cmd, o).status, 2, `expected blocked: ${cmd}`);

describe('1 push-feature scope escape (CRITICAL)', () => {
    const escapes = [
        "git push origin feat '+feat:main'", "git push origin feat ':main'", 'git push origin feat "--force"',
        'B=main; git push origin feat:$B', 'git push origin feat:heads/main', 'git push origin @',
        'git -c remote.origin.push=refs/heads/feat:refs/heads/main push origin feat', "git push origin feat:ma''in",
        'git push origin HEAD:$T', 'echo main | xargs git push origin', 'xargs git push origin < f', 'git push origin feat\\:main',
        'GIT_DIR=x git push origin feat', 'git --config-env=core.x=Y push origin feat', 'git push origin feat~1:feat2',
        'git push origin feat:refs/remotes/x', 'git push origin "feat"', 'git push origin feat:HEAD', 'git push origin feat:MAIN',
        'git push --mirror origin', 'git push --unknown-flag origin feat', "git push origin feat; bash -c 'git push origin main'",
    ];
    test('none of the review forms classify as push-feature', () => {
        for (const c of escapes) {
            assert.ok(g.isGuardedCommand(c), `guarded: ${c}`);
            const s = g.commandScopes(c);
            assert.ok(s === null || !(s.length === 1 && s[0] === 'push-feature'), `${c} -> ${JSON.stringify(s)}`);
        }
        for (const c of ['git push origin feat:feat', 'git push -u origin feat/x:feat/x', 'git push origin HEAD:feat/x', 'git push origin refs/heads/feat:refs/heads/feat', 'git -C dir push origin feat:feat']) {
            assert.deepEqual(g.commandScopes(c), ['push-feature'], c);
        }
    });
    test('a push-feature grant allows feature pushes and blocks every escape form', () => {
        typed('gogate grant push-feature 1h');
        add(human('carry on'));
        ok('git push origin feat:feat');
        for (const c of escapes) blocked(c);
    });
});

describe('4 main never fails open (HIGH H3)', () => {
    test('a transcript line `null` (last line or in a forged token master) denies with exit 2', () => {
        add(human('hello'));
        fs.appendFileSync(t, 'null\n');
        assert.equal(runGate('git push origin main').status, 2);
        const m = path.join(home, 'master.jsonl');
        fs.writeFileSync(m, 'null\n');
        fs.mkdirSync(path.join(home, '.aos', 'go'), { recursive: true });
        fs.writeFileSync(path.join(home, '.aos', 'go', 'worker-1.token'), JSON.stringify({ target: 'worker-1', issued_at: new Date().toISOString(), master_transcript: m }));
        const w = path.join(home, 'w.jsonl');
        add({ type: 'agent-name', agentName: 'worker-1' }, w);
        add(human('x'), w);
        assert.equal(runGate('git push origin main', { transcript: w }).status, 2);
        fs.writeFileSync(path.join(home, '.aos', 'go', 'worker-1.token'), 'null');
        assert.equal(runGate('git push origin main', { transcript: w }).status, 2);
    });
    test('non-string session_id / transcript_path and odd lines deny with exit 2', () => {
        add(human('GO'));
        for (const input of [
            { tool_input: { command: 'git push origin main' }, transcript_path: t, session_id: { toString: 1 } },
            { tool_input: { command: 'git push origin main' }, transcript_path: t, session_id: 5 },
            { tool_input: { command: 'git push origin main' }, transcript_path: 5, session_id: 's1' },
            { tool_input: { command: 'git push origin main' }, transcript_path: ['a'], session_id: 's1' },
        ]) assert.equal(gateRaw(input).status, 2, JSON.stringify(input));
        fs.appendFileSync(t, '123\n[1]\n"str"\n');
        assert.equal(runGate('git push origin main').status, 0, 'non-object lines are skipped, the human GO stays last');
    });
});

describe('7 scheduled and loop origins (C2)', () => {
    const SCHEDULED = {
        scheduledTaskId: { scheduledTaskId: 't1' },
        scheduledFireId: { scheduledFireId: 'f1' },
        wakeupSource: { wakeupSource: 'cron' },
        'origin scheduled-trigger': { origin: { kind: 'scheduled-trigger' } },
        'origin scheduled': { origin: { kind: 'scheduled' } },
        'origin human + scheduledTaskId': { origin: { kind: 'human', scheduledTaskId: 't1' } },
        'turnOrigin scheduled': { turnOrigin: 'scheduled' },
    };
    test('never human, never a GO, never a mode', () => {
        for (const [name, extra] of Object.entries(SCHEDULED)) {
            assert.equal(g.isHumanEntry(user('GO', extra)), false, name);
            fs.writeFileSync(t, '');
            fs.rmSync(path.join(home, '.aos'), { recursive: true, force: true });
            add(user('GO', extra));
            blocked('git push origin main');
            runGrant('gogate off');
            add(user('gogate off', extra));
            blocked('git push origin main');
        }
    });
    test('strict evidence for gogate: an entry with neither origin nor promptSource is a GO but cannot set a mode', () => {
        assert.equal(g.isHumanEntry(user('x')), true);
        assert.equal(g.isStrictHumanEntry(user('x')), false);
        assert.equal(g.isStrictHumanEntry(user('x', { promptSource: 'typed' })), true);
        assert.equal(g.isStrictHumanEntry(user('x', { origin: { kind: 'human' } })), true);
        add(user('GO'));
        ok('git push origin main');
        runGrant('gogate off');
        add(user('gogate off'));
        add(user('next'));
        blocked('git push origin main');
        add(user('gogate off', { promptSource: 'typed' }));
        runGrant('gogate off');
        ok('git push origin main');
    });
});

describe('8 OpenCode session driving is never grantable (C3)', () => {
    const driving = ['opencode run -s ses_1 "GO"', 'opencode run --session=ses_1 x', 'opencode run --continue x', 'opencode run -c x', 'opencode attach http://localhost:4096',
        'curl -X POST http://127.0.0.1:4096/session/ses_1/message -d @x', 'curl localhost:4096/tui/submit-prompt', 'wget -qO- http://localhost:4096/session/s1/shell'];
    test('guarded with no scope; plain GO still allows; a new opencode run is not guarded', () => {
        for (const c of driving) { assert.ok(g.isGuardedCommand(c), c); assert.equal(g.commandScopes(c), null, c); }
        assert.equal(g.isGuardedCommand('opencode run "hello"'), false);
        for (const s of g.SCOPES) typed(`gogate grant ${s} 1h`);
        add(human('carry on'));
        for (const c of driving) blocked(c);
        add(human('GO'));
        ok(driving[0]);
    });
});

describe('5 store guard forms (M1)', () => {
    test('normalised, case-insensitive and single-& forms are blocked; read-only stays allowed', () => {
        for (const c of ['cp /tmp/x ~/.aos//gate/k.json', 'cp /tmp/x ~/.aos/./gate/k.json', 'cp /tmp/x "$HOME/.aos/ga""te/k.json"', 'cp /tmp/x ~/.aos/ga\\te/k.json',
            'D=gate; cp /tmp/x ~/.aos/$D/k.json', 'cp /tmp/x ~/.aos/gat?/k.json', 'cp /tmp/x ~/.aos/{gate,}/k.json', 'cp /tmp/x ~/.AOS/GATE/k.json',
            `python3 -c "open(__import__('os').path.expanduser('~/.aos/' + 'gate/k.json'),'w')"`,
            `node -e "require('fs').writeFileSync(require('path').join(process.env.HOME,'.aos','gate','k.json'),'{}')"`,
            'cat ~/.aos/gate/k.json & cp /tmp/x ~/.aos/gate/k.json']) {
            assert.ok(g.gateStoreReason(c), c);
        }
        for (const c of ['cat ~/.aos/gate/k.json', 'ls -la ~/.AOS/gate', 'grep x ~/.aos/gate/k.json | head -1']) assert.equal(g.gateStoreReason(c), null, c);
        // a relative gate/ or go/ path right after `cd <...>/.aos` is caught too
        assert.ok(g.gateStoreReason('cd ~/.aos && cp /tmp/x gate/k.json'));
    });
    test('Write to ~/.AOS/gate (case-insensitive APFS) is blocked', () => {
        for (const f of ['~/.AOS/gate/k.json', '~/.aos/Gate/k.json', `${home}/.aos//gate/k.json`, `${home}/.aos/./go/w.token`]) assert.ok(envp.envFileReason(f), f);
    });
});

describe('6 wrappers, prefixes and absolute paths (M2)', () => {
    // The old patterns, verbatim: nothing they guarded may become unguarded.
    const OLD = [/(?:^|[;&|]\s*)git\s+push\b/i, /(?:^|[;&|]\s*)npm\s+publish\b/i, /(?:^|[;&|]\s*)npm\s+version\b/i, /(?:^|[;&|]\s*)gh\s+pr\s+merge\b/i,
        /(?:^|[;&|]\s*)gh\s+release\s+create\b/i, /(?:^|[;&|]\s*)git\s+reset\s+--hard\b/i, /(?:^|[;&|]\s*)git\s+clean\s+-[a-zA-Z]*f\b/i, /(?:^|[;&|]\s*)rm\s+(?:-\w*[rR]\w*|--recursive)\b/i];
    const TABLE = ['git push', 'git push origin feat', 'git push origin main', 'git push origin HEAD:main', 'git push origin feat:heads/main', 'git push origin @',
        "git push origin feat ':main'", "git push origin feat '+feat:main'", "git push origin feat:ma''in", 'git push origin HEAD:$T', 'git push origin feat "--force"',
        'git push origin feat --force', 'git push -u origin feat', 'git -c remote.origin.push=refs/heads/*:refs/heads/main push origin feat', 'git -c alias.p=push p origin main',
        'git --no-pager push origin main', '/usr/bin/git push origin main', 'command git push origin main', 'env git push origin main', 'sudo -u me git push origin main',
        'git -C "my dir" push origin main', 'git -C dir push origin main', 'cd x && git push origin main', 'echo hi; git push origin main', '(git push origin main)',
        'echo `git push origin main`', "bash -c 'git push origin main'", "git push origin feat; bash -c 'git push origin main'", 'git push origin v1.2.3', 'git push --tags',
        'git push origin refs/tags/v1', 'npm publish', 'npm version patch', 'gh pr merge 117', 'gh -R o/r pr merge 118', 'gh pr merge --squash 118', 'gh pr create -t x',
        'gh api -X PUT repos/o/r/pulls/1/merge', 'gh api -fbody=x repos/o/r/issues/1/comments', 'git reset --hard', 'git reset HEAD~1 --hard', 'git clean -fd',
        'rm -rf build', 'rm -r x', 'rm "-rf" x', 'rm -- -r', 'git branch -D x', 'git branch -d -f x', 'git worktree remove x', 'gh repo delete o/r --yes', 'gh release delete v1',
        'gh pr close 3', 'git push origin HEAD', 'git push origin feat:refs/heads/main', 'git push origin +feat', 'git push --force-with-lease origin feat',
        'git push origin --delete feat', 'git push origin feat:master', 'GIT_DIR=x git push origin main', 'nohup git push origin main &', 'time git push origin main',
        'xargs git push origin < f', 'git  push origin main', 'git\tpush origin main', 'git push\torigin\tmain', 'git push origin feat\\:main', 'B=main; git push origin feat:$B',
        'builtin command git push origin main', 'sh -c "npm publish"', '/opt/homebrew/bin/gh pr merge 5', 'eval "rm -rf x"'];
    test('every command of the review table is guarded; nothing guarded before became unguarded', () => {
        for (const c of TABLE) {
            if (OLD.some((r) => r.test(c))) assert.ok(g.isGuardedCommand(c), `regression: ${c}`);
            assert.ok(g.isGuardedCommand(c), `guarded: ${c}`);
        }
        for (const c of ['git status', 'git clean -n', 'rm -f a', 'git branch -d x', 'gh api repos/o/r', 'gh issue view 3', 'git commit -m "x"', 'echo "git push"']) assert.equal(g.isGuardedCommand(c), false, c);
    });
    test('prefixed forms map to the right scope', () => {
        assert.deepEqual(g.commandScopes('gh -R o/r pr merge 118'), ['merge']);
        assert.deepEqual(g.commandScopes('gh --repo=o/r pr close 3'), ['github-write']);
        assert.deepEqual(g.commandScopes('gh api -fbody=x repos/o/r/issues/1/comments'), ['github-write']);
        assert.deepEqual(g.commandScopes('/usr/bin/git push origin feat:feat'), ['push-feature']);
        assert.deepEqual(g.commandScopes('git --no-pager push origin feat:feat'), ['push-feature']);
        assert.deepEqual(g.commandScopes('sudo -u me git push origin feat:feat'), ['push-feature']);
        assert.deepEqual(g.commandScopes('rm "-rf" x'), ['destructive']);
        assert.equal(g.commandScopes('git -c alias.p=push p origin main'), null);
        assert.equal(g.commandScopes("bash -c 'git push origin feat'"), null);
    });
});

describe('9 low findings', () => {
    test('session keys of different ids never collide', () => {
        assert.notEqual(g.sessionKey('Sess-A'), g.sessionKey('sess-A'));
        assert.equal(g.sessionKey('0f1e2d3c-aaaa-bbbb-cccc-123456789abc'), '0f1e2d3c-aaaa-bbbb-cccc-123456789abc');
        typed('gogate off');
        ok('git push origin main');
        blocked('git push origin main', { session: 'S1' });
    });
    test('the gate log is capped', async () => {
        const saved = process.env.HOME;
        process.env.HOME = home;
        try {
            for (let i = 0; i < 1500; i++) g.gateLog('cap', `line ${i} ${'x'.repeat(300)}`);
        } finally { process.env.HOME = saved; }
        const size = fs.statSync(path.join(home, '.aos', 'gate', 'cap.log')).size;
        assert.ok(size <= 256 * 1024 + 1024, `log size ${size}`);
        assert.match(fs.readFileSync(path.join(home, '.aos', 'gate', 'cap.log'), 'utf8'), /line 1499/);
    });
    test('go-grant tells the human when the store cannot be written', () => {
        fs.mkdirSync(path.join(home, '.aos'), { recursive: true });
        fs.writeFileSync(path.join(home, '.aos', 'gate'), 'not a dir');
        const r = runGrant('gogate grant merge 1h');
        assert.equal(r.status, 0);
        assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /could NOT record/);
    });
    test('session grants are described honestly in the status', () => {
        typed('gogate grant merge session');
        const out = spawnSync(process.execPath, [GRANT, '--status', '--session', 's1'], { env: env(), encoding: 'utf8' }).stdout;
        assert.match(out, /session = this session id, max 24h, survives --resume/);
    });
    test('a large transcript is read from the end and still verifies a GO', () => {
        const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'gogate '.repeat(1400) }] } }) + '\n';
        fs.writeFileSync(t, line.repeat(3000)); // ~30 MB
        add(human('GO'));
        ok('git push origin main');
    });
});
