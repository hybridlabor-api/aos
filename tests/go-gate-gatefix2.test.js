// Gate fixes, third review round (Tim approved, 2026-10-07): statement-glued opaque bodies,
// shell option scans, escaped bodies, wrapper argument command positions, computed heads and
// verbs outside opaque text, xargs stdin commands, docker subcommands, wrapper additions and
// catchAll linearity. Offline: temp HOME, synthetic transcripts. The gate only CLASSIFIES the
// strings below (commandScopes) or runs the hooks as child processes; nothing here executes a
// command string.
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
    home = fs.mkdtempSync(path.join(BASE, 'aos-gfx2-'));
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

const fill = (s) => s.split('{P}').join(work.replace(/\\/g, '/')).split('{H}').join(home.replace(/\\/g, '/'));
const env = () => ({ ...process.env, HOME: home, USERPROFILE: home, XDG_DATA_HOME: '', AOS_SESSION_NAME: '', AOS_ACP_CLIENT: '', AOS_GATE_PROTECTED_BRANCHES: '' });
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

// ---------------------------------------------------------------------------
// (1) `;`-glued and ${IFS}-glued statements inside an opaque body.
// ---------------------------------------------------------------------------
describe('(1) opaque bodies are split statement-wise, not by whitespace only', () => {
    test('null: a $ head in command position of a later statement fails closed', () => {
        scopes("sh -c 'true;g=git;p=push;$g $p origin HEAD:main'", null);
        scopes("sh -c 'g=git;p=push;$g${IFS}$p${IFS}origin${IFS}HEAD:main'", null);
        scopes(`docker run --rm -v {P}:/src node:24 sh -c 'true;g=git;p=push;$g $p origin main'`, null);
    });
    test('[] unchanged: statements without a command-position $ stay free', () => {
        scopes("sh -c 'true;g=git;p=push;echo skipped'", []);
        scopes("sh -c 'g=git;p=push;echo $HOME'", []);
        scopes(`docker run --rm -v {P}:/src:ro node:24 sh -c 'cd /src && node --test'`, []);
    });
    test('hook: the glued body needs a plain GO', () => {
        typed('gogate grant container-test 2h');
        add(human('go on'));
        blocked("sh -c 'true;g=git;p=push;$g $p origin HEAD:main'");
        add(human('GO'));
        ok("sh -c 'true;g=git;p=push;$g $p origin HEAD:main'");
    });
});

// ---------------------------------------------------------------------------
// (2) the option scan reaches -c past earlier options and their values.
// ---------------------------------------------------------------------------
describe('(2) shell options are scanned until -c', () => {
    test('null: -c after -o/--rcfile and their values is found', () => {
        scopes("bash -o pipefail -c 'g=git; p=push; $g $p origin HEAD:main'", null);
        scopes("bash --rcfile /x/r -c 'g=git; p=push; $g $p origin HEAD:main'", null);
        scopes("sh -O globstar -c 'g=git; p=push; $g $p origin HEAD:main'", null);
    });
    test('[] unchanged: bodies behind such options stay free without a $ head', () => {
        scopes("bash -o pipefail -c 'echo hi'", []);
        scopes("bash --rcfile /x/r -c 'echo hi'", []);
    });
    test('hook: the option-hidden body needs a plain GO', () => {
        typed('gogate grant container-test 2h');
        add(human('go on'));
        blocked("bash -o pipefail -c 'g=git; p=push; $g $p origin HEAD:main'");
        add(human('GO'));
        ok("bash -o pipefail -c 'g=git; p=push; $g $p origin HEAD:main'");
    });
});

// ---------------------------------------------------------------------------
// (3) a backslash-escaped body: unq removes the escapes before the body is
// judged, so `\$g` is the computed head it really is.
// ---------------------------------------------------------------------------
describe('(3) escaped opaque bodies are unescaped before judging', () => {
    test('null: one escaped token carries the whole computed command', () => {
        scopes('sh -c g=git\\;p=push\\;\\$g\\ \\$p\\ origin\\ HEAD:main', null);
        scopes('bash -c g=git\\;p=push\\;\\$g\\ \\$p\\ origin\\ HEAD:main', null);
    });
    test('[] unchanged: escaped bodies without a computed head stay free', () => {
        scopes('sh -c echo\\ hello', []);
        scopes('sh -c g=git\\;echo\\ done', []);
    });
    test('hook: the escaped body needs a plain GO', () => {
        typed('gogate grant container-test 2h');
        add(human('go on'));
        blocked('sh -c g=git\\;p=push\\;\\$g\\ \\$p\\ origin\\ HEAD:main');
        add(human('GO'));
        ok('sh -c g=git\\;p=push\\;\\$g\\ \\$p\\ origin\\ HEAD:main');
    });
});

