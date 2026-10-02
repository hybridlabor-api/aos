// Regression tests for the second C1 security review (push refmap escape, plain-text gogate
// form, OpenCode guard, wrappers/catch-all, adaptive GO origin, protected branches, low items).
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
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gogate-rv2-'));
    t = path.join(home, 'session.jsonl');
    fs.writeFileSync(t, '');
    n = 0;
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const env = (extra = {}) => ({ ...process.env, HOME: home, XDG_DATA_HOME: '', AOS_SESSION_NAME: '', AOS_ACP_CLIENT: '', AOS_GATE_PROTECTED_BRANCHES: '', ...extra });
const add = (e, file = t) => fs.appendFileSync(file, JSON.stringify(e) + '\n');
const ts = (agoMs = 0) => new Date(Date.now() - agoMs).toISOString();
const user = (text, extra = {}) => ({ type: 'user', uuid: `u${++n}`, timestamp: ts(), message: { role: 'user', content: text }, ...extra });
const human = (text, extra = {}) => user(text, { origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human', ...extra });
const wrapper = (name, args) => user(`<command-name>/${name}</command-name>\n<command-message>${name}</command-message>\n<command-args>${args}</command-args>`);
const runGate = (command, { session = 's1', transcript = t, cwd = home } = {}) => spawnSync(process.execPath, [GATE], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, transcript_path: transcript, session_id: session, cwd }), env: env(), encoding: 'utf8',
});
const runGrant = (prompt) => spawnSync(process.execPath, [GRANT], { input: JSON.stringify({ prompt, transcript_path: t, session_id: 's1' }), env: env(), encoding: 'utf8' });
const ctx = (r) => JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
const typed = (prompt) => { const r = runGrant(prompt); add(human(prompt)); return r; };
const status = () => spawnSync(process.execPath, [GRANT, '--status', '--session', 's1'], { env: env(), encoding: 'utf8' }).stdout;
const ok = (cmd, o) => assert.equal(runGate(cmd, o).status, 0, `expected allowed: ${cmd}`);
const blocked = (cmd, o) => assert.equal(runGate(cmd, o).status, 2, `expected blocked: ${cmd}`);
const pushFeatureOnly = (s) => Array.isArray(s) && s.length === 1 && s[0] === 'push-feature';

describe('H1 push refmap escape', () => {
    const escapes = [
        'git config remote.origin.push refs/heads/feat:refs/heads/main && git push origin feat',
        'export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.push GIT_CONFIG_VALUE_0=refs/heads/feat:refs/heads/main; git push origin feat',
        'git config remote.origin.push refs/heads/feat:refs/heads/main && git push origin feat:feat',
        'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=x GIT_CONFIG_VALUE_0=y git push origin feat:feat',
        'git remote set-url --push origin ../evil && git push origin feat:feat',
        'git remote add m2 ../x && git push m2 feat:feat',
        'git push origin feat', 'git push -u origin feat', 'git push origin HEAD',
    ];
    test('never push-feature; an explicit src:dst still is', () => {
        for (const c of escapes) assert.ok(!pushFeatureOnly(g.commandScopes(c)), `${c} -> ${JSON.stringify(g.commandScopes(c))}`);
        for (const c of ['git push origin feat:feat', 'git push -u origin feat:feat', 'git push origin refs/heads/a:refs/heads/a']) assert.ok(pushFeatureOnly(g.commandScopes(c)), c);
    });
    test('with a push-feature grant every escape is blocked, feat:feat passes', () => {
        typed('gogate grant push-feature 1h');
        add(human('carry on'));
        ok('git push origin feat:feat');
        for (const c of escapes) blocked(c);
    });
});

