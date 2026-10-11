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

const env = () => ({ ...process.env, HOME: home, USERPROFILE: home, XDG_DATA_HOME: '', AOS_SESSION_NAME: '', AOS_ACP_CLIENT: '', CLAUDE_CONFIG_DIR: claudeDir });
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

describe('S5-3: the gate hook fails closed', () => {
    const settings = JSON.parse(fs.readFileSync(path.join(path.dirname(GATE), '..', 'settings.json'), 'utf8'));
    const gateCmd = settings.hooks.PreToolUse.flatMap((e) => e.hooks).map((h) => h.command).find((c) => c.includes('go-gate.mjs'));

    test('the wired command turns any node failure into exit 2', () => {
        assert.ok(gateCmd.endsWith('|| exit 2'), gateCmd);
        const r = spawnSync('sh', ['-c', gateCmd.replace(/^node /, 'aos-no-such-node-binary ').replace(/\$\{CLAUDE_PROJECT_DIR\}/g, '/nonexistent')]);
        assert.equal(r.status, 2, 'a missing interpreter must block, not pass');
    });
    test('S5-8: trail-relay hooks get 5 s and their own cap is shorter; the gate keeps no timeout', () => {
        const relay = settings.hooks.PreToolUse.concat(settings.hooks.Stop).flatMap((e) => e.hooks).filter((h) => h.command.includes('trail-relay.mjs'));
        assert.ok(relay.length > 0);
        for (const h of relay) assert.ok(h.timeout >= 5, h.command);
        const src = fs.readFileSync(path.join(path.dirname(GATE), 'trail-relay.mjs'), 'utf8');
        assert.ok(/setTimeout\(\(\) => process\.exit\(0\), 4000\)/.test(src), 'the relay exits itself before the 5 s hook kill');
    });
    test('a gate that exits 1 (crash) still blocks', () => {
        const r = spawnSync('sh', ['-c', 'sh -c "exit 1" || exit 2']);
        assert.equal(r.status, 2);
    });
});

describe('S5-2: analysis budget default', () => {
    test('win32 gets 500 ms, every other platform keeps 150 ms', () => {
        assert.equal(g.defaultBudgetMs('win32'), 500);
        assert.equal(g.defaultBudgetMs('darwin'), 150);
        assert.equal(g.defaultBudgetMs('linux'), 150);
    });
    test('a destructive command stays guarded under the win32 budget', () => {
        g.setGateContext({ budgetMs: g.defaultBudgetMs('win32') });
        assert.deepEqual(sc('rm -rf build'), ['destructive']);
    });
});