// ---------------------------------------------------------------------------
// (4) a wrapper keeps command position through its options and arguments.
// ---------------------------------------------------------------------------
describe('(4) $ after a wrapper with options/args stays in command position', () => {
    test('null: the computed head after the wrapper arguments is seen', () => {
        scopes(`g=git p=push sh -c 'timeout 60 $g $p origin HEAD:main'`, null);
        scopes(`g=git sh -c 'nice -n 5 $g $p origin HEAD:main'`, null);
        scopes(`g=git sh -c 'sudo -u x $g $p origin HEAD:main'`, null);
        scopes(`g=git sh -c 'env -u X $g $p origin HEAD:main'`, null);
        scopes(`g=git sh -c 'stdbuf -o0 $g $p origin HEAD:main'`, null);
        scopes(`g=git sh -c 'time -p $g $p origin HEAD:main'`, null);
        scopes(`g=git sh -c 'exec -a x $g $p origin HEAD:main'`, null);
        scopes(`docker run --rm -v {P}:/src:ro -e g=git -e p=push node sh -c 'timeout 60 $g $p origin HEAD:main'`, null);
        scopes(`docker run --rm -v {P}:/src node sh -c 'timeout 60 $g $p origin HEAD:main'`, null);
    });
    test("[] unchanged: the wrapper's own arguments are not the command", () => {
        scopes(`sh -c 'timeout 60 echo done'`, []);
        scopes(`sh -c 'nice -n 5 echo done'`, []);
        scopes(`docker run --rm -v {P}:/src:ro node sh -c 'timeout 60 echo done'`, []);
    });
    test('hook: the wrapper-hidden computed push needs a plain GO', () => {
        typed('gogate grant container-test 2h');
        add(human('go on'));
        blocked(`docker run --rm -v {P}:/src:ro -e g=git -e p=push node sh -c 'timeout 60 $g $p origin HEAD:main'`);
        add(human('GO'));
        ok(`docker run --rm -v {P}:/src:ro -e g=git -e p=push node sh -c 'timeout 60 $g $p origin HEAD:main'`);
    });
});

// ---------------------------------------------------------------------------
// (5) a command-position $ head followed by another $ word is unscoped.
// ---------------------------------------------------------------------------
describe('(5) computed head followed by a computed word needs a GO', () => {
    test('null: the verb and its arguments are assembled from variables', () => {
        scopes('g=git; p=push; $g $p origin HEAD:main', null);
        scopes('sudo $g $p origin HEAD:main', null);
        scopes('g=git p=push $g $p origin HEAD:main', null);
    });
    test('[] unchanged: a $ argument of a reader is data, a single $ head without a guarded noun stays free', () => {
        scopes('echo $X $Y config', []);
        scopes('echo $X config > out.log', []);
        scopes('$X --version', []);
        scopes('sh -c "echo $X; echo oops"', []);
    });
    test('hook: the assembled push needs a plain GO', () => {
        typed('gogate grant push-feature 1h');
        add(human('go on'));
        blocked('g=git; p=push; $g $p origin HEAD:main');
        add(human('GO'));
        ok('g=git; p=push; $g $p origin HEAD:main');
    });
});

// ---------------------------------------------------------------------------
// (6) a $-assembled git subcommand is unscoped.
// ---------------------------------------------------------------------------
describe('(6) git subcommands assembled from variables are unscoped', () => {
    test('null: the alias lookup cannot read a computed verb', () => {
        scopes('p=push; git $p origin HEAD:main', null);
        scopes('git $p origin HEAD:main', null);
        scopes('git "$p" origin HEAD:main', null);
    });
    test('[] unchanged: readable free subcommands keep their decision', () => {
        scopes('git status', []);
        scopes('git log -1', []);
        scopes('git push origin feat:feat', ['push-feature']);
    });
    test('hook: the computed git subcommand needs a plain GO', () => {
        typed('gogate grant push-feature 1h');
        add(human('go on'));
        blocked('p=push; git $p origin HEAD:main');
        add(human('GO'));
        ok('p=push; git $p origin HEAD:main');
    });
});

