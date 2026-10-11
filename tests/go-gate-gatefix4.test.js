// Third Opus review round: close the gatefix4 bypasses ((1) command substitution in a
// git/npm/rm segment, (2) an assigned guarded noun behind a command-position $ head,
// (3) backslash-newline continuation, (4) ${IFS} words, (5) xargs with visible flags or -I,
// (6) data fed into a shell, (7) env -S, (8) flock/script -c, (9) bundled shell options,
// (10) restored old decisions).
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
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gfx4-'));
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
        await import(`${pathToFileURL(GATE).href}?load=gfx4`);
    } catch (e) {
        assert.fail(`go-gate.mjs must parse: ${e}`);
    }
});

describe('(1) a command substitution inside a git/npm/rm segment is unscoped', () => {
    test('null: the split cannot keep the substitution next to the command', () => {
        scopes('git $(echo push) origin HEAD:main', null);
        scopes('git `echo push` origin HEAD:main', null);
        scopes('npm $(echo publish)', null);
    });
    test('hook: the substitution-assembled push needs a plain GO', () => {
        add(human('context'));
        blocked('git $(echo push) origin HEAD:main');
    });
    test('free: substitutions are read as their own segments where they are the command', () => {
        scopes('echo $(git rev-parse HEAD)', []);
    });
});

describe('(2) an assigned guarded noun behind a command-position $ head', () => {
    test('null: the assigned value names a guarded program', () => {
        scopes('c="git push"; ${=c} origin HEAD:main', null);
        scopes("sh <<'EOF'\nc=\"git push\"\n$c origin HEAD:main\nEOF", null);
        scopes("c=git; $c push origin HEAD:main", null);
    });
    test('free: no command-position $ head runs the assignment', () => {
        scopes('c="git push"; echo "$c"', []);
        scopes('echo "git push"', []);
        scopes('B=main; git push origin feat:$B', ['push-main']);
    });
});

describe('(3) a backslash-newline continuation joins the words', () => {
    test('guarded: gi\\ + t push is the push', () => {
        scopes('gi\\\nt push origin HEAD:main', ['push-main']);
    });
    test('free: continuation of data words stays free', () => {
        scopes('echo one\\\ntwo', []);
    });
});

describe('(4) ${IFS} words read as spaces before judging', () => {
    test('null: the expansion glues the guarded command', () => {
        scopes("bash -c 'git${IFS}push${IFS}origin${IFS}HEAD:main'", null);
    });
    test('destructive stays grantable, reading stays free', () => {
        scopes("bash -c 'rm${IFS}-rf${IFS}build'", ['destructive']);
        scopes("bash -c 'echo ${IFS}ok'", []);
        scopes("sh -c 'g=git;p=push;$g${IFS}$p${IFS}origin${IFS}HEAD:main'", null);
    });
});

describe('(5) xargs with visible flags or -I', () => {
    test('null: no guarded subcommand is visible, or stdin words are spliced', () => {
        scopes('echo push origin HEAD:main | xargs git --no-pager', null);
        scopes('echo push | xargs -I% git % origin HEAD:main', null);
        scopes('printf "%s" publish | xargs npm', null);
    });
    test('visible rows keep being judged normally', () => {
        scopes('echo main | xargs git push origin', null);
        scopes('xargs git push origin < f', null);
        scopes('echo f | xargs cat', []);
        scopes('echo done | xargs echo', []);
    });
});

describe('(6) data fed into a shell with an assigned guarded noun', () => {
    test('null: the fed stage prints the guarded command', () => {
        scopes("c='git push origin HEAD:main'; echo \"$c\" | sh", null);
        scopes("c='git push origin HEAD:main'; sh <<< \"$c\"", null);
    });
    test('free feeds keep free', () => {
        scopes('ls | sh', []);
        scopes('c=git; echo ok | sh', []);
    });
});

describe('(7) env -S is a command string', () => {
    test('null: the -S value is the command', () => {
        scopes("env -S'git push origin HEAD:main'", null);
        scopes("env -S 'git push origin HEAD:main'", null);
    });
    test('free: a benign -S value', () => {
        scopes("env -S 'echo hi'", []);
    });
});

describe('(8) flock/script -c bodies are opaque command strings', () => {
    test('null: the -c value is the command', () => {
        scopes("flock /tmp/l -c 'git push origin HEAD:main'", null);
        scopes("script -qc 'git push origin HEAD:main' /dev/null", null);
    });
    test('free: benign bodies', () => {
        scopes('flock /tmp/l echo hi', []);
        scopes("script -qc 'echo hi' /dev/null", []);
    });
});

describe('(9) bundled shell options with a value do not stop the -c scan', () => {
    test('null: the body behind -euo pipefail -c is judged', () => {
        scopes("bash -euo pipefail -c 'g=git; p=push; $g $p origin HEAD:main'", null);
    });
    test('grantable destructive and free reading', () => {
        scopes("bash -euo pipefail -c 'rm -rf build'", ['destructive']);
        scopes("bash -euo pipefail -c 'echo ok'", []);
    });
});

describe('(10) old decisions restored', () => {
    test('destructive: an rm row with visible flags, stdin only adds files', () => {
        scopes('find . -name "*.pyc" | xargs rm -f', ['destructive']);
        scopes('find . -name x | xargs rm -rf', ['destructive']);
    });
    test('unscoped: rm flags can still come from the stdin words', () => {
        scopes('echo -rf build | xargs rm', null);
        scopes('xargs rm', null);
    });
    test('free: a read-only git branch row behind docker exec', () => {
        scopes('docker exec ctr git branch', []);
    });
    test('hook: the value words still guarded stay blocked', () => {
        add(human('context'));
        blocked('docker exec ctr git push origin HEAD:main');
        blocked('docker exec ctr rm -rf build');
    });
});
