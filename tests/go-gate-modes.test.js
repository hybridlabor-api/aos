// go-gate modes, grants, origin check, GO <text>, store protection (Claude Code path).
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

let g; // go-gate.mjs exports
before(async () => { g = await import(pathToFileURL(GATE).href); });

let home, t, n, repo;
beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gogate-'));
    t = path.join(home, 'session.jsonl');
    fs.writeFileSync(t, '');
    n = 0;
    process.env.AOS_GATE_TEST_REALHOME = home;
    process.env.XDG_CONFIG_HOME = path.join(home, '.config');
    // The pushes below read their repository state (branch, push config) from the hook's cwd,
    // so every test gets a temp repo on a feature branch with an empty config.
    repo = path.join(home, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    setRepo('ref: refs/heads/feat/work\n', '');
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });
const setRepo = (head, config) => {
    fs.writeFileSync(path.join(repo, '.git', 'HEAD'), head);
    fs.writeFileSync(path.join(repo, '.git', 'config'), config);
};

// git config is read from the temp home only: no machine ~/.gitconfig, /etc/gitconfig or GIT_* variables.
process.env.AOS_TEST_SANDBOX = '1';
process.env.GIT_CONFIG_NOSYSTEM = '1';
for (const k of Object.keys(process.env)) if (/^GIT_/.test(k) && k !== 'GIT_CONFIG_NOSYSTEM') delete process.env[k];
const env = (extra = {}) => ({ ...process.env, HOME: home, XDG_DATA_HOME: '', AOS_SESSION_NAME: '', AOS_ACP_CLIENT: '', ...extra });
const ts = (agoMs = 0) => new Date(Date.now() - agoMs).toISOString();
const add = (e) => fs.appendFileSync(t, JSON.stringify(e) + '\n');
const user = (text, extra = {}) => ({ type: 'user', uuid: `u${++n}`, timestamp: ts(), message: { role: 'user', content: text }, ...extra });
const human = (text, extra = {}) => user(text, { origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human', ...extra });
const NONHUMAN = {
    peer: { origin: { kind: 'peer', from: 'x' }, promptSource: 'system', isMeta: true, turnOrigin: 'peer' },
    'task-notification': { origin: { kind: 'task-notification' }, promptSource: 'system' },
    coordinator: { origin: { kind: 'coordinator' } },
    'auto-continuation': { origin: { kind: 'auto-continuation' }, promptSource: 'system', isMeta: true },
    loop: { promptSource: 'system', isMeta: true, turnOrigin: 'system', queuePriority: 'later' },
    sdk: { promptSource: 'sdk', turnOrigin: 'sdk' },
    'human+sdk': { origin: { kind: 'human' }, promptSource: 'sdk' },
    suggestion: { origin: { kind: 'human' }, promptSource: 'suggestion_accepted' },
    'absent origin, peer turn': { turnOrigin: 'peer' },
    'absent origin, system source': { promptSource: 'system' },
    'absent origin, sdk source': { promptSource: 'sdk' },
    'absent origin, queued': { promptSource: 'queued' },
    'skill injection': { isMeta: true, sourceToolUseID: 'toolu_1' },
    sidechain: { isSidechain: true },
};

const runGate = (command, { session = 's1', transcript = t } = {}) => spawnSync(process.execPath, [GATE], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, transcript_path: transcript, session_id: session, cwd: repo }),
    env: env(), encoding: 'utf8',
});
const runGrant = (prompt, { session = 's1', transcript = t, extra = {} } = {}) => spawnSync(process.execPath, [GRANT], {
    input: JSON.stringify({ prompt, transcript_path: transcript, session_id: session, hook_event_name: 'UserPromptSubmit' }),
    env: env(extra), encoding: 'utf8',
});
// The human types a gogate command: the hook runs, then the entry lands in the transcript.
const typed = (prompt, extra = {}) => { const r = runGrant(prompt); add(human(prompt, extra)); return r; };
const ok = (cmd, opts) => assert.equal(runGate(cmd, opts).status, 0, `expected allowed: ${cmd}`);
const blocked = (cmd, opts) => assert.equal(runGate(cmd, opts).status, 2, `expected blocked: ${cmd}`);
const statePath = (key = 's1') => path.join(home, '.aos', 'gate', `${key}.json`);
const readState = (key) => JSON.parse(fs.readFileSync(statePath(key), 'utf8'));
const logText = (key = 's1') => { try { return fs.readFileSync(path.join(home, '.aos', 'gate', `${key}.log`), 'utf8'); } catch { return ''; } };

