// go-gate: local git add/commit without GO, and the `container-test` grant scope.
// Spec: production_artifacts/installer-v5/09_gate-container-test.md
// Fails until the gate change is implemented. Not listed in package.json on purpose.
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
    home = fs.mkdtempSync(path.join(BASE, 'aos-gct-'));
    work = path.join(home, 'projects', 'work');
    fs.mkdirSync(path.join(work, '.git'), { recursive: true });
    fs.writeFileSync(path.join(work, '.git', 'HEAD'), 'ref: refs/heads/feat/work\n');
    fs.writeFileSync(path.join(work, '.git', 'config'), '');
    for (const d of ['.claude', '.gemini', '.codex', '.aos']) fs.mkdirSync(path.join(home, d), { recursive: true });
    fs.symlinkSync(path.join(home, '.claude'), path.join(home, 'projects', 'linkclaude'));
    t = path.join(home, 'session.jsonl');
    fs.writeFileSync(t, '');
    n = 0;
    process.env.AOS_GATE_TEST_REALHOME = home;
    process.env.XDG_CONFIG_HOME = path.join(home, '.config');
    ctx = { cwd: work, blockTs: 0, home, realHome: home, claudeDir: path.join(home, '.claude') };
    g.setGateContext(ctx);
});

// {P} project dir (2 levels inside home), {H} home, {L} symlink in projects/ that points at ~/.claude
const fill = (s) => s.split('{P}').join(work).split('{H}').join(home).split('{L}').join(path.join(home, 'projects', 'linkclaude'));
const env = () => ({ ...process.env, HOME: home, XDG_DATA_HOME: '', AOS_SESSION_NAME: '', AOS_ACP_CLIENT: '', AOS_GATE_PROTECTED_BRANCHES: '' });
const ts = (agoMs = 0) => new Date(Date.now() - agoMs).toISOString();
const add = (e) => fs.appendFileSync(t, JSON.stringify(e) + '\n');
const user = (text, extra = {}) => ({ type: 'user', uuid: `u${++n}`, timestamp: ts(), message: { role: 'user', content: text }, ...extra });
const human = (text, extra = {}) => user(text, { origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human', ...extra });
const wrapper = (name, args) => user(`<command-name>/${name}</command-name>\n<command-message>${name}</command-message>\n<command-args>${args}</command-args>`);
const runGate = (command) => spawnSync(process.execPath, [GATE], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: fill(command) }, transcript_path: t, session_id: 's1', cwd: work }), env: env(), encoding: 'utf8',
});
const runGrant = (prompt) => spawnSync(process.execPath, [GRANT], { input: JSON.stringify({ prompt, transcript_path: t, session_id: 's1', hook_event_name: 'UserPromptSubmit' }), env: env(), encoding: 'utf8' });
const typed = (prompt) => { const r = runGrant(prompt); add(human(prompt)); return r; };
const ok = (c) => assert.equal(runGate(c).status, 0, `expected allowed: ${fill(c)}`);
const blocked = (c) => assert.equal(runGate(c).status, 2, `expected blocked: ${fill(c)}`);
const statePath = () => path.join(home, '.aos', 'gate', 's1.json');
const sc = (c) => { g.setGateContext(ctx); return g.commandScopes(fill(c)); };
const scopes = (c, want) => {
    const got = sc(c);
    assert.deepEqual(got && [...got].sort(), want && [...want].sort(), fill(c));
};

// Strings are assembled so the file holds no literal destructive or push command.
const PUSH = ['git', 'push', 'origin', 'feat:feat'].join(' '); // explicit src:dst, unprotected: push-feature
const RMRF = ['r' + 'm', '-r' + 'f', 'build'].join(' ');
const SAFE = "docker run --rm -v {P}:/src node:24 bash -c 'npm test'";
const CT = ['container-test'];

