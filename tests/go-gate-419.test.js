// go-gate 4.19.1: installed tool scripts, test-run hint, heredoc data, gh api writes, home globs,
// slash commands. Offline; temp dirs only, nothing here deletes anything.
const { test, describe, beforeEach, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const GATE = path.resolve(__dirname, '..', '.claude', 'hooks', 'go-gate.mjs');
const BASE = String(process.env.HOME || '').startsWith('/private/tmp/') ? process.env.HOME : os.tmpdir();

let g;
before(async () => { g = await import(pathToFileURL(GATE).href); });

process.env.AOS_TEST_SANDBOX = '1';
process.env.GIT_CONFIG_NOSYSTEM = '1';
for (const k of Object.keys(process.env)) if (/^GIT_/.test(k) && k !== 'GIT_CONFIG_NOSYSTEM') delete process.env[k];

let home, work, t, n, claudeDir, ctx;
beforeEach(() => {
    home = fs.mkdtempSync(path.join(BASE, 'aos-g419-'));
    work = path.join(home, 'projects', 'work');
    fs.mkdirSync(work, { recursive: true });
    claudeDir = path.join(home, '.claude');
    t = path.join(home, 'session.jsonl');
    fs.writeFileSync(t, '');
    n = 0;
    process.env.AOS_GATE_TEST_REALHOME = home;
    process.env.XDG_CONFIG_HOME = path.join(home, '.config');
    ctx = { cwd: work, blockTs: 0, home, realHome: home, claudeDir };
    g.setGateContext(ctx);
});

const env = () => ({ ...process.env, HOME: home, XDG_DATA_HOME: '', AOS_SESSION_NAME: '', AOS_ACP_CLIENT: '', CLAUDE_CONFIG_DIR: claudeDir });
const add = (e) => fs.appendFileSync(t, JSON.stringify(e) + '\n');
const user = (text, extra = {}) => ({ type: 'user', uuid: `u${++n}`, timestamp: new Date().toISOString(), message: { role: 'user', content: text }, ...extra });
const human = (text) => user(text, { origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
const run = (command, extra = {}) => spawnSync(process.execPath, [GATE], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, transcript_path: t, session_id: 's1', ...extra }), env: env(), encoding: 'utf8' });
const sc = (c) => g.commandScopes(c);
const hard = (c) => g.hardBlockReason(c) !== null;
const old = (f, ageMs = 3600e3) => { const d = new Date(Date.now() - ageMs); fs.utimesSync(f, d, d); };
const put = (dir, name, body, ageMs) => {
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, name);
    fs.writeFileSync(f, body);
    if (ageMs !== undefined) old(f, ageMs);
    return f;
};