describe('origin check', () => {
    test('isHumanEntry: typed, queued and legacy entries count; every non-human shape does not', () => {
        assert.equal(g.isHumanEntry(human('GO')), true);
        assert.equal(g.isHumanEntry(human('GO', { promptSource: 'queued' })), true);
        assert.equal(g.isHumanEntry(user('GO')), true, 'absent origin + absent promptSource: legacy human');
        assert.equal(g.isHumanEntry(user('GO', { promptSource: 'typed' })), true);
        for (const [name, extra] of Object.entries(NONHUMAN)) assert.equal(g.isHumanEntry(user('GO', extra)), false, name);
    });

    test('a human GO opens the gate; legacy entries only in a transcript without origin', () => {
        add(human('GO'));
        ok('git push origin main');
        add(user('go'));
        blocked('git push origin main'); // M2: this transcript records origin, so the GO must carry it
        const legacy = path.join(home, 'legacy.jsonl');
        fs.writeFileSync(legacy, JSON.stringify(user('hello')) + '\n' + JSON.stringify(user('go')) + '\n');
        ok('git push origin main', { transcript: legacy });
    });

    for (const [name, extra] of Object.entries(NONHUMAN)) {
        if (name === 'sidechain') continue; // sidechain entries are skipped, not "last"
        test(`GO from ${name} never opens the gate`, () => {
            add(human('GO'));
            add(user('GO', extra));
            blocked('git push origin main');
        });
    }

    test('a token is not honoured when the master GO entry is not human', () => {
        const m = path.join(home, 'master.jsonl');
        fs.writeFileSync(m, JSON.stringify(user('GO worker-1', NONHUMAN.loop)) + '\n');
        fs.mkdirSync(path.join(home, '.aos', 'go'), { recursive: true });
        fs.writeFileSync(path.join(home, '.aos', 'go', 'worker-1.token'), JSON.stringify({ target: 'worker-1', issued_at: ts(), master_transcript: m }));
        add({ type: 'agent-name', agentName: 'worker-1' });
        add(human('x'));
        blocked('git push origin feat/x');
    });
});

describe('modes', () => {
    test('default soft without a grant behaves like hard', () => {
        add(human('please merge'));
        blocked('gh pr merge 5');
        add(human('GO'));
        ok('gh pr merge 5');
    });

    test('hard ignores grants and revokes earlier ones; a later grant works after soft', () => {
        typed('gogate grant merge 2h');
        add(human('next'));
        ok('gh pr merge 5');
        typed('gogate hard');
        blocked('gh pr merge 5');
        typed('gogate soft');
        blocked('gh pr merge 5'); // the grant before hard stays revoked
        typed('gogate grant merge 2h');
        ok('gh pr merge 5');
    });

    test('off logs and never blocks, only for this session', () => {
        typed('gogate off');
        ok('git push --force origin main');
        assert.match(logText(), /off: allowed "git push --force origin main"/);
        const other = path.join(home, 'other.jsonl');
        fs.writeFileSync(other, JSON.stringify(human('hi')) + '\n');
        blocked('git push --force origin main', { session: 's2', transcript: other });
    });

    test('off expires after 24h and then fails closed to hard', () => {
        const prompt = 'gogate off';
        runGrant(prompt);
        const st = readState();
        st.modes[0].source.issued_at = ts(25 * 3600e3);
        fs.writeFileSync(statePath(), JSON.stringify(st));
        add(human(prompt, { timestamp: ts(25 * 3600e3) }));
        blocked('git push origin main');
    });

    test('a mode change from a non-human entry is rejected', () => {
        const prompt = 'gogate off';
        runGrant(prompt); // the hook fires for a loop prompt too
        add(user(prompt, NONHUMAN.loop));
        blocked('git push origin main');
    });

    test('reverting the store to an older mode entry is rejected', () => {
        typed('gogate off');
        const offState = readState();
        typed('gogate hard');
        fs.writeFileSync(statePath(), JSON.stringify(offState));
        blocked('git push origin main');
    });
});