describe('H2 plain-text gogate form, skill name, non-strict modes', () => {
    test('the skill is named gogate and the plugin lists it', () => {
        const skill = fs.readFileSync(path.join(REPO, 'skills', 'global_config', 'gogate', 'SKILL.md'), 'utf8');
        assert.match(skill, /^name: gogate$/m);
        assert.match(skill, /^category: bdb-core$/m);
        assert.doesNotMatch(skill, /disable-model-invocation/);
        assert.ok(fs.readFileSync(path.join(REPO, '.claude-plugin', 'plugin.json'), 'utf8').includes('./skills/global_config/gogate"'));
        assert.deepEqual(g.parseGogate('/bdb-aos:gogate status'), { cmd: 'status', form: 'slash' });
    });
    test('a typed plain `gogate grant` works end to end', () => {
        const r = typed('gogate grant merge 2h');
        assert.match(ctx(r), /recorded grant for merge/);
        assert.doesNotMatch(ctx(r), /slash command/);
        add(human('merge it'));
        ok('gh pr merge 5');
    });
    test('a slash form is recorded, the hook says to type the plain form, and it does not verify without origin', () => {
        const r = runGrant('/bdb-aos:gogate grant merge 2h');
        assert.match(ctx(r), /type the plain form as the whole message: `gogate grant merge <duration>`/);
        add(wrapper('bdb-aos:gogate', 'grant merge 2h'));
        blocked('gh pr merge 5');
        assert.match(status(), /plain form/);
    });
    test('a non-strict soft/off leaves the previous mode; a non-strict hard still tightens', () => {
        typed('gogate grant merge 1h');
        add(human('x'));
        ok('gh pr merge 5');
        runGrant('/bdb-aos:gogate off');
        add(wrapper('bdb-aos:gogate', 'off'));
        ok('gh pr merge 5'); // still soft with the grant, not silently hard
        blocked('git push origin main'); // and not off either
        assert.match(status(), /mode soft/);
        runGrant('/bdb-aos:gogate hard');
        add(wrapper('bdb-aos:gogate', 'hard'));
        blocked('gh pr merge 5');
        assert.match(status(), /mode hard/);
    });
    test('a strict mode survives a later unverifiable mode prompt in the store', () => {
        typed('gogate off');
        ok('git push origin main');
        runGrant('/bdb-aos:gogate soft'); // writes a second store entry that never verifies
        add(wrapper('bdb-aos:gogate', 'soft'));
        ok('git push origin main');
    });
});

describe('H3 OpenCode HTTP and session driving', () => {
    test('host spelling does not matter; all get no scope', () => {
        for (const c of ['curl -X POST http://127.1:4096/session/abc/message', 'curl "http://localhost:4096"/session/abc/message', 'curl http://localhost:4096//session/abc/message',
            'curl http://127.0.0.2:4096/session/abc/message', 'curl http://[::ffff:127.0.0.1]:4096/session/x/message', 'curl http://$(hostname):4096/session/x/message',
            'curl --unix-socket /tmp/oc.sock http://x/session/a/message', 'curl -X POST http://x/session/a/prompt_async', 'curl http://x/session/a/command', 'curl http://x/session/a/shell',
            'curl -X POST http://h:4096/tui/submit-prompt', 'opencode run -sabc hi', 'opencode run --session=abc hi', 'opencode run -c hi', 'opencode run --continue hi', 'opencode attach http://x']) {
            assert.ok(g.isGuardedCommand(c), c);
            assert.equal(g.commandScopes(c), null, c);
        }
        for (const c of ['opencode run hi', 'curl http://localhost:4096/session', 'ls src/tui/']) assert.equal(g.isGuardedCommand(c), false, c);
    });
});

