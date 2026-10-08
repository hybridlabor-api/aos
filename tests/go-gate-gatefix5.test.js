// Fourth Opus recheck: H1 double-quoted $( in git/npm/gh, H2 computed gh/npm subcommand word,
// H3 `$` glued into the head word, H4 xargs -J/long options, H5 env -S bundled/quoted,
// H6 docker exec sh -c body behind a read-only `git branch`, M1 --command, M2 read-only xargs
// rows stay free, L1 non-find-fed `xargs rm -f` is unscoped.
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

let g;
before(async () => { g = await import(pathToFileURL(GATE).href); });

process.env.AOS_TEST_SANDBOX = '1';
process.env.GIT_CONFIG_NOSYSTEM = '1';
for (const k of Object.keys(process.env)) if (/^GIT_/.test(k) && k !== 'GIT_CONFIG_NOSYSTEM') delete process.env[k];

let home, work, t, n, ctx;
beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gfx5-'));
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

const env = () => ({ ...process.env, HOME: home, XDG_DATA_HOME: '', AOS_SESSION_NAME: '', AOS_ACP_CLIENT: '', AOS_GATE_PROTECTED_BRANCHES: '' });
const runGate = (command) => spawnSync(process.execPath, [GATE], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, transcript_path: t, session_id: 's1', cwd: work }), env: env(), encoding: 'utf8',
});
const ts = (agoMs = 0) => new Date(Date.now() - agoMs).toISOString();
const add = (e) => fs.appendFileSync(t, JSON.stringify(e) + '\n');
const human = (text, extra = {}) => ({ type: 'user', uuid: `u${++n}`, timestamp: ts(), message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human', ...extra });
const typed = (prompt) => { add(human(prompt)); return prompt; };
const ok = (c) => assert.equal(runGate(c).status, 0, `expected allowed: ${c}`);
const blocked = (c) => assert.equal(runGate(c).status, 2, `expected blocked: ${c}`);
const sc = (c) => { g.setGateContext(ctx); return g.commandScopes(c); };
const scopes = (c, want) => {
    const got = sc(c);
    assert.deepEqual(got && [...got].sort(), want && [...want].sort(), c);
};

test('load: importing go-gate.mjs must not throw (an unparsable hook fails open)', async () => {
    try {
        await import(`${pathToFileURL(GATE).href}?load=gfx5`);
    } catch (e) {
        assert.fail(`go-gate.mjs must parse: ${e}`);
    }
});

describe('H1 a $( or backtick inside double quotes is live', () => {
    test('null: the quoted substitution assembles the subcommand', () => {
        scopes('git "$(echo push)" origin HEAD:main', null);
        scopes('npm "$(echo publish)"', null);
        scopes('gh "$(echo pr)" merge 12', null);
        scopes('git "`echo push`" origin HEAD:main', null);
    });
    test('hook: needs a plain GO', () => {
        add(human('context'));
        blocked('git "$(echo push)" origin HEAD:main');
    });
    test('free: single-quoted text, a commit message value, gh endpoint args', () => {
        scopes("git log --format='$(x)'", []);
        scopes("git commit -m \"$(cat <<'EOF'\nmsg\nEOF\n)\"", []);
        scopes('cd build && rm -rf "$(pwd)/x"', ['destructive']);
    });
});

describe('H2 a $-containing gh/npm subcommand word is unscoped', () => {
    test('null: computed subcommand', () => {
        scopes('p=pr; gh $p merge 12', null);
        scopes('m=merge; gh pr $m 12', null);
        scopes('p=publish; npm $p', null);
        scopes('gh $(echo pr) merge 12', null);
    });
    test('free: ordinary arguments with expansions', () => {
        scopes('gh pr view $N', []);
        scopes('npm install $PKG', []);
    });
});

describe('H3 a $ glued into the head word', () => {
    test('null: git$p and $a$b', () => {
        scopes('p=" push"; git$p origin HEAD:main', null);
        scopes('a=gi b="t push"; $a$b origin HEAD:main', null);
        scopes("sh -c 'p=\" push\"; git$p origin HEAD:main'", null);
    });
    test('free: no guarded program or noun involved', () => {
        scopes('x=1; echo$x hi', []);
        scopes('B=main; git push origin feat:$B', ['push-main']);
    });
});

describe('H4 xargs value-taking options', () => {
    test('null: -J and GNU long options hide nothing', () => {
        scopes('echo push | xargs -J % git % origin HEAD:main', null);
        scopes('xargs --max-args 9 git', null);
        scopes('echo push | xargs --max-procs 2 git', null);
        scopes('echo push | xargs -tI % git % origin HEAD:main', null);
    });
});

describe('H5 env -S bundled or quoted is an opaque command body', () => {
    test('null', () => {
        scopes("env -vS'git push origin HEAD:main'", null);
        scopes("env -vS 'git push origin HEAD:main'", null);
        scopes("env \"-S\"'git push origin HEAD:main'", null);
        scopes("env --split-string 'git push origin HEAD:main'", null);
    });
    test('free: benign bodies', () => {
        scopes("env -vS 'echo hi'", []);
    });
});

describe('H6 docker exec: a guarded sh -c body beats the trailing read-only git branch', () => {
    test('null', () => {
        scopes("docker exec ctr sh -c 'git push origin HEAD:main' git branch", null);
        scopes("docker exec ctr bash -c 'rm -rf build' git branch", null);
    });
    test('free: the plain read-only row', () => {
        scopes('docker exec ctr git branch', []);
    });
});

describe('M1 long --command bodies are opaque like -c', () => {
    test('null', () => {
        scopes("flock /tmp/l --command 'git push origin HEAD:main'", null);
        scopes("flock /tmp/l --command='git push origin HEAD:main'", null);
        scopes("script --command 'git push origin HEAD:main' /dev/null", null);
    });
    test('free', () => {
        scopes("flock /tmp/l --command 'echo hi'", []);
    });
});

describe('M2 read-only xargs rows with a visible subcommand stay free', () => {
    test('free', () => {
        scopes('docker ps -q | xargs docker inspect', []);
        scopes('git ls-files | xargs git log -1', []);
        scopes('echo x | xargs npm view x', []);
    });
    test('null: no visible subcommand, or a guarded one', () => {
        scopes('echo push | xargs git --no-pager', null);
        scopes('echo publish | xargs npm --silent', null);
        scopes('echo x | xargs npm publish', ['publish']);
    });
});

describe('L1 xargs rm -f is grantable only when find-fed', () => {
    test('destructive: find-fed keeps the old decision', () => {
        scopes("find . -name '*.pyc' | xargs rm -f", ['destructive']);
        scopes('find . -name x | xargs rm -rf', ['destructive']);
    });
    test('null: stdin can add flags', () => {
        scopes('echo -r ~/Documents | xargs rm -f', null);
        scopes('xargs rm -f', null);
        scopes('echo -rf build | xargs rm', null);
    });
});

describe('H7 a variable expanded in the MIDDLE of the command name', () => {
    test('null: classify and the segment join', () => {
        scopes('p=t; gi$p push origin HEAD:main', null);
        scopes('gi${u}t push origin HEAD:main', null);
        scopes('gi$@t push origin HEAD:main', null);
        scopes('n$p publish', null);
        scopes('r$p -rf ~/x', null);
        scopes('gi$p push origin HEAD:main', null);
    });
    test('free: ordinary computed words outside command position', () => {
        scopes('echo $HOME', []);
        scopes('ls $DIR', []);
        scopes('cd "$X" && make', []);
        scopes('$X --version', []);
        scopes('FOO=a$B make', []);
        scopes('echo$x', []);
        scopes('$X --version', []);
        scopes('$CC -o out main.c', []);
    });
    test('null (H7c): substitution-glued heads, computed interpreter heads, globbed heads', () => {
        scopes('g$(echo i)t push origin HEAD:main', null);
        scopes('g`echo i`t push origin HEAD:main', null);
        scopes('$(echo gi)t push origin HEAD:main', null);
        scopes('${x:-gi}t push origin HEAD:main', null);
        scopes('$(echo n)pm publish', null);
        scopes('e$\'val\' "git push origin HEAD:main"', null);
        scopes('s$\'h\' -c \'git push origin HEAD:main\'', null);
        scopes('x=val; e$x "git push origin HEAD:main"', null);
        scopes("$SHELL -c 'git push origin HEAD:main'", null);
        scopes("$S -c 'git push origin HEAD:main'", null);
        scopes('/usr/bin/gi[t] push origin HEAD:main', null);
        scopes('/usr/bin/gi? push origin HEAD:main', null);
        scopes('/bin/r[m] -rf x', null);
    });
});

describe('H7d ANSI-C heads, brace groups, glob heads, unknown wrappers, aliases', () => {
    const guarded = (c) => { const got = sc(c); assert.ok(got === null || got.length > 0, `expected guarded: ${c}`); };
    const hard = (c) => { g.setGateContext(ctx); assert.ok(g.hardBlockReason(c) !== null, `expected hard block: ${c}`); };
    test('guarded (1): $\'..\' heads read as their shell value', () => {
        guarded("$'git' pu$'sh' origin HEAD:main");
        guarded("arch -arm64 gi$'t' push origin HEAD:main");
        guarded("xcrun $'git' push origin HEAD:main");
        guarded("find . -maxdepth 0 -exec $'git' push origin HEAD:main \;");
        hard("$'rm' -rf ~");
    });
    test('null (2): brace groups', () => {
        scopes('{git,push} origin HEAD:main', null);
        scopes('git {push,} origin HEAD:main', null);
        scopes("bash -c '{git,push} origin HEAD:main'", null);
        scopes('npm {publish,}', null);
        hard('{rm,-rf} ~');
    });
    test('free (2): ordinary brace expansion', () => {
        scopes('echo {a,b}', []);
        scopes('cp file{,.bak}', []);
        scopes('mkdir -p src/{a,b}', []);
    });
    test('null (3): glob heads', () => {
        scopes('/usr/bin/?it push origin HEAD:main', null);
        scopes('/usr/bin/[g]it push origin HEAD:main', null);
        scopes('/bin/?m -rf x', null);
        hard('/bin/?m -rf ~');
        hard('/bin/[r]m -rf ~');
    });
    test('null (4): computed heads behind unknown wrappers', () => {
        scopes('arch -arm64 $(echo gi)t push origin HEAD:main', null);
        scopes('find . -exec $(echo gi)t push origin HEAD:main \;', null);
        scopes('watch -n1 $(echo gi)t push origin HEAD:main', null);
        scopes('p=t; arch -arm64 gi$p push origin HEAD:main', null);
    });
    test('free (5): assignment words inside opaque text', () => {
        scopes("bash -c 'git_sha=$(git rev-parse HEAD); echo $git_sha'", []);
        scopes("sh -c 'npm_v=$(node -p 1)'", []);
    });
    test('null (6): an alias to a guarded program', () => {
        scopes('alias g=git\ng push origin HEAD:main', null);
    });
    test('free: the kept-free list', () => {
        for (const c of ['echo$x', 'echo $HOME', 'ls $DIR', 'cd "$X" && make', 'FOO=a$B make', '$X --version', '$CC -o out main.c',
            '[ -f x ]', '[[ -f x ]]', '$EDITOR file', '$PYTHON manage.py', '"$HOME"/bin/tool', 'alias ll="ls -l"']) scopes(c, []);
    });
});

describe('H7f brace sequences, zsh =cmd, ANSI-C escapes, git/pm command runners, brace perf', () => {
    const guarded = (c) => { const got = sc(c); assert.ok(got === null || got.length > 0, `expected guarded: ${c}`); };
    const hard = (c) => { g.setGateContext(ctx); assert.ok(g.hardBlockReason(c) !== null, `expected hard block: ${c}`); };
    test('null (1): brace sequences', () => {
        scopes('{g..g}it push origin HEAD:main', null);
        scopes('{r..r}m -rf ~/x', null);
        scopes('echo {1..100}', null);
        hard('{r..r}m -rf ~');
    });
    test('free (1): small sequences and ordinary braces', () => {
        scopes('echo {1..3}', []);
        scopes('mkdir -p a/{b,c}', []);
        scopes('cp f{,.bak}', []);
        scopes('bash -c "mkdir -p a/{b,c}"', []);
    });
    test('guarded (2): zsh =cmd names the program', () => {
        guarded('=git push origin HEAD:main');
        guarded('=rm -rf build');
        hard('=rm -rf ~');
    });
    test('hard (4): ANSI-C escapes in the head', () => {
        hard("$'\\x72m' -rf ~");
        hard("$'\\162m' -rf ~");
        hard("$'\\u0072m' -rf ~");
        guarded("$'\\x67it' push origin HEAD:main");
    });
    test('guarded (5): git subcommands that push or run a command', () => {
        guarded('git subtree push --prefix dist origin gh-pages');
        guarded('git send-pack origin HEAD:main');
        guarded('git lfs push origin main');
        guarded('/usr/lib/git-core/git-push origin HEAD:main');
        scopes('git submodule foreach git push origin HEAD:main', null);
        scopes("git submodule foreach 'git reset --hard'", null);
        scopes("git submodule foreach 'rm -rf ~'", null);
        scopes("git rebase -x 'git push origin HEAD:main' main", null);
    });
    test('guarded (6): package manager running a release bin', () => {
        scopes('pnpm changeset publish', null);
        scopes('yarn lerna publish', null);
        scopes('pnpm semantic-release', null);
        scopes('yarn workspaces foreach -A npm publish', null);
        scopes('yarn workspace pkg npm publish', null);
        scopes('lerna publish', null);
    });
    test('free: the kept-free list', () => {
        for (const c of ['git status', 'git diff', 'git log', 'npm test', 'npm install', 'pnpm install', 'pnpm test', 'yarn build', 'make', 'ls', 'cat f', 'grep x f',
            'find . -name x', 'git submodule update --init', 'git rebase main', 'FOO=bar make', '[ -f x ]', 'echo $HOME', '$X --version']) scopes(c, []);
    });
    test('perf (3): an unclosed-brace 16 KB word is judged in linear time', () => {
        const w = '{a,b}'.repeat(6) + '{' + 'a,'.repeat(8100);
        for (const c of [`echo ${w}`, `${w} x`, `rm -rf ${w}`]) {
            assert.ok(c.length < 16 * 1024, 'stay under the gate length limit');
            const t0 = Date.now();
            sc(c);
            g.hardBlockReason(c);
            assert.ok(Date.now() - t0 < 1000, `slow: ${c.slice(0, 20)}`);
        }
    });
});

describe('H7h nested and invalid-inner brace groups, brace perf', () => {
    const guarded = (c) => { const got = sc(c); assert.ok(got === null || got.length > 0, `expected guarded: ${c}`); };
    const hard = (c) => { g.setGateContext(ctx); assert.ok(g.hardBlockReason(c) !== null, `expected hard block: ${c}`); };
    test('hard (1): an invalid inner group keeps the valid outer group', () => {
        hard('{rm,-rf,~,{}}');
    });
    test('guarded (2): invalid inner braces or ${} inside a valid outer group', () => {
        guarded('{git,push,origin,HEAD@{0}:main}');
        guarded('{git,push,origin,${X:-HEAD:main}}');
    });
    test('guarded/hard (3): nested groups expand outermost first', () => {
        guarded('{{git,push},origin} HEAD:main');
        hard('{{rm,-rf},--,~}');
    });
    test('still free: ordinary braces', () => {
        for (const c of ['mkdir -p a/{b,c}', 'cp f{,.bak}', 'for i in {1..3}; do echo $i; done', 'git stash show stash@{0}', 'git show HEAD@{1}', 'find . -exec echo {} \;']) scopes(c, []);
    });
    test('perf: a 4 KB word of many groups is judged within the iteration cap', () => {
        for (const w of ['a{,}'.repeat(1000), '{'.repeat(1500) + 'a,b' + '}'.repeat(1500), '{x}{y,z}'.repeat(500)]) {
            for (const c of [`echo ${w}`, `${w} x`, `rm -rf ${w}`]) {
                const t0 = Date.now();
                sc(c);
                g.hardBlockReason(c);
                assert.ok(Date.now() - t0 < 1000, `slow: ${c.slice(0, 20)}`);
            }
        }
    });
});