describe('installed tool scripts are not analysed as agent code', () => {
    const RM = 'import shutil\n\ndef uninstall(d):\n    shutil.rmtree(d)\n';
    const plugin = () => path.join(claudeDir, 'plugins', 'cache', 'token-saver', 'token-saver', '2.6.3', 'src');

    test('S5-1: a backdated (utimes/touch -t) script in the plugin cache is still analysed', () => {
        const f = put(plugin(), 'backdated.py', RM, 3600e3);
        assert.notDeepEqual(sc(`python3 ${f} stats`), [], 'mtime is backdated, ctime is now');
    });
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

    test('rule 16: docker run with only :ro mounts is not script-analysed and has no cooldown', () => {
        const ok = [
            `docker run --rm -v ${work.replace(/\\/g, '/')}:/src:ro -e AOS_TEST_SANDBOX=container node:24-bookworm bash -c 'cd /src && node --test tests/evil.test.js; echo "exit \${PIPESTATUS[0]}"' > ${work}/log.txt 2>&1`,
            `docker run --rm -v ${work.replace(/\\/g, '/')}:/src:ro node:24 node /src/evil.mjs | tail -5`,
            `docker run --rm -i --volume=${work.replace(/\\/g, '/')}:/src:ro,z -w /src node:24 node --test tests/evil.test.js 2>&1 | grep -E fail | head`,
        ];
        const no = [
            `docker run --rm -v ${work.replace(/\\/g, '/')}:/src node:24 node /src/evil.mjs`,
            `docker run --rm -v ${work.replace(/\\/g, '/')}:/src:rw node:24 node /src/evil.mjs`,
            `docker run --rm -v /var/run/docker.sock:/var/run/docker.sock:ro node:24 node /src/evil.mjs`,
            `docker run --rm --privileged -v ${work.replace(/\\/g, '/')}:/src:ro node:24 node /src/evil.mjs`,
            `docker run --rm --pid=host -v ${work.replace(/\\/g, '/')}:/src:ro node:24 node /src/evil.mjs`,
            `docker run --rm --network host -v ${work.replace(/\\/g, '/')}:/src:ro node:24 node /src/evil.mjs`,
            `docker run --rm --mount type=bind,src=${work},dst=/src node:24 node /src/evil.mjs`,
            `docker run --rm -v src:/src:ro node:24 node /src/evil.mjs`,
            `docker run --rm -v ${work.replace(/\\/g, '/')}:/src:ro node:24 node /src/evil.mjs; node evil.mjs`,
            `docker run --rm -v ${work.replace(/\\/g, '/')}:/src:ro node:24 node /src/evil.mjs && git status`,
            `docker run --rm -v ${work.replace(/\\/g, '/')}:/src:ro node:24 cat /src/x | sh`,
            `docker run --rm -v $(pwd):/src:ro node:24 node /src/evil.mjs`,
            `docker run --rm -v "${work.replace(/\\/g, '/')}:/src:ro" node:24 node "$(cat x)"`,
            `docker build -t x .`,
            // review 23: broad read-only sources still expose secrets or the docker socket
            `docker run --rm -v /:/h:ro node:24 node /h/x.mjs`,
            `docker run --rm -v /var/run:/r:ro node:24 node /r/x.mjs`,
            `docker run --rm -v /run:/r:ro node:24 node /r/x.mjs`,
            `docker run --rm -v ${home}:/h:ro node:24 node /h/x.mjs`,
            `docker run --rm -v ${path.dirname(home)}:/u:ro node:24 node /u/x.mjs`,
            `docker run --rm -v ${home}/.ssh:/s:ro node:24 node /s/x.mjs`,
            `docker run --rm -v ${work}/../..:/u:ro node:24 node /u/x.mjs`,
            // re-review 1/2: unnormalized spellings, system dirs, other users, Library
            `docker run --rm -v /.:/h:ro node:24 node /h/x.mjs`,
            `docker run --rm -v /var/run/.:/r:ro node:24 node /r/x.mjs`,
            `docker run --rm -v /${work}:/h:ro node:24 node /h/x.mjs`,
            `docker run --rm -v ${work}/./:/h:ro node:24 node /h/x.mjs`,
            `docker run --rm -v ${work.toUpperCase()}x:/h:ro node:24 node /h/x.mjs`,
            `docker run --rm -v /etc:/e:ro node:24 node /e/x.mjs`,
            `docker run --rm -v /tmp:/t:ro node:24 node /t/x.mjs`,
            `docker run --rm -v ${home}/projects:/p:ro node:24 node /p/x.mjs`,
            `docker run --rm -v ${home}/Library/Keychains:/k:ro node:24 node /k/x.mjs`,
            `docker run --rm -v ${work}/lnk:/s:ro node:24 node /s/x.mjs`,
            `docker run --rm -v ${work}/does-not-exist:/s:ro node:24 node /s/x.mjs`,
            // review 24: an expansion before the image can become any flags
            `docker run --rm $FLAGS node:24 node /src/evil.mjs`,
            `docker run --rm -e $X -v ${work.replace(/\\/g, '/')}:/src:ro node:24 node /src/evil.mjs`,
            `docker run --rm -v "${work.replace(/\\/g, '/')}:/src:ro" "$IMG" node /src/evil.mjs`,
        ];
        for (const c of ok) assert.equal(g.isReadOnlyDockerRun(c), true, `ro: ${c}`);
        fs.mkdirSync(path.join(home, '.secret'), { recursive: true });
        fs.symlinkSync(path.join(home, '.secret'), path.join(work, 'lnk'));
        for (const c of no) assert.equal(g.isReadOnlyDockerRun(c), false, `not ro: ${c}`);

        // A fresh deleting test file after a block: the :ro container run passes, the host run and a rw mount do not.
        fs.mkdirSync(path.join(home, '.aos', 'gate'), { recursive: true });
        fs.writeFileSync(path.join(home, '.aos', 'gate', `${g.sessionKey('s1')}.block`), JSON.stringify({ ts: Date.now() - 60e3 }));
        put(path.join(work, 'tests'), 'evil.test.js', 'const { rmSync } = require("node:fs");\nrmSync("build", { recursive: true, force: true });\n');
        inSoftAfterPeer();
        // No `cd` inside, so the gate resolves tests/evil.test.js against the host cwd and finds the file.
        const inner = `bash -c 'true && node --test tests/evil.test.js 2>&1 | tail -5'`;
        assert.equal(run(`docker run --rm -v ${work.replace(/\\/g, '/')}:/src:ro -w /src node:24 ${inner}`, { cwd: work }).status, 0);
        assert.equal(run(`docker run --rm -v ${work.replace(/\\/g, '/')}:/src:ro node:24 node /src/tests/evil.test.js`, { cwd: work }).status, 0);
        inSoftAfterPeer();
        const host = run('node --test tests/evil.test.js', { cwd: work });
        assert.equal(host.status, 2);
        assert.match(host.stdout + host.stderr, /cooldown ends in about \d+ min/);
    });

    test('every deny writes the command and its classification to the session log', () => {
        inSoftAfterPeer();
        assert.equal(run('git status; gh pr merge 12', { cwd: work }).status, 2);
        const log = fs.readFileSync(path.join(home, '.aos', 'gate', `${g.sessionKey('s1')}.log`), 'utf8');
        assert.match(log, /deny guarded=true scopes=\[[^\]]*\] "git status; gh pr merge 12" :: \S/);
    });

    test('maskSecrets covers the common token shapes (re-review 4)', () => {
        const cases = [
            ['curl -H "Authorization: Bearer abc.def.ghi" x', 'abc.def.ghi'],
            ['curl -H "Authorization: token ghp_aaaaaaaaaaaaaaaaaaaa" x', 'ghp_aaaa'],
            ['tool --token s3cr3t-value x', 's3cr3t-value'],
            ['tool --password=hunter2 x', 'hunter2'],
            ['PASSWORD=hunter2 run', 'hunter2'],
            ['API_KEY="a b c d" run', 'a b c d'],
            ['git clone https://ghtoken123@github.com/x/y', 'ghtoken123'],
            ['git clone https://u:p@ss@host/x', 'p@ss'],
            ['curl -u admin:pw123 x', 'pw123'],
            ['echo sk-abcdefghijklmnop', 'sk-abcdefghij'],
        ];
        for (const [input, secret] of cases) assert.ok(!g.maskSecrets(input).includes(secret), `masked: ${input} -> ${g.maskSecrets(input)}`);
        assert.equal(g.maskSecrets('git status; ls -la'), 'git status; ls -la');
    });

    test('the deny log masks inline credentials (review 26)', () => {
        inSoftAfterPeer();
        run('GH_TOKEN=ghp_abcdefghijklmnop1234 gh pr merge 12; git push https://bot:s3cretpassw0rd@example.com/x.git', { cwd: work });
        const log = fs.readFileSync(path.join(home, '.aos', 'gate', `${g.sessionKey('s1')}.log`), 'utf8');
        assert.match(log, /GH_TOKEN=\*\*\*/);
        assert.match(log, /:\/\/\*\*\*@example\.com/);
        assert.doesNotMatch(log, /ghp_abcdefghijklmnop1234|s3cretpassw0rd/);
    });
});