describe('installed tool scripts are not analysed as agent code', () => {
    const RM = 'import shutil\n\ndef uninstall(d):\n    shutil.rmtree(d)\n';
    const plugin = () => path.join(claudeDir, 'plugins', 'cache', 'token-saver', 'token-saver', '2.6.3', 'src');

    test('an old fixture in the plugin cache with a delete subcommand is not guarded', () => {
        const f = put(plugin(), 'cli.py', RM, 3600e3);
        assert.deepEqual(sc(`python3 ${f} stats`), []);
        assert.equal(run(`python3 ${f} stats`, { cwd: work }).status, 0);
    });
    test('the live shape: command -v || python3 <plugin>/cli.py', () => {
        const f = put(plugin(), 'cli.py', RM, 3600e3);
        assert.deepEqual(sc(`(command -v token-saver >/dev/null && token-saver stats) || python3 "${f}" stats`), []);
    });
    test('the same file in the cwd or /private/tmp is destructive', () => {
        put(work, 'tmp-script.py', RM, 3600e3);
        assert.deepEqual(sc('python3 ./tmp-script.py'), ['destructive']);
        const d = fs.mkdtempSync(path.join(BASE, 'aos-g419-t-'));
        const f = put(d, 'tmp-script.py', RM, 3600e3);
        assert.deepEqual(sc(`python3 ${f}`), ['destructive']);
    });
    test('the other installed locations: agents, gemini, local share, CLAUDE_CONFIG_DIR', () => {
        for (const d of [path.join(home, '.agents', 'tools'), path.join(home, '.gemini', 'config', 'x'), path.join(home, '.local', 'share', 'uv', 'tools', 'pp'), path.join(home, '.local', 'pipx', 'venvs', 'x')]) {
            const f = put(d, 'cli.py', RM, 3600e3);
            assert.deepEqual(sc(`python3 ${f} stats`), [], d);
        }
        const other = path.join(home, 'alt-claude');
        g.setGateContext({ ...ctx, claudeDir: other });
        const f = put(path.join(other, 'plugins', 'cache', 'p', 'v'), 'cli.py', RM, 3600e3);
        assert.deepEqual(sc(`python3 ${f}`), []);
        g.setGateContext(ctx);
        assert.deepEqual(sc(`python3 ${f}`), ['destructive'], 'not under the configured claude dir');
    });
    test('the home-level hard check still applies in a trusted dir', () => {
        const f = put(plugin(), 'bad.py', 'import shutil\nfrom pathlib import Path\nshutil.rmtree(Path.home())\n', 3600e3);
        assert.ok(hard(`python3 ${f}`));
        const j = put(plugin(), 'bad.js', "require('fs').rmSync(require('os').homedir(),{recursive:true})", 3600e3);
        assert.ok(hard(`node ${j}`));
        const s = put(plugin(), 'bad.sh', 'rm -rf ~\n', 3600e3);
        assert.ok(hard(`bash ${s}`));
    });
    test('a trusted-dir file written one minute ago is analysed like agent code', () => {
        const f = put(plugin(), 'cli.py', RM, 60e3);
        assert.deepEqual(sc(`python3 ${f} stats`), ['destructive']);
    });
    test('integrity guard: older than the first block counts as installed, newer does not', () => {
        const f = put(plugin(), 'cli.py', RM, 5 * 60e3);
        assert.deepEqual(sc(`python3 ${f}`), ['destructive'], 'five minutes old, no block marker');
        g.setGateContext({ ...ctx, blockTs: Date.now() - 60e3 });
        assert.deepEqual(sc(`python3 ${f}`), [], 'older than the block marker');
        const fresh = put(plugin(), 'new.py', RM);
        assert.equal(sc(`python3 ${fresh}`), null, 'written after the block: cooldown');
    });
    test('a symlink out of the trusted dir is not installed code', () => {
        const target = put(work, 'real.py', RM, 3600e3);
        fs.mkdirSync(plugin(), { recursive: true });
        const link = path.join(plugin(), 'link.py');
        fs.symlinkSync(target, link);
        assert.deepEqual(sc(`python3 ${link}`), ['destructive']);
    });
});

describe('test runs: hint and scope', () => {
    const LOOP = 'node --check x && for f in a b; do T=$(mktemp -d /private/tmp/claude-501/sx.XXXXXX) && env -u CLAUDE_CONFIG_DIR HOME="$T" node --test tests/$f.test.js; done';
    test('the block message points at the container for test runners', () => {
        for (const c of ['npm test && rm -rf build', 'rm -rf build && node --test tests/a.test.js', 'rm -rf build; npx vitest run', 'rm -rf build; npx jest', 'rm -rf build; npx mocha', 'rm -rf build; pytest -q', LOOP]) {
            const r = run(c, { cwd: work });
            assert.equal(r.status, 2, c);
            assert.ok(r.stderr.includes(g.TEST_HINT), c);
            assert.match(r.stderr, /AOS_TEST_SANDBOX=container/);
            assert.match(r.stderr, /docs\/codex-gate-smoke\.md/);
        }
        assert.ok(!run('rm -rf build', { cwd: work }).stderr.includes(g.TEST_HINT));
    });
    test('the loop over an unresolvable test file stays guarded (agent-authored tests are analysed)', () => {
        assert.equal(sc(LOOP), null);
    });
});

describe('a heredoc into a file is data', () => {
    test('rm -- and rm -rf in a heredoc body written to a file', () => {
        for (const body of ['it("x", () => { run("rm -- foo"); });', 'rm -rf build', 'run("rm -rf -- dist")']) {
            const c = `cat >> tests/x.test.js <<'EOF'\n${body}\nEOF`;
            assert.deepEqual(sc(c), [], c);
            assert.ok(!hard(c), c);
            assert.equal(run(c, { cwd: work }).status, 0, c);
        }
    });
});