describe('grant parsing', () => {
    test('scopes, durations, 24h limit, session, errors', () => {
        assert.deepEqual(g.parseGogate('/bdb-aos:gogate grant merge,push-feature 2h'), { cmd: 'grant', scopes: ['merge', 'push-feature'], ms: 2 * 3600e3, session: false, form: 'slash' });
        assert.deepEqual(g.parseGogate('gogate grant merge,push-feature 2h'), { cmd: 'grant', scopes: ['merge', 'push-feature'], ms: 2 * 3600e3, session: false, form: 'plain' });
        assert.deepEqual(g.parseGogate('GoGate OFF'), { cmd: 'off', form: 'plain' });
        assert.deepEqual(g.parseGogate('/gogate status'), { cmd: 'status', form: 'slash' });
        assert.equal(g.parseGogate('/bdb-aos-gogate grant merge 15m').ms, 15 * 60e3);
        assert.equal(g.parseGogate('/bdb-aos-gogate grant merge 1d').ms, 24 * 3600e3);
        assert.equal(g.parseGogate('/bdb-aos-gogate grant merge session').session, true);
        assert.match(g.parseGogate('/bdb-aos-gogate grant merge 25h').error, /24h/);
        assert.match(g.parseGogate('/bdb-aos-gogate grant merge 2d').error, /24h/);
        assert.match(g.parseGogate('/bdb-aos-gogate grant merge forever').error, /duration/);
        assert.match(g.parseGogate('/bdb-aos-gogate grant everything 2h').error, /unknown scope/);
        assert.match(g.parseGogate('/bdb-aos-gogate grant merge').error, /usage/);
        assert.deepEqual(g.parseGogate('/bdb-aos-gogate'), { cmd: 'status', form: 'slash' });
        assert.deepEqual(g.parseGogate('/BDB-AOS:GOGATE OFF'), { cmd: 'off', form: 'slash' });
        // plain form: whole message, one line, a known subcommand; prose is not a command
        for (const t of ['please /bdb-aos-gogate grant merge 2h', '/bdb-aos-gogater off', 'please gogate off', 'gogate off please', 'gogate', 'gogate is great', 'gogate\nsoft', 'gogate\toff', 'gogate off\u2028x', 'x gogate grant merge 2h']) {
            const r = g.parseGogate(t);
            assert.ok(r === null || r.error, JSON.stringify(t));
        }
        // the transcript shape of a slash command parses the same
        assert.deepEqual(g.parseGogate('<command-name>/bdb-aos-gogate</command-name>\n<command-message>bdb-aos-gogate</command-message>\n<command-args>grant merge 2h</command-args>'), g.parseGogate('/bdb-aos-gogate grant merge 2h'));
    });

    test('the hook records nothing for errors and non-gogate prompts', () => {
        const r = runGrant('/bdb-aos-gogate grant merge 48h');
        assert.equal(r.status, 0);
        assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /24h maximum/);
        assert.equal(runGrant('gogate is great').stdout, '');
        assert.equal(fs.existsSync(statePath()), false);
    });

    test('an aos-acp worker session never records', () => {
        runGrant('/bdb-aos-gogate grant merge 2h', { extra: { AOS_ACP_CLIENT: '1' } });
        assert.equal(fs.existsSync(statePath()), false);
    });

    // C2: a slash-command wrapper without origin/promptSource is not strict human evidence.
    test('slash-command wrapper entries without origin cannot set a grant; status says how to proceed', () => {
        const prompt = '/bdb-aos-gogate grant merge 2h';
        runGrant(prompt);
        add(user(`<command-name>/bdb-aos-gogate</command-name>\n<command-message>bdb-aos-gogate</command-message>\n<command-args>grant merge 2h</command-args>`));
        blocked('gh pr merge 5');
        const st = spawnSync(process.execPath, [GRANT, '--status', '--session', 's1'], { env: env(), encoding: 'utf8' }).stdout;
        assert.match(st, /type the plain form/);
        // the plain form typed as a normal message (origin human, typed) verifies
        typed('gogate grant merge 2h');
        ok('gh pr merge 5');
    });

    test('a wrapper carrying origin human verifies; trailing text after the wrapper does not parse', () => {
        const prompt = '/bdb-aos:gogate grant merge 2h';
        runGrant(prompt);
        add(user('<command-name>/bdb-aos:gogate</command-name><command-args>grant merge 2h</command-args>', { origin: { kind: 'human' }, turnOrigin: 'human' }));
        ok('gh pr merge 5');
        assert.equal(g.parseGogate('<command-name>/bdb-aos:gogate</command-name><command-args>off</command-args> hello'), null);
        assert.equal(g.parseGogate('<command-name>/loop</command-name><command-args>5m /bdb-aos:gogate off</command-args>'), null);
    });
});