describe('M1 wrappers, git options, package managers', () => {
    const guarded = ['timeout 60 git push origin main', 'nice rm -rf build', 'caffeinate -i git push origin main', 'stdbuf -oL git push origin main', 'doas git push origin main',
        'script -q /dev/null git push origin main', '! git push origin main', '/usr/bin/env git push origin main', 'git -P push origin main', 'git --git-dir .git push origin main',
        'git --work-tree . reset --hard', 'git --namespace x push origin main', 'npm --prefix x publish', 'npm -w pkg publish', 'pnpm publish', 'yarn npm publish', 'yarn publish', 'bun publish',
        'timeout 60 npm publish', 'watch -n1 gh pr merge 1', 'hub push origin main', 'g\\it push origin main', '$(echo git) push origin main', 'npx np', 'npx semantic-release',
        'nice -n 5 timeout -s KILL 30 sudo -u me env A=1 git push origin main', 'git --super-prefix x/ clean -fdx', 'some-wrapper --flag git push origin main'];
    test('every wrapper form is guarded', () => {
        for (const c of guarded) assert.ok(g.isGuardedCommand(c), c);
    });
    test('classified where the parser can read it, no scope where it cannot', () => {
        assert.deepEqual(g.commandScopes('timeout 60 git push origin feat:feat'), ['push-feature']);
        assert.deepEqual(g.commandScopes('nice rm -rf build'), ['destructive']);
        assert.deepEqual(g.commandScopes('npm --prefix x publish'), ['publish']);
        assert.deepEqual(g.commandScopes('git --git-dir .git push origin main'), ['push-main']);
        for (const c of ['watch -n1 gh pr merge 1', 'some-wrapper --flag git push origin main', '$(echo git) push origin main', "sh -c 'git push origin feat:feat'"]) assert.equal(g.commandScopes(c), null, c);
        for (const c of ['git status', 'git log --grep push', 'git commit -m "push fix"', 'git branch', 'npm run release', 'npm test', 'echo "git push"']) assert.equal(g.isGuardedCommand(c), false, c);
    });
    test('a PR GO does not cover wrapped extra commands', () => {
        const go = g.parseGoText('GO #117');
        for (const c of ['gh pr merge 117 && timeout 9 git push origin main', 'gh pr merge 117 && nice rm -rf ~', 'gh pr merge 117; caffeinate git push origin main']) assert.equal(g.goAllows(go, c), false, c);
        assert.equal(g.goAllows(go, 'gh pr merge 117'), true);
    });
    test('text piped into a shell is read as the command', () => {
        for (const c of ['echo "git push --force origin main" | sh', 'printf %s "npm publish" | bash -s', 'gh pr merge 117 | sh', 'echo "rm -rf ~" | source /dev/stdin']) {
            assert.ok(g.isGuardedCommand(c), c);
            assert.equal(g.commandScopes(c), null, c);
        }
        assert.equal(g.goAllows(g.parseGoText('GO #117'), 'gh pr merge 117 | sh'), false);
        assert.equal(g.isGuardedCommand('ls | sh'), false);
    });
});

describe('M2 adaptive GO origin rule', () => {
    test('modern transcript: a GO without origin does not count', () => {
        add(human('hello'));
        add(user('GO'));
        blocked('git push origin main');
        add(human('GO'));
        ok('git push origin main');
    });
    test('legacy transcript (no origin anywhere): a plain GO still counts', () => {
        add(user('hello'));
        add(user('GO'));
        ok('git push origin main');
    });
});