// ---------------------------------------------------------------------------
// (7) docker subcommands other than run are read through catchAll.
// ---------------------------------------------------------------------------
describe('(7) docker exec/compose run what their words say', () => {
    test('null: guarded words behind docker exec and compose need a GO', () => {
        scopes('docker exec ctr git push origin HEAD:main', null);
        scopes('docker compose run app npm publish', null);
        scopes("docker exec ctr sh -c 'git push origin HEAD:main'", null);
        scopes('docker exec ctr rm -rf build', null);
    });
    test('[] unchanged: benign docker subcommands stay free', () => {
        scopes('docker exec x ls', []);
        scopes('docker ps', []);
        scopes('docker build -t x .', []);
        scopes('docker compose up -d', []);
        scopes("docker exec ctr sh -c 'echo ok'", []);
        scopes('docker compose run app npm test', []);
    });
    test('hook: docker exec git push is not covered by a container-test grant', () => {
        typed('gogate grant container-test 2h');
        add(human('go on'));
        blocked('docker exec ctr git push origin HEAD:main');
        add(human('GO'));
        ok('docker exec ctr git push origin HEAD:main');
    });
});

// ---------------------------------------------------------------------------
// (8) xargs takes its command words from stdin.
// ---------------------------------------------------------------------------
describe('(8) xargs with a guarded program head and no visible arguments is unscoped', () => {
    test('null: the stdin-fed words carry the guarded command', () => {
        scopes('echo push origin HEAD:main | xargs git', null);
        scopes('xargs git', null);
        scopes('printf "%s" publish | xargs npm', null);
        scopes('echo -rf build | xargs rm', null);
    });
    test('decisions unchanged: visible arguments are judged by the normal branches', () => {
        scopes('find . -name x | xargs rm -rf', ['destructive']);
        scopes('xargs git push origin < f', null);
        scopes('echo done | xargs echo', []);
        scopes('echo f | xargs cat', []);
    });
    test('hook: stdin-fed xargs git needs a plain GO', () => {
        typed('gogate grant push-feature 1h');
        add(human('go on'));
        blocked('echo push origin HEAD:main | xargs git');
        add(human('GO'));
        ok('echo push origin HEAD:main | xargs git');
    });
});

// ---------------------------------------------------------------------------
// (9) setsid / flock / ionice are wrappers too.
// ---------------------------------------------------------------------------
describe('(9) process-hiding wrappers keep the command readable', () => {
    test('null: the computed head behind them is seen', () => {
        scopes('g=git; setsid $g push origin HEAD:main', null);
        scopes('g=git; flock /tmp/l $g push origin HEAD:main', null);
        scopes('g=git; ionice $g push origin HEAD:main', null);
        scopes('g=git; nice --adjustment 5 $g push origin HEAD:main', null);
    });
    test('[] unchanged: their benign commands stay free', () => {
        scopes('setsid echo hi', []);
        scopes('flock /tmp/l echo hi', []);
        scopes('ionice echo hi', []);
        scopes('nice --adjustment 5 echo hi', []);
    });
    test('hook: the setsid-hidden push needs a plain GO', () => {
        typed('gogate grant push-feature 1h');
        add(human('go on'));
        blocked('g=git; setsid $g push origin HEAD:main');
        add(human('GO'));
        ok('g=git; setsid $g push origin HEAD:main');
    });
});