describe('gh api (S6)', () => {
    test('repositories/<id> paths are read like repos/', () => {
        assert.deepEqual(sc('gh api -X POST repositories/123/git/refs -f ref=refs/heads/main'), ['push-main']);
        assert.deepEqual(sc('gh api -X PATCH repositories/123/git/refs/heads/main -f sha=x'), ['push-main']);
        assert.deepEqual(sc('gh api -X PATCH repositories/123/git/refs/heads/feat/x -f sha=x'), ['github-write']);
    });
    test('a variable or substitution endpoint is push-main', () => {
        for (const c of ['gh api -X PATCH $EP -f sha=y', 'gh api -X PATCH "$EP" -f sha=y', 'gh api -X PATCH $(echo repos/o/r/git/refs/heads/main) -f sha=y', 'gh api -X PATCH repos/$O/r/git/refs/heads/feat -f sha=y', 'gh api -X PUT "repos/$O/$R/contents/a" -f message=m'])
            assert.deepEqual(sc(c), ['push-main'], c);
        assert.deepEqual(sc('gh api -X PUT user/starred/o/r'), ['github-write']);
    });
    test('graphql mutations that move or merge a ref are push-main', () => {
        for (const m of ['updateRef', 'createRef', 'deleteRef', 'createCommitOnBranch', 'mergePullRequest', 'mergeBranch', 'updateBranchProtectionRule'])
            assert.deepEqual(sc(`gh api graphql -f query='mutation { ${m}(input: {}) { clientMutationId } }'`), ['push-main'], m);
        assert.deepEqual(sc(`gh api graphql -f query='mutation { addComment(input: {}) { clientMutationId } }'`), ['github-write']);
    });
    test('PUT pulls/<n>/merge is merge', () => {
        assert.deepEqual(sc('gh api -X PUT repos/o/r/pulls/5/merge'), ['merge']);
        assert.deepEqual(sc('gh api --method PUT repos/o/r/pulls/5/merge -f merge_method=squash'), ['merge']);
        assert.deepEqual(sc('gh api -X PUT repositories/1/pulls/5/merge'), ['merge']);
    });
    test('a field value from a file (@) is an unproven branch', () => {
        assert.deepEqual(sc('gh api -X PUT repos/o/r/contents/a -F branch=@b.txt -f message=m'), ['push-main']);
        assert.deepEqual(sc('gh api -X POST repos/o/r/merges -F base=@b.txt -f head=x'), ['push-main']);
        assert.deepEqual(sc('gh api -X POST repos/o/r/git/refs -F ref=@r.txt'), ['push-main']);
        assert.deepEqual(sc('gh api -X PUT repos/o/r/contents/a -f branch=feat/x -f message=m'), ['github-write']);
    });
});

describe('D2 glob-only final segments empty a top-level home dir', () => {
    test('bracket classes and braces are hard', () => {
        for (const c of ['rm -rf ~/Documents/[!.]*', 'rm -rf ~/Documents/[^.]*', 'rm -rf ~/Documents/[a-z]*', 'rm -rf ~/Documents/{*,.*}', 'rm -rf $HOME/Documents/[!.]*', 'rm -rf /Users/alice/Documents/[^.]*',
            'cd ~/Documents && rm -rf [!.]*', 'cd ~/Documents && rm -rf {*,.*}', 'mv ~/Documents/[a-z]* /tmp/x'])
            assert.ok(hard(c), c);
    });
    test('literal parts keep a path ordinary', () => {
        for (const c of ['rm -rf ~/Documents/{a,b}', 'rm -rf ~/Documents/*.log', 'rm -rf ~/Documents/a[0-9]*', 'rm -rf ~/Documents/sub/[!.]*']) {
            assert.ok(!hard(c), c);
            assert.deepEqual(sc(c), ['destructive'], c);
        }
    });
});