describe('M3 protected branches', () => {
    test('default protects the usual long-lived names', () => {
        for (const c of ['git push origin feat:develop', 'git push origin feat:trunk', 'git push origin feat:production', 'git push origin feat:release', 'git push origin feat:release-1.2', 'git push origin feat:Master']) {
            assert.ok(!pushFeatureOnly(g.commandScopes(c)), c);
        }
    });
    test('the remote HEAD extends the fallback list when it resolves; failures fall back; env adds', () => {
        const calls = [];
        const okRun = (cmd, args) => { calls.push([cmd, ...args]); return { status: 0, stdout: 'origin/dev\n' }; };
        const r = g.makeBranchResolver(home, okRun);
        assert.ok(!pushFeatureOnly(g.commandScopes('git push origin feat:dev', r)));
        assert.ok(!pushFeatureOnly(g.commandScopes('git push origin feat:develop', r)));
        assert.ok(!pushFeatureOnly(g.commandScopes('git push origin feat:main', r)));
        assert.deepEqual(calls[0], ['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
        const boom = g.makeBranchResolver(home, () => { throw new Error('no git'); });
        assert.ok(!pushFeatureOnly(g.commandScopes('git push origin feat:develop', boom)));
        const fail = g.makeBranchResolver(home, () => ({ status: 128, stdout: '' }));
        assert.ok(!pushFeatureOnly(g.commandScopes('git push origin feat:trunk', fail)));
        const saved = process.env.AOS_GATE_PROTECTED_BRANCHES;
        process.env.AOS_GATE_PROTECTED_BRANCHES = 'staging, qa-*';
        try {
            assert.ok(!pushFeatureOnly(g.commandScopes('git push origin feat:staging')));
            assert.ok(!pushFeatureOnly(g.commandScopes('git push origin feat:qa-2')));
        } finally { if (saved === undefined) delete process.env.AOS_GATE_PROTECTED_BRANCHES; else process.env.AOS_GATE_PROTECTED_BRANCHES = saved; }
    });
    test('at gate time outside a git repo the fallback list applies', () => {
        typed('gogate grant push-feature 1h');
        add(human('x'));
        ok('git push origin feat:feat');
        blocked('git push origin feat:develop');
        blocked('git push origin feat:production');
    });
});

describe('low findings', () => {
    test('L1 process substitution is not read-only', () => {
        for (const c of ['cat ~/.aos/gate/k <(cp /tmp/x ~/.aos/gate/k.json)', 'ls ~/.aos/gate <(rm -f ~/.aos/gate/k.json)', 'grep x ~/.aos/gate/k.json <(touch ~/.aos/gate/x)']) assert.ok(g.gateStoreReason(c), c);
        assert.equal(g.gateStoreReason('cat ~/.aos/gate/k.json'), null);
    });
    test('L2 a symlinked file pointing into the store is blocked', () => {
        fs.mkdirSync(path.join(home, '.aos', 'gate'), { recursive: true });
        fs.writeFileSync(path.join(home, '.aos', 'gate', 's1.json'), '{}');
        fs.symlinkSync(path.join(home, '.aos', 'gate', 's1.json'), path.join(home, 'innocent.json'));
        assert.ok(envp.envFileReason(path.join(home, 'innocent.json')));
    });
    test('L3 unreadable stdin denies with exit 2', () => {
        const fd = fs.openSync(home, 'r'); // a directory: reading it fails with EISDIR
        try {
            const r = spawnSync(process.execPath, [GATE], { stdio: [fd, 'pipe', 'pipe'], env: env(), encoding: 'utf8' });
            assert.equal(r.status, 2, r.stderr);
        } finally { fs.closeSync(fd); }
    });
    test('L4 exact key names: isLoopback is fine, scheduler marks are not', () => {
        const base = { type: 'user', origin: { kind: 'human' }, promptSource: 'typed', message: { content: 'x' } };
        assert.equal(g.isHumanEntry({ ...base, isLoopback: false }), true);
        assert.equal(g.isHumanEntry({ ...base, loopbackHost: 'x' }), true);
        for (const e of [{ ...base, scheduleId: 'a' }, { ...base, cronId: 'a' }, { ...base, loopId: 'a' }, { ...base, origin: { kind: 'human', meta: { scheduled: true } } },
            { ...base, origin: { kind: 'human', via: 'cron' } }, { ...base, origin: { kind: 'human', trigger: { scheduledTaskId: 't' } } }, { ...base, promptSource: 'scheduled' }]) {
            assert.equal(g.isHumanEntry(e), false, JSON.stringify(e));
        }
    });
    test('L5 output redirections do not over-block a feature push', () => {
        for (const c of ['git push origin feat:feat 2>&1', 'git push origin feat:feat >/dev/null', 'git push origin feat:feat &>push.log', 'git push origin feat:feat 2>/dev/null | tail -1']) {
            assert.ok(pushFeatureOnly(g.commandScopes(c)), c);
        }
    });
    test('L6 a queued prompt landing 8 minutes after the hook still verifies', () => {
        runGrant('gogate grant merge 1h');
        const st = JSON.parse(fs.readFileSync(path.join(home, '.aos', 'gate', 's1.json'), 'utf8'));
        st.grants[0].source.issued_at = ts(8 * 60e3);
        fs.writeFileSync(path.join(home, '.aos', 'gate', 's1.json'), JSON.stringify(st));
        add(human('gogate grant merge 1h'));
        add(human('x'));
        ok('gh pr merge 5');
    });
});

// round-4 regressions (third review)
test('round4: read-only commands are not guarded, writes stay guarded', async () => {
  const { classify } = await import('../.claude/hooks/go-gate.mjs');
  for (const c of ['npm view @bdb/aos version', 'npm pkg get version', 'git config --get remote.origin.url', 'git config push.default', "node -e \"console.log('push')\"", 'git log --format="%s (push)"'])
    assert.deepStrictEqual(classify(c), [], c);
  assert.strictEqual(classify('git config push.default simple'), null);
  assert.deepStrictEqual(classify('npm version patch'), ['publish']);
});