// ---------------------------------------------------------------------------
// Change 1: local git add / git commit never need a GO. A hook bypass still does.
// ---------------------------------------------------------------------------
describe('git add / git commit: no scope, no GO', () => {
    const allowed = [
        'git add .', 'git add -A', 'git add src/a.js src/b.js', 'git commit -m x', 'git commit -m "feat: x"', 'git commit -am x',
        'git commit --amend', 'git commit --amend --no-edit', 'git commit --allow-empty -m x', 'git commit -S -m x',
        'git -C {P} commit -m x', 'git -c user.name=x commit -m x',
        'git add . && git commit -m x', 'cd {P} && git add . && git commit -m "feat: x"',
        'git status && git add . && git commit -m x && git log --oneline',
        // reads of the hook config stay free
        'git config core.hooksPath', 'git config --get core.hooksPath',
    ];
    for (const c of allowed) test(`scopes [] : ${c}`, () => scopes(c, []));

    test('hook: allowed without GO and without grant', () => {
        add(human('please commit'));
        ok('git add .');
        ok('git commit -m "feat: x"');
        ok('git commit --amend --no-edit');
        ok('git add . && git commit -m "feat: x"');
    });

    const bypass = [
        ['--no-verify', 'git commit --no-verify -m x'],
        ['--no-verify last', 'git commit -m x --no-verify'],
        ['-n', 'git commit -n -m x'],
        ['-n bundled', 'git commit -nm x'],
        ['-n bundled with -a', 'git commit -anm x'],
        ['--no-verify abbreviation', 'git commit --no-ver -m x'],
        ['--no-gpg-sign', 'git commit --no-gpg-sign -m x'],
        ['-c core.hooksPath', 'git -c core.hooksPath=/dev/null commit -m x'],
        ['-c core.hooksPath attached', 'git -ccore.hooksPath=/dev/null commit -m x'],
        ['-c core.hooksPath case', 'git -c CORE.HOOKSPATH=/dev/null commit -m x'],
        ['-c core.hooksPath quoted', 'git -c "core.hooksPath=/dev/null" commit -m x'],
        ['--config-env core.hooksPath', 'git --config-env=core.hooksPath=HOOKDIR commit -m x'],
        ['-c commit.gpgsign=false', 'git -c commit.gpgsign=false commit -m x'],
        ['quoted flag', "git commit '--no-verify' -m x"],
        ['quoted subcommand', 'git "commit" --no-verify -m x'],
        ['flag from a variable', 'git commit $FLAGS -m x'],
        ['git env config', 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x'],
        ['persisted by git config', 'git config core.hooksPath /dev/null && git commit -m x'],
        ['inside bash -c', "bash -c 'git commit --no-verify -m x'"],
        ['inside sh -c double quotes', 'sh -c "git -c core.hooksPath=/dev/null commit -m x"'],
        ['after add', 'git add . && git commit --no-verify -m x'],
        ['wrapped in sudo/env', 'env X=1 git commit --no-verify -m x'],
    ];
    for (const [why, c] of bypass) test(`still guarded, never grantable (null): ${why}`, () => scopes(c, null));

    test('hook: a bypass needs a GO; a container-test grant does not help; GO does', () => {
        typed('gogate grant container-test 2h');
        add(human('commit please'));
        blocked('git commit --no-verify -m "feat: x"');
        blocked('git -c core.hooksPath=/dev/null commit -m "feat: x"');
        blocked('git commit --no-gpg-sign -m "feat: x"');
        add(human('GO'));
        ok('git commit --no-verify -m "feat: x"');
    });

    // Known limit of any text-based gate, recorded here on purpose and NOT asserted:
    // `git commit -m x $(echo --no-verify)` and flags read from a config file or alias.
});

// ---------------------------------------------------------------------------
// Change 2: scope container-test.
// ---------------------------------------------------------------------------
describe('scope list and grant parsing', () => {
    test('container-test is a scope; the six old ones are still there', () => {
        for (const s of ['push-feature', 'push-main', 'merge', 'publish', 'destructive', 'github-write', 'container-test']) assert.ok(g.SCOPES.includes(s), s);
    });
    test('gogate grant container-test parses; unknown scopes still fail', () => {
        assert.deepEqual(g.parseGogate('gogate grant container-test 2h'), { cmd: 'grant', scopes: ['container-test'], ms: 2 * 3600e3, session: false, form: 'plain' });
        assert.deepEqual(g.parseGogate('gogate grant container-test,destructive 15m').scopes, ['container-test', 'destructive']);
        assert.equal(g.parseGogate('gogate grant container-test session').session, true);
        assert.match(g.parseGogate('gogate grant container-tests 2h').error, /unknown scope/);
        assert.match(g.parseGogate('gogate grant container-test 25h').error, /24h/);
    });
});

describe('docker run: covered by container-test', () => {
    const covered = [
        ['writable project mount, bash -c', SAFE],
        ['explicit :rw on the project', 'docker run --rm -v {P}:/src:rw node:24 npm test'],
        ['--volume spellings', 'docker run --rm --volume {P}:/src node:24 npm test'],
        ['--volume=', 'docker run --rm --volume={P}:/src node:24 npm test'],
        ['no mount at all', "docker run --rm node:24 node -e 'console.log(1)'"],
        ['listed value flags', 'docker run --rm -i -t --init --name t1 --platform linux/amd64 --memory 2g --cpus 2 -u 1000 -w /src -e CI=1 -v {P}:/src node:24 node --test'],
        ['--network none', 'docker run --rm --network none -v {P}:/src node:24 npm test'],
        ['--network=bridge', 'docker run --rm --network=bridge -v {P}:/src node:24 npm test'],
        ['--net bridge', 'docker run --rm --net bridge -v {P}:/src node:24 npm test'],
        ['docker container run', 'docker container run --rm -v {P}:/src node:24 npm test'],
        ['redirect and plain readers', 'docker run --rm -v {P}:/src node:24 npm test 2>&1 | tail -20'],
        ['arguments after the image belong to the container', 'docker run --rm -v {P}:/src node:24 npm test -- --privileged'],
        ['after the image, a -v is a container argument', 'docker run --rm node:24 npm test -v /var/run/docker.sock:/s'],
    ];
    for (const [why, c] of covered) test(`[container-test]: ${why}`, () => scopes(c, CT));
    // Rule 16 (Tim): a run with only read-only project mounts stays free, exactly as before this scope existed.
    test('read-only project mount stays unguarded (rule 16)', () => scopes('docker run --rm -v {P}:/src:ro node:24 npm test', []));

    test('hook: no grant -> GO needed; GO lifts it', () => {
        add(human('run the tests'));
        blocked(SAFE);
        add(human('GO'));
        ok(SAFE);
    });
    test('hook: an active container-test grant allows every covered run', () => {
        typed('gogate grant container-test 2h');
        add(human('run the tests'));
        for (const [, c] of covered) ok(c);
    });
});

describe('docker run: never covered (null = plain GO only)', () => {
    const SOCK = '/var/run/docker.sock';
    const denied = [
        ['no --rm', 'docker run -v {P}:/src node:24 npm test'],
        ['--rm=false', 'docker run --rm=false -v {P}:/src node:24 npm test'],
        ['--privileged', 'docker run --rm --privileged -v {P}:/src node:24 npm test'],
        ['--privileged=true', 'docker run --rm --privileged=true -v {P}:/src node:24 npm test'],
        ['--pid=host', 'docker run --rm --pid=host node:24 npm test'],
        ['--pid host', 'docker run --rm --pid host node:24 npm test'],
        ['--pid=container:x', 'docker run --rm --pid=container:x node:24 npm test'],
        ['--network host', 'docker run --rm --network host node:24 npm test'],
        ['--network=host', 'docker run --rm --network=host node:24 npm test'],
        ['--net host', 'docker run --rm --net host node:24 npm test'],
        ['--net=host', 'docker run --rm --net=host node:24 npm test'],
        ['--network container:x', 'docker run --rm --network container:x node:24 npm test'],
        ['--ipc host', 'docker run --rm --ipc host node:24 npm test'],
        ['--userns host', 'docker run --rm --userns host node:24 npm test'],
        ['docker.sock -v', `docker run --rm -v ${SOCK}:${SOCK} node:24 npm test`],
        ['docker.sock --volume=', `docker run --rm --volume=${SOCK}:${SOCK} node:24 npm test`],
        ['docker.sock read-only', `docker run --rm -v ${SOCK}:/s:ro node:24 npm test`],
        ['docker.sock via --mount', `docker run --rm --mount type=bind,source=${SOCK},target=${SOCK} node:24 npm test`],
        ['--mount, even a harmless one', 'docker run --rm --mount type=bind,source={P},target=/src node:24 npm test'],
        ['--mount=', 'docker run --rm --mount=type=bind,source={P},target=/src node:24 npm test'],
        ['--volumes-from', 'docker run --rm --volumes-from other node:24 npm test'],
        ['--cap-add', 'docker run --rm --cap-add SYS_ADMIN node:24 npm test'],
        ['--cap-add=ALL', 'docker run --rm --cap-add=ALL node:24 npm test'],
        ['--device', 'docker run --rm --device /dev/sda node:24 npm test'],
        ['--security-opt', 'docker run --rm --security-opt seccomp=unconfined node:24 npm test'],
        ['--security-opt=', 'docker run --rm --security-opt=apparmor=unconfined node:24 npm test'],
        ['bundled short flags', 'docker run --rm -itv {P}:/src node:24 npm test'],
        ['attached -v value', 'docker run --rm -v{P}:/src node:24 npm test'],
        // writable mounts of the agent config dirs and of home
        ['~/.claude', 'docker run --rm -v {H}/.claude:/c node:24 npm test'],
        ['~/.claude :rw', 'docker run --rm -v {H}/.claude:/c:rw node:24 npm test'],
        ['~/.claude --volume', 'docker run --rm --volume {H}/.claude:/c node:24 npm test'],
        ['~/.gemini', 'docker run --rm -v {H}/.gemini:/c node:24 npm test'],
        ['~/.codex', 'docker run --rm -v {H}/.codex:/c node:24 npm test'],
        ['~/.aos', 'docker run --rm -v {H}/.aos:/c node:24 npm test'],
        ['~/.aos/gate', 'docker run --rm -v {H}/.aos/gate:/c node:24 npm test'],
        ['home itself', 'docker run --rm -v {H}:/h node:24 npm test'],
        ['home itself :rw', 'docker run --rm -v {H}:/h:rw node:24 npm test'],
        ['home, trailing slash', 'docker run --rm -v {H}/:/h node:24 npm test'],
        ['/ itself', 'docker run --rm -v /:/host node:24 npm test'],
        ['double slash and dot spelling', 'docker run --rm -v {H}//./.claude:/c node:24 npm test'],
        ['dot-dot spelling', 'docker run --rm -v {P}/../../.claude:/c node:24 npm test'],
        ['symlink to ~/.claude', 'docker run --rm -v {L}:/c node:24 npm test'],
        ['~ spelling', 'docker run --rm -v ~/.claude:/c node:24 npm test'],
        ['$HOME spelling', 'docker run --rm -v $HOME/.claude:/c node:24 npm test'],
        ['quoted $HOME spelling', 'docker run --rm -v "$HOME/.claude":/c node:24 npm test'],
        ['${HOME} spelling', 'docker run --rm -v ${HOME}/.claude:/c node:24 npm test'],
        // expansion before the image can become any flag
        ['variable as flags', 'docker run --rm $FLAGS -v {P}:/src node:24 npm test'],
        ['variable as image', 'docker run --rm -v {P}:/src "$IMG" npm test'],
        ['variable in a flag value', 'docker run --rm -e KEY=$SECRET -v {P}:/src node:24 npm test'],
        ['variable in a mount', 'docker run --rm -v $PWD:/src node:24 npm test'],
        ['$(...) as flags', 'docker run --rm $(echo --privileged) node:24 true'],
        ['$(...) in a mount', 'docker run --rm -v "$(pwd)":/src node:24 npm test'],
        ['backticks as flags', 'docker run --rm `echo --privileged` node:24 true'],
        ['$(...) inside a flag value', 'docker run --rm -e "X=$(id)" node:24 true'],
        // another daemon
        ['-H', 'docker -H tcp://127.0.0.1:2375 run --rm node:24 true'],
        ['--host=', 'docker --host=unix:///tmp/x.sock run --rm node:24 true'],
        ['--context', 'docker --context other run --rm node:24 true'],
        ['DOCKER_HOST prefix', 'DOCKER_HOST=tcp://127.0.0.1:2375 docker run --rm node:24 true'],
        ['env DOCKER_HOST', 'env DOCKER_HOST=tcp://127.0.0.1:2375 docker run --rm node:24 true'],
        // the command run INSIDE the container is still read for guarded words
        ['push inside the container', "docker run --rm -v {P}:/src node:24 bash -c 'git push origin main'"],
        ['publish inside the container', 'docker run --rm -v {P}:/src node:24 npm publish'],
        ['gh write inside the container', "docker run --rm -v {P}:/src node:24 sh -c 'gh pr merge 5'"],
    ];
    for (const [why, c] of denied) test(`null: ${why}`, () => scopes(c, null));

    // Stricter than the approved text (see spec, "Stricter than approved"); relax here if Tim wants.
    describe('stricter than approved', () => {
        const strict = [
            ['read-only ~/.claude', 'docker run --rm -v {H}/.claude:/c:ro node:24 npm test'],
            ['read-only home', 'docker run --rm -v {H}:/h:ro node:24 npm test'],
            ['a top-level dir of home (depth 1)', 'docker run --rm -v {H}/projects:/p node:24 npm test'],
            ['publish port', 'docker run --rm -p 8080:80 -v {P}:/src node:24 npm test'],
            ['mount of a path that does not exist', 'docker run --rm -v {H}/projects/missing:/src node:24 npm test'],
        ];
        for (const [why, c] of strict) test(`null: ${why}`, () => scopes(c, null));
    });
});

describe('docker: everything else unchanged', () => {
    for (const c of ['docker ps', 'docker images', 'docker build -t x .', 'docker exec x ls', 'docker compose up -d', 'docker logs x', 'docker pull node:24', 'git status', 'ls -la'])
        test(`scopes [] : ${c}`, () => scopes(c, []));
    test('rule 16 (isReadOnlyDockerRun) is untouched', () => {
        assert.equal(g.isReadOnlyDockerRun(fill('docker run --rm -v {P}:/src:ro node:24 npm test')), true);
        assert.equal(g.isReadOnlyDockerRun(fill('docker run --rm -v {P}:/src node:24 npm test')), false, 'writable mount');
        assert.equal(g.isReadOnlyDockerRun(fill('docker run --rm --privileged -v {P}:/src:ro node:24 npm test')), false);
    });
});

// ---------------------------------------------------------------------------
// Combined commands: every guarded part needs its own scope.
// ---------------------------------------------------------------------------
describe('combined commands', () => {
    test('scopes', () => {
        scopes('git add . && git commit -m x', []);
        scopes(`git commit -m x && ${PUSH}`, ['push-feature']);
        scopes(`${SAFE}; ${RMRF}`, ['container-test', 'destructive']);
        scopes(`${SAFE} && ${PUSH}`, ['container-test', 'push-feature']);
        scopes(`${RMRF} && ${SAFE}`, ['container-test', 'destructive']);
        scopes(`git add . && ${SAFE}`, CT);
        scopes(`${SAFE} && git commit -m x`, CT);
        scopes(`docker run --rm --privileged node:24 true; ${RMRF}`, null);
        scopes(`git commit --no-verify -m x && ${SAFE}`, null);
    });

    test('hook with container-test only: git add + commit is free, the rest is not covered', () => {
        typed('gogate grant container-test 2h');
        add(human('go on'));
        ok('git add . && git commit -m "feat: x"');
        ok(`git add . && ${SAFE}`);
        blocked(`git commit -m "feat: x" && ${PUSH}`);
        blocked(`${SAFE} && ${PUSH}`);
        blocked(`${SAFE}; ${RMRF}`);
        blocked(`${RMRF}; ${SAFE}`);
        blocked(`docker run --rm --privileged node:24 true; ${RMRF}`);
        blocked(`docker run --rm -v {H}/.claude:/c node:24 true && ${PUSH}`);
    });

    test('hook with container-test plus the other scopes: all parts must be covered', () => {
        typed('gogate grant container-test,push-feature 2h');
        add(human('go on'));
        ok(`${SAFE} && ${PUSH}`);
        blocked(`${SAFE}; ${RMRF}`);
        typed('gogate grant destructive 2h');
        add(human('go on'));
        ok(`${SAFE}; ${RMRF}`);
    });
});

// ---------------------------------------------------------------------------
// Grant semantics at the hook.
// ---------------------------------------------------------------------------
describe('container-test grant semantics', () => {
    test('active grant: covered run allowed; never push, merge, publish, destructive, github-write', () => {
        typed('gogate grant container-test 2h');
        add(human('go on'));
        ok(SAFE);
        ok(`${SAFE} 2>&1 | tail -5`);
        blocked(PUSH);
        blocked('git push origin main');
        blocked('git push --force origin feat:feat');
        blocked('gh pr merge 5');
        blocked('npm publish');
        blocked('npm version patch');
        blocked(RMRF);
        blocked('gh issue create -t x -b y');
        blocked('gh release create v1.0.0');
        blocked('git reset --hard HEAD~1');
    });

    test('active grant: unsafe docker runs are still blocked', () => {
        typed('gogate grant container-test 2h');
        add(human('go on'));
        for (const c of [
            'docker run --rm --privileged node:24 true', 'docker run --rm --pid=host node:24 true', 'docker run --rm --network host node:24 true',
            'docker run --rm --net host node:24 true', 'docker run --rm -v /var/run/docker.sock:/var/run/docker.sock node:24 true',
            'docker run --rm -v {H}/.claude:/c node:24 true', 'docker run --rm -v {H}/.aos:/c:rw node:24 true', 'docker run --rm -v {H}:/h node:24 true',
            'docker run --rm --mount type=bind,source={P},target=/src node:24 true', 'docker run --rm --volumes-from x node:24 true',
            'docker run --rm --cap-add ALL node:24 true', 'docker run --rm $FLAGS node:24 true', 'docker run -v {P}:/src node:24 true',
        ]) blocked(c);
    });

    test('no grant: the same covered run needs GO', () => {
        add(human('run the tests'));
        blocked(SAFE);
    });

    test('a grant of another scope does not cover a docker run', () => {
        for (const s of ['push-feature', 'push-main', 'merge', 'publish', 'destructive', 'github-write']) {
            typed(`gogate grant ${s} 2h`);
            add(human('go on'));
            blocked(SAFE);
        }
    });

    test('an expired container-test grant covers nothing', () => {
        const prompt = 'gogate grant container-test 15m';
        runGrant(prompt);
        const st = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
        st.grants[0].source.issued_at = ts(3600e3);
        fs.writeFileSync(statePath(), JSON.stringify(st));
        add(human(prompt, { timestamp: ts(3600e3) }));
        add(human('go on'));
        blocked(SAFE);
    });

    test('the slash form is ignored', () => {
        runGrant('/bdb-aos:gogate grant container-test 2h');
        add(wrapper('bdb-aos:gogate', 'grant container-test 2h'));
        add(human('go on'));
        blocked(SAFE);
    });

    test('a grant not typed by a human (loop prompt) is ignored', () => {
        const prompt = 'gogate grant container-test 2h';
        runGrant(prompt);
        add(user(prompt, { promptSource: 'system', isMeta: true, turnOrigin: 'system' }));
        add(human('go on'));
        blocked(SAFE);
    });

    test('hard revokes a grant; soft does not bring it back; a new grant works', () => {
        typed('gogate grant container-test 2h');
        add(human('go on'));
        ok(SAFE);
        typed('gogate hard');
        blocked(SAFE);
        typed('gogate soft');
        blocked(SAFE);
        typed('gogate grant container-test 2h');
        add(human('go on'));
        ok(SAFE);
    });

    test('a block earlier in the session (cooldown marker) does not stop a covered run', () => {
        typed('gogate grant container-test 2h');
        add(human('go on'));
        blocked(PUSH);
        ok(SAFE);
    });

    test('a plain GO still lifts any docker run, covered or not', () => {
        add(human('GO'));
        ok(SAFE);
        ok('docker run --rm --privileged node:24 true');
    });
});

// V31 bug (acp, 2026-10-07): a container-test grant covered ONE docker run and the next one was blocked with an empty scope
// list, because `docker run ... npm test` made the gate read the project's test scripts as if the HOST ran them
// (a test file containing a delete = unscoped = GO only). A qualifying docker run keeps container scripts out of that analysis.
// V31 bug 2 (acp, 2026-10-07): under machine load the wall-clock analysis budget (150 ms) overran on the first look at an
// ordinary command, which then counted as unscoped; the second look was cached and fast, so the log showed scopes=[].
// The budget now counts CPU time, so a stalled process (a loaded machine) no longer changes the verdict.
describe('analysis budget counts CPU time, not the wall clock', () => {
    test('a 400 ms stall in the middle of the analysis does not make a covered docker run unscoped', () => {
        const f = path.join(work, 'x');
        fs.mkdirSync(f, { recursive: true });
        const realNow = Date.now;
        let n = 0, off = 0;
        Date.now = () => { if (++n === 3) off = 400; return realNow() + off; };
        try { scopes(`docker run --rm -v {P}:/src -w /src node:24 bash -c 'npm test'`, CT); } finally { Date.now = realNow; }
    });
    test('a zero budget still makes everything unscoped (fail closed)', () => {
        g.setGateContext({ ...ctx, budgetMs: -1 });
        try { assert.equal(g.commandScopes(fill(`docker run --rm -v {P}:/src node:24 bash -c 'npm test'`)), null); } finally { g.setGateContext(ctx); }
    });
});

describe('docker run: the container runs scripts, the host analysis does not read them', () => {
    const put = (rel, body, root = work) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); return f; };
    const DEL = ['r' + 'mSync', '("build", { recursive: true })'].join('');
    const seed = (root = work) => {
        put('package.json', JSON.stringify({ scripts: { test: 'node --test tests/evil.test.js' } }), root);
        put('tests/evil.test.js', `require('node:fs').${DEL};\n`, root);
        put('scripts/check.sh', 'echo ok\n', root);
    };
    const RUN = (p = '{P}') => `docker run --rm -v ${p}:/src -w /src node:24 bash -c 'npm test'`;
    const FULL = (p = '{P}') => `docker run --rm -v ${p}:/src -w /src -e AOS_TEST_SANDBOX=container node:24-bookworm bash -c 'mkdir -p /w && cd /src && npm ci --ignore-scripts 2>&1 | tail -2 && npm test 2>&1; echo "exit $?"' > ${p}/out.log 2>&1; tail -1 ${p}/out.log; grep -n "^x" ${p}/out.log | head`;

    test('npm test with a deleting test file is still container-test', () => { seed(); scopes(RUN(), CT); });
    test('the full chain (redirect, ; tail, grep | head) is container-test', () => { seed(); scopes(FULL(), CT); });
    test('the same covered run twice under one grant: both allowed', () => {
        seed();
        typed('gogate grant container-test 2h');
        add(human('go on'));
        ok(FULL());
        ok(FULL());
    });
    test('a second worktree mount is covered the same way', () => {
        const work2 = path.join(home, 'projects', 'work2');
        fs.mkdirSync(path.join(work2, '.git'), { recursive: true });
        seed(work2);
        typed('gogate grant container-test 2h');
        add(human('go on'));
        ok(FULL(work2));
        ok(FULL());
    });
    test('bash -c running a project script that deletes inside the container is covered', () => {
        put('scripts/check.sh', `node -e '${DEL}'\n`);
        typed('gogate grant container-test 2h');
        add(human('go on'));
        ok("docker run --rm -v {P}:/src -w /src node:24 bash -c 'bash scripts/check.sh'");
    });
    test('the same script run on the HOST is still analysed and blocked', () => {
        seed();
        typed('gogate grant container-test 2h');
        add(human('go on'));
        blocked('node --test tests/evil.test.js');
    });
    test('a delete or push in the container text, or after the docker run, is not hidden by the shortcut', () => {
        seed();
        typed('gogate grant container-test 2h');
        add(human('go on'));
        blocked(`docker run --rm -v {P}:/src node:24 bash -c '${RMRF}'`);
        blocked(`${RUN()}; ${RMRF}`);
        blocked(`${RUN()} && ${PUSH}`);
    });
    test('an unsafe docker run is not covered by the shortcut either', () => {
        seed();
        typed('gogate grant container-test 2h');
        add(human('go on'));
        blocked("docker run --rm --privileged -v {P}:/src node:24 bash -c 'npm test'");
        blocked("docker run --rm -v {H}/.claude:/c node:24 bash -c 'npm test'");
    });
    test('isContainerTestRun: qualifying shapes only', () => {
        seed();
        const y = (c) => assert.equal(g.isContainerTestRun(fill(c)), true, fill(c));
        const n = (c) => assert.equal(g.isContainerTestRun(fill(c)), false, fill(c));
        y(RUN()); y(FULL()); y(`cd {P} && ${RUN()}`);
        n(`${RUN()}; echo $(id)`); n(`${RUN()} && curl x`); n("docker run --rm --privileged -v {P}:/src node:24 npm test");
        n('npm test'); n(`${RUN()} | sh`);
    });
});