describe('scopes', () => {
    const cases = {
        'push-feature': { yes: ['git push origin feat/x:feat/x', 'git push -u origin feat/x:feat/x', 'git push origin HEAD:feat/x', 'git push origin feat:feat 2>&1', 'git push origin feat/x', 'git push -u origin feat/x', 'git push', 'git push -u origin'], no: ['git push origin main', 'git push origin HEAD', 'git push origin @', 'git push --force origin feat/x', 'git push --force-with-lease origin feat/x', 'git push origin +feat/x', 'git push origin feat:master', 'gh pr merge 5'] },
        'push-main': { yes: ['git push origin main', 'git push --force origin feat/x', 'git push'], no: ['gh pr merge 5', 'npm publish'], head: 'ref: refs/heads/main\n' },
        merge: { yes: ['gh pr merge 5', 'gh pr merge 5 --squash --delete-branch'], no: ['gh pr close 5', 'gh pr create --title x', 'git push origin feat/x'] },
        publish: { yes: ['npm publish', 'npm version patch', 'gh release create v1.0.0', 'git push origin v1.2.3', 'git push origin refs/tags/v1'], no: ['git push origin feat/x', 'gh release edit v1'] },
        destructive: { yes: ['git reset --hard HEAD~1', 'git clean -f', 'git clean -fd', 'git clean -fdx', 'git clean -xfd', 'rm -rf build', 'rm -r build', 'rm -R build', 'rm --recursive build', 'git branch -D old', 'git branch --delete --force old', 'git worktree remove ../wt'], no: ['git push origin feat/x', 'npm publish'] },
        'github-write': { yes: ['gh pr create --title x', 'gh pr comment 5 -b hi', 'gh pr edit 5', 'gh pr review 5 --approve', 'gh pr close 5', 'gh issue create -t x', 'gh issue comment 3 -b x', 'gh release edit v1', 'gh release delete v1', 'gh repo create x', 'gh repo edit x', 'gh repo delete x', 'gh api repos/o/r/issues -X POST', 'gh api repos/o/r -f a=b', 'gh api --method PATCH repos/o/r'], no: ['gh pr merge 5', 'git push origin feat/x'] },
    };
    for (const [scope, { yes, no, head }] of Object.entries(cases)) {
        test(`grant ${scope}: matching commands pass, others stay blocked`, () => {
            if (head) setRepo(head, ''); // a bare push on main is push-main
            typed(`gogate grant ${scope} 1h`);
            add(human('carry on'));
            for (const c of yes) { assert.ok(g.isGuardedCommand(c), `guarded: ${c}`); ok(c); }
            for (const c of no) blocked(c);
        });
    }

    test('a command needing two scopes needs both; compound commands need every scope', () => {
        typed('gogate grant push-feature 1h');
        add(human('carry on'));
        blocked('git push origin feat/x:feat/x && npm publish');
        typed('gogate grant publish 1h');
        ok('git push origin feat/x:feat/x && npm publish');
        ok('git push --tags'); // on a feature branch this is publish only, and publish is granted
        setRepo('ref: refs/heads/main\n', '');
        blocked('git push --tags'); // on main: publish + push-main
    });

    test('a push-feature grant covers plain names and bare pushes only where the repo proves a feature branch', () => {
        typed('gogate grant push-feature 1h');
        add(human('carry on'));
        ok('git push -u origin feat/x');
        ok('git push');
        setRepo('ref: refs/heads/feat/work\n', '[remote "origin"]\n\tpush = refs/heads/feat/work:refs/heads/main\n');
        blocked('git push origin feat/x');
        blocked('git push');
        ok('git push origin feat/x:feat/x');
        setRepo('ref: refs/heads/main\n', '');
        blocked('git push');
        blocked('git push -u origin feat/x:main');
    });

    test('unguarded commands stay unguarded, new patterns are guarded in hard mode', () => {
        for (const c of ['git status', 'git branch -d merged', 'git clean -n', 'gh pr view 5', 'gh api repos/o/r', 'rm file.txt', 'git commit -m "docs: rm -rf notes"']) {
            assert.equal(g.isGuardedCommand(c), false, c);
            ok(c);
        }
        for (const c of ['gh pr create --title x', 'git worktree remove ../x', 'git branch -D x', 'git clean -fd', 'echo hi\ngit push origin main', 'git -C . push origin main', 'rm -f -r build']) blocked(c);
    });
});