describe('slash commands typed by the human', () => {
    const cmdText = '<command-message>token-saver:token-saver-stats</command-message>\n<command-name>/token-saver:token-saver-stats</command-name>\n<command-args></command-args>';
    const legacy = () => user(cmdText);
    const withOrigin = () => user(cmdText, { origin: { kind: 'human' }, turnOrigin: 'human' });
    test('both stored shapes are human; only the one with origin data is strict', () => {
        assert.equal(g.isHumanEntry(legacy()), true);
        assert.equal(g.isHumanEntry(withOrigin()), true);
        assert.equal(g.isStrictHumanEntry(legacy()), false);
        assert.equal(g.isStrictHumanEntry(withOrigin()), true);
        assert.equal(g.isHumanEntry(user(cmdText, { isMeta: true })), false);
    });
    test('a slash command is human but never a GO, even with GO as its argument', () => {
        for (const mk of [legacy, withOrigin, () => user(cmdText.replace('<command-args></command-args>', '<command-args>GO</command-args>'))]) {
            fs.writeFileSync(t, '');
            add(human('GO'));
            assert.equal(run('rm -rf build').status, 0, 'a plain GO opens the gate');
            add(mk());
            assert.equal(run('rm -rf build').status, 2, 'the slash command closes it');
        }
    });
});

describe('read-only chains after a peer message (v5 V10)', () => {
    const peer = () => user('peer note', { origin: { kind: 'peer', from: 'x' }, promptSource: 'system', isMeta: true, turnOrigin: 'peer' });
    const inSoftAfterPeer = () => {
        fs.writeFileSync(t, '');
        add(human('hello'));
        add(peer());
    };

    // No allowlist: these pass because nothing in them is guarded. Scripts are still read
    // and analysed, so a harmless check script passes and a deleting one does not.
    test('pure read/check chains with harmless scripts need no GO', () => {
        put(path.join(work, 'plugins', 'x', 'tests'), 'source-guard.mjs', 'import { readFileSync } from "node:fs";\nif (/eval\\(/.test(readFileSync(process.argv[2] || "x", "utf8"))) process.exit(1);\n');
        put(path.join(work, 'tests'), 'a.test.js', 'const test = require("node:test");\ntest("ok", () => {});\n');
        const allowed = [
            'claude plugin validate plugins/x; claude plugin test plugins/x; node plugins/x/tests/source-guard.mjs; npm exec tsc -- --noEmit; git diff --stat',
            'git diff --stat',
            'git log --oneline -5 && git status',
            'node --test tests/a.test.js',
            'npm test',
            'npx tsc --noEmit',
            'npm exec tsc -- --noEmit && git diff',
            'claude plugin validate plugins/x && claude plugin test plugins/x',
            'node plugins/x/tests/source-guard.mjs',
            'grep -n foo bar.txt | head -5',
            'rg foo | wc -l',
            'git rev-parse HEAD || git branch --list feat/*',
            "cd plans && ls -lt | awk 'NR>1{print $6,$7}' | head",
        ];
        for (const c of allowed) {
            inSoftAfterPeer();
            assert.equal(run(c, { cwd: work }).status, 0, `allowed: ${c}`);
        }
    });

    test('mutating or exfiltrating chains keep today behaviour', () => {
        // The gate guards publish/push/destructive actions only; plain writes (>, tee),
        // commits and curl were never its scope and stay unguarded.
        const blocked = [
            'git status; git push origin main',
            'git diff --stat && rm -rf build',
            'gh api -X POST /repos/x/y',
            'ls | head; gh pr merge 12',
            'node tmp-script-rm.mjs',
            'npm exec tsc -- --noEmit && npm publish',
            'git log -1 || git reset --hard HEAD~1',
            'grep -n x f; git branch -D old',
        ];
        for (const c of blocked) {
            inSoftAfterPeer();
            assert.equal(run(c, { cwd: work }).status, 2, `blocked: ${c}`);
        }
    });

    test('a test file or check script that deletes is still analysed and blocked', () => {
        put(path.join(work, 'tests'), 'evil.test.js', 'const { rmSync } = require("node:fs");\nrmSync("build", { recursive: true, force: true });\n');
        const f = put(work, 'evil.mjs', 'import { rmSync } from "node:fs"; rmSync("build", { recursive: true });\n');
        for (const c of ['node --test tests/evil.test.js', `node ${f}`, 'git diff --stat; node evil.mjs']) {
            inSoftAfterPeer();
            assert.equal(run(c, { cwd: work }).status, 2, `blocked: ${c}`);
        }
    });
});