// ---------------------------------------------------------------------------
// (10) catchAll is linear (suffix lookups + tick, no per-word slices): five thousand $
// words are analysed in well under 2 s, and the decisions are the OLD catchAll's
// (the pre-rewrite implementation is kept below as the reference).
// ---------------------------------------------------------------------------
describe('(10) catchAll stays linear on a five-thousand-word command', () => {
    test('fast and unchanged on a long benign docker echo', () => {
        // The analysis runs under a CPU budget (gateCtx.budgetMs, default 150 ms); a cold first call on Windows needs more. This test is about linearity.
        ctx.budgetMs = 1500;
        const c = `docker run --rm -v {P}:/src:ro node:24 echo ${Array(5000).fill('$a').join(' ')}`;
        const t0 = process.hrtime.bigint();
        const got = sc(c);
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        assert.deepEqual(got, [], fill(c).slice(0, 80));
        assert.ok(ms < 2000, `took ${ms.toFixed(0)} ms`);
    });
    test('differential: the rewrite decides exactly like the old catchAll', () => {
        // The OLD catchAll, kept verbatim as the reference (pre-rewrite rules form), over the
        // word stream the rewrite feeds it: the statement-wise scanSplit flattening is finding
        // (1)'s intended behaviour change (`sh -c 'echo ok;;g=git;p=push;$g $p ...'` catches
        // glued statements the plain whitespace split misses), so the reference runs the naive
        // quadratic rules over the same scanSplit words; the rewrite must decide identically.
        const old = (tok, seg, opaque = false) => {
            const flat = () => tok.flatMap((t) => scanSplit(unq(t)).flatMap((p) => tokens(p.t.trim())));
            const w = (opaque ? flat() : tok).map(base);
            const after = (i, set) => w.slice(i + 1).some((x) => set.test(x));
            const raw = (opaque ? flat() : tok).map(unq);
            if (opaque && cposDollar(w)) return true;
            let cmd = true;
            for (let i = 0; i < w.length; i++) {
                if ((cmd || opaque) && /^[$`\u0001\u0002]/.test(w[i]) &&
                    (after(i, GUARDED_NOUN) || (cmd && w.slice(i + 1).some((x) => /^[$`\u0001\u0002]/.test(x))))) return true;
                if ((w[i] === "git" || w[i] === "hub") && after(i, GIT_VERBS)) return true;
                if ((w[i] === "git" || w[i] === "hub") && w.slice(i + 1).includes("commit") && raw.slice(i + 1).some((x) => COMMIT_WORD_BYPASS.test(x) || /^[$\x60]/.test(x) || (/^-/.test(x) && /[$\x60]/.test(x)))) return true;
                const sub = w.slice(i + 1).find((x) => !x.startsWith("-"));
                if ((PM.test(w[i]) || w[i] === "npx") && !/^(?:view|info|show|v)$/.test(sub ?? "") && after(i, /^(?:publish|version)$/)) return true;
                if (w[i] === "gh" && after(i, /^(?:merge|create|delete|edit|comment|close|review|api|sync)$/)) return true;
                if (/^(?:np|release-it|semantic-release)$/.test(w[i]) || (w[i] === "changeset" && after(i, /^publish$/))) return true;
                if (w[i] === "rm" && w.slice(i + 1).some((x) => /^-[a-zA-Z]*[rR]/.test(x) || x === "--recursive")) return true;
                cmd = CPOS_JOINER.test(w[i]);
            }
            return false;
        };
        const { catchAll, cposDollar, tokens, unq, base, scanSplit, GUARDED_NOUN, GIT_VERBS, CPOS_JOINER, PM, COMMIT_WORD_BYPASS } = g._catchAllInternals;
        const A = [
            "git push origin main", "npm publish", "npm view @a/b version", "npm version patch", "npm v @a/b dist-tags",
            "gh pr merge 117", "gh release create", "gh api users", "rm -rf build", "echo hi", "echo $X config",
            "git commit --no-verify -m x", "git commit -m x", "git $p origin main", "setsid echo hi",
            "q=push; git $q origin HEAD:main", "sudo $g $p origin HEAD:main", "g=git p=push $g $p origin HEAD:main",
            `docker run --rm -v x:/src node:24 bash -c 'echo $a; $g push'`, "watch npm publish", "x=$(date); rm -rf build",
            '$X --version', '$X rst', '$X config',
        ];
        // a few generated ones, including glued statements and long rows
        const gen = Array.from({ length: 42 }, (_, k) => {
            const f = k % 7;
            if (f === 0) return `echo ${Array((k % 7) + 2).fill('$a').join(' ')} config`;
            if (f === 1) return `sh -c 'echo ok${";".repeat((k % 3) + 1)}g=git;p=push;$g $p origin main'`;
            if (f === 2) return `sh -c '${Array(20).fill('mid').join(';')} $g ${(k % 2) ? 'config user.name' : 'echo hi'}'`;
            if (f === 3) return `sudo -u x npm ${(k % 2) ? 'view @a/b version' : 'version'}`;
            if (f === 4) return `cat f | xargs git ${(k % 2) ? 'push origin HEAD:main' : ''}`;
            if (f === 5) return `xargs ${(k % 2) ? 'rm -rf' : 'rm'}`;
            return `printf '%s' ${(k % 2) ? 'push' : 'status'} | xargs git`;
        });
        for (const c of [...A, ...gen]) {
            for (const op of [false, true]) {
                const t = tokens(c);
                assert.equal(!!catchAll(t, c, op), !!old(t, c, op), `${JSON.stringify(c)} opaque=${op}`);
            }
        }
        // the long docker case, split the way dockerScopes feeds it: [img, ...rest], opaque
        const longTok = ['node:24', 'echo', ...Array(5000).fill('$a')];
        const t0b = process.hrtime.bigint();
        assert.equal(!!catchAll(longTok, 'echo', true), !!old(longTok, 'echo', true), 'the long word row decides the same way');
        const msb = Number(process.hrtime.bigint() - t0b) / 1e6;
        assert.ok(msb < 2000, `the differential long row took ${msb.toFixed(0)} ms`);
    });
});

module.exports = {};