describe('grant verification', () => {
    const grantEntry = (over = {}) => ({ scope: 'merge', until: ts(-3600e3), source: { transcript: t, uuid: null, issued_at: ts(), text_hash: g.textHash('/bdb-aos-gogate grant merge 2h') }, ...over });
    const writeStore = (st) => { fs.mkdirSync(path.dirname(statePath()), { recursive: true }); fs.writeFileSync(statePath(), JSON.stringify(st)); };

    test('a valid grant passes and is listed by status', () => {
        typed('gogate grant merge 2h');
        add(human('merge it'));
        ok('gh pr merge 5');
        const r = spawnSync(process.execPath, [GRANT, '--status', '--session', 's1'], { env: env(), encoding: 'utf8' });
        assert.equal(r.status, 0);
        assert.match(r.stdout, /mode soft/);
        assert.match(r.stdout, /grant merge until \d{4}-\d\d-\d\dT.* min left/);
    });

    test('a grant written into the store without a transcript entry is rejected and logged', () => {
        add(human('hello'));
        writeStore({ transcript: t, grants: [grantEntry()] });
        blocked('gh pr merge 5');
        assert.match(logText(), /rejected: grant merge has no matching human gogate entry/);
    });

    test('a grant whose transcript entry is not human is rejected', () => {
        for (const extra of [NONHUMAN.loop, NONHUMAN.peer, NONHUMAN['task-notification'], NONHUMAN['skill injection']]) {
            fs.writeFileSync(t, '');
            fs.rmSync(path.join(home, '.aos'), { recursive: true, force: true });
            runGrant('gogate grant merge 2h');
            add(user('gogate grant merge 2h', extra));
            blocked('gh pr merge 5');
        }
    });

    test('text hash mismatch, widened scope, foreign transcript and replayed timestamps are rejected', () => {
        typed('gogate grant merge 2h');
        add(human('x'));
        const good = readState();
        writeStore({ ...good, grants: [{ ...good.grants[0], source: { ...good.grants[0].source, text_hash: 'f'.repeat(64) } }] });
        blocked('gh pr merge 5');
        writeStore({ ...good, grants: [{ ...good.grants[0], scope: 'push-main' }] });
        blocked('git push origin main');
        writeStore({ ...good, transcript: '/elsewhere.jsonl', grants: [{ ...good.grants[0], source: { ...good.grants[0].source, transcript: '/elsewhere.jsonl' } }] });
        blocked('gh pr merge 5');
        writeStore({ ...good, grants: [{ ...good.grants[0], source: { ...good.grants[0].source, issued_at: ts(3600e3) } }] });
        blocked('gh pr merge 5');
        writeStore({ ...good, grants: [{ ...good.grants[0], until: ts(-48 * 3600e3) }] });
        ok('gh pr merge 5'); // an extended `until` is clamped to the typed 2h, which has not run out yet
    });

    test('an expired grant is ignored, also when the store claims a later expiry', () => {
        const prompt = 'gogate grant merge 2h';
        runGrant(prompt);
        const st = readState();
        st.grants[0].source.issued_at = ts(3 * 3600e3);
        st.grants[0].until = ts(-3600e3);
        fs.writeFileSync(statePath(), JSON.stringify(st));
        add(human(prompt, { timestamp: ts(3 * 3600e3) }));
        add(human('x'));
        blocked('gh pr merge 5');
    });

    test('a session grant is bound to its session key', () => {
        typed('gogate grant merge session');
        add(human('x'));
        ok('gh pr merge 5');
        const st = readState();
        fs.writeFileSync(statePath('s2'), JSON.stringify(st));
        blocked('gh pr merge 5', { session: 's2' });
    });

    test('no standing grants: a config file grants nothing', () => {
        fs.mkdirSync(path.join(home, '.aos'), { recursive: true });
        fs.writeFileSync(path.join(home, '.aos', 'go-gate.json'), JSON.stringify({ mode: 'off', grants: [{ scope: 'merge', until: '2999-01-01T00:00:00Z' }] }));
        add(human('x'));
        blocked('gh pr merge 5');
        assert.equal(g.parseGogate('/bdb-aos-gogate grant merge 1000d').error !== undefined, true);
    });

    test('a loop or subagent may use an existing grant', () => {
        typed('gogate grant merge 1h');
        add(user('/loop check PRs', NONHUMAN.loop));
        add({ ...human('subagent prompt'), isSidechain: true });
        ok('gh pr merge 5');
    });
});

describe('GO <text>', () => {
    // H1 + H2: strict grammar, PR GO covers only gh pr merge|edit|close|review|comment for its numbers.
    test('GO with PR numbers covers only those gh pr commands; everything else needs a plain GO', () => {
        add(human('GO für #117 und #118'));
        ok('gh pr merge 117 --squash');
        ok('gh pr merge 118');
        ok('gh -R o/r pr merge 118');
        ok('gh pr merge https://github.com/o/r/pull/117');
        ok('gh pr comment 117 -b x');
        blocked('gh pr merge 119');
        blocked('gh pr merge'); // no number: fails closed
        blocked('gh pr merge 117 && gh pr merge 119');
        for (const c of ['git push origin feat/x', 'git push --force origin main', 'gh api -X PUT repos/o/r/pulls/118/merge', 'rm -rf build', 'npm publish', 'gh pr create -t x', 'gh pr merge 117 && git push --force origin main', 'gh pr merge 117; rm -rf /', "bash -c 'gh pr merge 117'"]) blocked(c);
        add(human('GO'));
        ok('git push --force origin main');
    });

    test('accepted PR GO spellings', () => {
        for (const t of ['GO #117', 'go #117', 'GO PR 117', 'GO PR #117', 'GO #117 #118', 'GO #117, #118', 'GO #117 und #118', 'GO for #117 and #118', 'GO für PR 117']) {
            assert.equal(g.parseGoText(t).ok, true, t);
        }
        assert.deepEqual(g.parseGoText('GO für #117 und #118').prs, [117, 118]);
        add(human('GO PR 117'));
        ok('gh pr comment 117 -b x');
        blocked('gh pr comment 5 -b x');
        add(human('  Go  '));
        ok('gh pr merge 5');
    });

    test('everything else is not a GO', () => {
        for (const t of ['go ahead', 'GO ahead and delete everything', 'go ahead and review #117, do NOT merge', "Go look at PR 117 but don't push", 'GO pr117', 'GO pr 117', 'GO #117 #*', 'GO #117 or #118', 'GO #117 and also #118', 'GO für alles #117', 'GO und #117', 'GO #117 und', 'GO worker-1', 'GO fix #117',
            'GO\n#117', 'GO #117\nand also push main', 'GO\r#117', 'GO\u2028#117', 'GO #117\u2028x', 'GO\u0085#117', 'GO\u0000', 'GO #117\u0000', 'GO\u0085', `GO #${'1'.repeat(5)} ${'x'.repeat(80)}`]) {
            assert.equal(g.parseGoText(t).ok, false, JSON.stringify(t));
        }
        for (const text of ['go ahead and review #117, do NOT merge', 'GO\u2028#117', 'GO pr117']) {
            add(human(text));
            blocked('gh pr merge 117');
            blocked('git push origin main');
        }
    });

    test('a forged session registry named like a PR does not lock out GO #117', () => {
        fs.mkdirSync(path.join(home, '.aos', 'bus', 'sessions'), { recursive: true });
        fs.writeFileSync(path.join(home, '.aos', 'bus', 'sessions', '117.json'), '{}');
        add(human('GO #117'));
        ok('gh pr merge 117');
    });

    test('GO <text> from a non-human origin never counts', () => {
        for (const extra of [NONHUMAN.loop, NONHUMAN.peer, NONHUMAN['task-notification']]) {
            add(user('GO #117', extra));
            blocked('gh pr merge 117');
        }
    });
});

describe('store protection', () => {
    test('Bash writes to the store are blocked, read-only access is not, even in off mode', () => {
        typed('gogate off');
        for (const c of ['echo {} > ~/.aos/gate/s1.json', 'tee ~/.aos/gate/s1.json', "sed -i '' s/hard/off/ ~/.aos/gate/s1.json", 'mv /tmp/x ~/.aos/gate/s1.json', 'cp x "$HOME/.aos/gate/s1.json"', 'rm ~/.aos/go/w.token', `node -e "require('fs').writeFileSync(process.env.HOME+'/.aos/gate/s1.json','{}')"`, 'cat ~/.aos/gate/s1.json > /tmp/x', 'cat $(echo ~/.aos/gate/s1.json)']) {
            assert.equal(runGate(c).status, 2, c);
        }
        for (const c of ['cat ~/.aos/gate/s1.json', 'ls -la ~/.aos/gate', 'grep mode ~/.aos/gate/s1.json | head -1', 'tail ~/.aos/gate/s1.log']) ok(c);
    });

    test('Write/Edit into the store is blocked by env-file-protection', () => {
        const run = (file_path) => spawnSync(process.execPath, [ENVP], { input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path } }), env: env(), encoding: 'utf8' });
        for (const p of [path.join(home, '.aos', 'gate', 's1.json'), path.join(home, '.aos', 'go', 'w.token'), '~/.aos/gate/new.json', path.join(home, '.aos', 'gate')]) assert.equal(run(p).status, 2, p);
        for (const p of [path.join(home, '.aos', 'bus', 'x.json'), path.join(home, 'notes', 'gate.md'), path.join(home, '.aos', 'gogate.md')]) assert.equal(run(p).status, 0, p);
    });

    test('a symlink into the store is resolved', () => {
        fs.mkdirSync(path.join(home, '.aos', 'gate'), { recursive: true });
        fs.symlinkSync(path.join(home, '.aos', 'gate'), path.join(home, 'innocent'));
        const r = spawnSync(process.execPath, [ENVP], { input: JSON.stringify({ tool_input: { file_path: path.join(home, 'innocent', 's1.json') } }), env: env(), encoding: 'utf8' });
        assert.equal(r.status, 2);
    });
});

describe('status', () => {
    test('status prompt injects the status as additionalContext', () => {
        typed('gogate grant push-feature,merge 30m');
        add(human('x'));
        const r = runGrant('/bdb-aos:gogate status');
        const ctx = JSON.parse(r.stdout).hookSpecificOutput;
        assert.equal(ctx.hookEventName, 'UserPromptSubmit');
        assert.match(ctx.additionalContext, /session s1: mode soft/);
        assert.match(ctx.additionalContext, /grant push-feature until/);
        assert.match(ctx.additionalContext, /grant merge until/);
    });

    test('status CLI without any state prints the default', () => {
        const r = spawnSync(process.execPath, [GRANT, '--status'], { env: env({ CLAUDE_SESSION_ID: '' }), encoding: 'utf8' });
        assert.equal(r.status, 0);
        assert.match(r.stdout, /soft mode with no grants/);
    });

    test('status shows off and hard', () => {
        typed('gogate off');
        assert.match(spawnSync(process.execPath, [GRANT, '--status', '--session', 's1'], { env: env(), encoding: 'utf8' }).stdout, /mode off/);
        typed('gogate hard');
        assert.match(spawnSync(process.execPath, [GRANT, '--status', '--session', 's1'], { env: env(), encoding: 'utf8' }).stdout, /mode hard/);
    });
});

describe('registration', () => {
    test('installer wires go-grant once (idempotent) and uninstall removes it', () => {
        const { mergeBdbSettingsHooks } = require('../installer.js');
        const p = path.join(home, 'settings.json');
        mergeBdbSettingsHooks(p);
        mergeBdbSettingsHooks(p);
        const s = JSON.parse(fs.readFileSync(p, 'utf8'));
        const cmds = s.hooks.UserPromptSubmit.flatMap((e) => e.hooks.map((h) => h.command));
        assert.equal(cmds.filter((c) => c.includes('go-grant.mjs')).length, 1);
        assert.equal(cmds.filter((c) => c.includes('go-token.mjs')).length, 1);
        const uninstall = fs.readFileSync(path.join(REPO, 'bin', 'aos-uninstall.mjs'), 'utf8');
        const list = /const bdb = \[([^\]]*)\]/.exec(uninstall)[1];
        for (const f of ['go-gate.mjs', 'go-token.mjs', 'go-grant.mjs']) assert.ok(list.includes(`'${f}'`), f);
    });
});
