// Delete classification, the unconditional home hard block, data-vs-command false positives,
// interpreter code and script files, and the block cooldown. Offline; the hook runs as a child
// process with HOME set to a fresh temp dir. Nothing here deletes anything: temp dirs stay.
const { test, describe, beforeEach, afterEach, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const GATE = path.resolve(__dirname, '..', '.claude', 'hooks', 'go-gate.mjs');
const GRANT = path.resolve(__dirname, '..', '.claude', 'hooks', 'go-grant.mjs');
const BASE = String(process.env.HOME || '').startsWith('/private/tmp/') ? process.env.HOME : os.tmpdir();

let g;
before(async () => { g = await import(pathToFileURL(GATE).href); });

let home, t, n, work;
beforeEach(() => {
    home = fs.mkdtempSync(path.join(BASE, 'aos-gd-'));
    work = path.join(home, 'work');
    fs.mkdirSync(work);
    t = path.join(home, 'session.jsonl');
    fs.writeFileSync(t, '');
    n = 0;
    g.setGateContext({ cwd: work, blockTs: 0, home });
});

const env = () => ({ ...process.env, HOME: home, XDG_DATA_HOME: '', AOS_SESSION_NAME: '', AOS_ACP_CLIENT: '' });
const add = (e, file = t) => fs.appendFileSync(file, JSON.stringify(e) + '\n');
const user = (text, extra = {}) => ({ type: 'user', uuid: `u${++n}`, timestamp: new Date().toISOString(), message: { role: 'user', content: text }, ...extra });
const human = (text, extra = {}) => user(text, { origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human', ...extra });
const gateRaw = (input) => spawnSync(process.execPath, [GATE], { input: JSON.stringify(input), env: env(), encoding: 'utf8' });
const run = (command, extra = {}) => gateRaw({ tool_name: 'Bash', tool_input: { command }, transcript_path: t, session_id: 's1', ...extra });
const typed = (prompt) => {
    const r = spawnSync(process.execPath, [GRANT], { input: JSON.stringify({ prompt, transcript_path: t, session_id: 's1' }), env: env(), encoding: 'utf8' });
    add(human(prompt));
    return r;
};
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const hard = (c) => g.hardBlockReason(c) !== null;
const guarded = (c) => g.isGuardedCommand(c);

const PB4 = `cd x/skills/playbooks; python3 - <<'E'
import re
p = open('a.md').read()
p = p.replace("git push", "push the branch").replace("gh pr merge", "merge it")
p = p.replace("gh pr create", "open a pr").replace("gh repo create", "new repo")
open('a.md', 'w').write(p)
E`;

const PASS = [
    "cd ~/dev/bdb-dev/aos-wt-plugall && git log -1 --oneline && git status --short | head -5; git grep -nE 'rmSync|fs\\.rm\\(|rmdirSync|promises\\.rm|shutil\\.rmtree|rm -rf' -- installer.js lib bin | grep -v test | wc -l",
    "cat > notes.sh <<'EOF'\nrm -rf /tmp/x\nrm -rf ~\nEOF",
    "cat > notes.sh <<EOF\nrm -rf /tmp/x\nEOF",
    "cat > notes.sh <<-EOF\n\trm -rf /tmp/x\n\tEOF",
    'git commit -m "$(cat <<\'EOF\'\nnever run rm -rf ~ or git push\nEOF\n)"',
    'mkdir -p /private/tmp/claude-501/x/y',
    'echo "never run rm -rf ~"',
    "rg 'shutil.rmtree' src",
    "grep -rn 'rm -rf ~' docs | head",
    "git grep -n 'git push origin main' -- docs",
    "printf '%s\\n' 'rm -rf $HOME'",
    "jq '.scripts | select(.x == \"rm -rf ~\")' package.json",
    "awk '/rm -rf/ {print}' notes.txt",
    "sed -n '/rmSync(process.env.HOME)/p' file.js",
    'ag "rm -rf" .',
    'rm file.txt',
    'rm -f ./a.log',
    'rm ~/dev/x/file.txt',
    'ls ~ && ls $HOME/.config',
    PB4,
    'node -e "console.log(1)"',
    // S2: no command substitution inside single quotes or after a backslash
    "git commit -m 'note: `rm -rf ~` is bad'",
    "echo 'see $(rm -rf ~)' > /tmp/x",
    'echo \\`rm -rf ~\\`',
    // S3: comments
    'ls # note; rm -rf ~', 'ls\n# rm -rf ~\npwd', 'echo a #b $(rm -rf ~)',
    // relative targets that stay below home, and a cd that is undone by a subshell
    'cd ~/dev/x && rm -f ./a.txt', '(cd ~ && ls); rm -f ./a.txt', 'cd build && rm file.txt', 'mv ~/dev/a ~/dev/b', 'chmod -R 755 build',
];

const GUARDED = [
    'rm -rf ./build', 'rm -r -f node_modules', 'rm -fr dist', 'rm -Rf dist', 'rm --recursive dist', 'rm -f -r dist',
    "find . -name '*.log' -delete", 'find . -name x -exec rm {} \\;',
    `node -e "require('fs').rmSync('dist',{recursive:true})"`,
    `node --eval "require('fs').rmdirSync('dist',{recursive:true})"`,
    `node -e "require('fs').promises.rm('dist',{recursive:true})"`,
    `bun -e "require('fs').rmSync('dist',{recursive:true})"`,
    `deno eval "Deno.removeSync('dist',{recursive:true})"`,
    `python3 -c "import shutil; shutil.rmtree('out')"`,
    `python3 -c "import os; os.removedirs('a/b')"`,
    `ruby -e "require 'fileutils'; FileUtils.rm_rf('out')"`,
    `perl -MFile::Path -e "rmtree('out')"`,
    `perl -MFile::Path -e "remove_tree('out')"`,
    'Remove-Item -Recurse -Force .\\dist', 'rm -r dist',
    'cmd /c "rd /s /q dist"', 'rd /s /q dist', 'rmdir /s dist',
    'rm -rf ~/dev/x/build', 'rm -rf $HOME/dev/x/build', 'rm -rf /Users/timrennings/dev/x/build',
    "bash -c 'rm -rf build'", 'sh -c "rm -rf build"', 'find . -name x | xargs rm -rf',
    'git clean -fdx',
    // S1: a bare * is only hard when the working directory is home-level or /
    'rm -rf *', 'cd build && rm -rf *', 'cd ~/dev/x && rm -rf ./*', 'find . -delete', 'cd build && find . -delete',
    // S5: rimraf and rsync --delete below home are normal destructive
    'npx rimraf dist', 'rimraf ./build', 'rsync -a --delete src/ dist/',
    `python3 -c "import subprocess; subprocess.run(['rm','-rf','build'])"`,
    `node -e "require('child_process').execSync('rm -rf build')"`,
    `node -e "require('fs').rmSync(require('path').join(require('os').homedir(),'dev','x','build'),{recursive:true})"`,
];

const HARD = [
    `node -e 'require("fs").rmSync(process.env.HOME,{recursive:true,force:true})'`,
    `python3 -c "import shutil, pathlib; shutil.rmtree(pathlib.Path.home())"`,
    'rm -rf ~', 'rm -rf ~/', 'rm -rf $HOME', 'rm -rf "$HOME"', 'rm -rf "${HOME}"', 'rm -rf ${HOME}', 'rm -rf ~/.config', 'rm -rf $HOME/.claude',
    'rm -rf /Users/timrennings', 'rm -rf /Users/timrennings/Library', 'rm -rf /home/tim', 'rm -rf /home/tim/.ssh',
    'find ~ -delete', 'find $HOME -maxdepth 1 -delete', 'rm -rf /', 'rm -rf /*',
    // relative targets resolve against the tracked cwd
    'cd ~ && rm -rf .', 'cd ~ && rm -rf ./*', 'cd $HOME; rm -rf ./', 'cd ~ && find . -delete', 'cd ~; rm -rf *', 'cd /; rm -rf *',
    'cd ~/dev && rm -rf ..', 'pushd ~ && rm -rf .', 'cd ~ && cd .. && rm -rf *', '(cd ~ && rm -rf .)', 'cd ~; rm -rf build',
    // variables and substitutions
    'H=$HOME; rm -rf $H', 'x=~; rm -rf "$x"', 'export D=$HOME/.config; rm -rf $D', 'a=$HOME; b=$a; rm -rf "${b}"',
    'rm -rf $(echo ~)', 'rm -rf "$(echo $HOME)"', 'cd ~ && rm -rf $(pwd)', 'cd ~ && rm -rf "$PWD"', 'rm -rf `echo ~`', 'echo "$(rm -rf ~)"',
    // ~user and parameter-expansion forms of HOME
    'rm -rf ~timrennings', 'rm -rf ~root', 'rm -rf ~timrennings/.config', 'rm -rf ${HOME:-x}', 'rm -rf ${HOME:?}', 'rm -rf ${HOME%/}', 'rm -rf "${HOME:-/nonexistent}/.ssh"',
    // moving away or syncing over a home-level path
    'mv ~ /tmp/x', 'mv ~/.ssh /tmp/x', 'mv ~/* /tmp', 'rsync -a --delete /tmp/empty/ ~/', 'rsync -a --delete-after /tmp/empty/ $HOME/.config',
    'chmod -R 000 ~', 'chmod -R 777 $HOME/.ssh', 'chown -R nobody ~', 'rimraf ~', 'npx rimraf ~/.config', 'npx rimraf $HOME',
    // the gate's own state
    'rm ~/.aos/gate/s1.block', 'rm -rf ~/.aos/go', `python3 -c "import os; os.remove(os.path.expanduser('~/.aos/gate/s1.block'))"`,
    `node -e "require('fs').unlinkSync(require('os').homedir()+'/.aos/gate/s1.block')"`,
    'bash -c "rm -rf ~"', "sh -c 'rm -rf $HOME/.ssh'", 'sudo rm -rf ~', '(rm -rf ~)', 'true && rm -rf ~',
    'Remove-Item -Recurse $env:USERPROFILE', 'Remove-Item -Recurse -Force $env:HOME', 'rd /s /q C:\\Users\\tim', 'rd /s /q C:\\Users\\tim\\AppData',
    'rm -rf %USERPROFILE%',
    `node -e "require('fs').rmSync(require('os').homedir(),{recursive:true})"`,
    `node -e "require('fs').rmSync(require('path').join(require('os').homedir(),'.config'),{recursive:true})"`,
    `node -e "require('fs').rmSync(os.homedir()+'/.ssh',{recursive:true})"`,
    `python3 -c "import shutil,os; shutil.rmtree(os.path.expanduser('~'))"`,
    `python3 -c "import shutil,os; shutil.rmtree(os.path.expanduser('~/.config'))"`,
    `python3 -c "import shutil,os; shutil.rmtree(os.environ['HOME'])"`,
    `ruby -e "require 'fileutils'; FileUtils.rm_rf(Dir.home)"`,
    `ruby -e "require 'fileutils'; FileUtils.rm_rf ENV['HOME']"`,
    `perl -MFile::Path -e "rmtree(\\$ENV{HOME})"`,
    `node -e "require('child_process').execSync('rm -rf ~')"`,
    `python3 -c "import os; os.system('rm -rf ~')"`,
    `python3 -c "import subprocess; subprocess.run(['rm','-rf','/Users/timrennings'])"`,
    'python3 - <<E\nimport shutil,pathlib; shutil.rmtree(pathlib.Path.home())\nE',
    "node - <<'E'\nrequire('fs').rmSync(process.env.HOME,{recursive:true})\nE",
    'bash <<E\nrm -rf ~\nE',
    `cd /tmp && rm -rf ${os.userInfo().homedir}`,
    `rm -rf ${path.join(os.userInfo().homedir, '.config')}`,
];

describe('A/C classification table', () => {
    test('PASS: not guarded, not hard', () => {
        for (const c of PASS) { assert.ok(!hard(c), `hard: ${c}`); assert.ok(!guarded(c), `guarded: ${c}`); }
    });
    test('GUARDED: destructive scope, grantable, not hard', () => {
        for (const c of GUARDED) {
            assert.ok(!hard(c), `hard: ${c}`);
            assert.ok(guarded(c), `not guarded: ${c}`);
            const s = g.commandScopes(c);
            assert.ok(Array.isArray(s) && s.includes('destructive'), `${c} -> ${JSON.stringify(s)}`);
        }
        assert.deepEqual(g.commandScopes("bash -c 'rm -rf build'"), ['destructive']);
    });
    test('HARD: every spelling is a hard block with the unconditional message', () => {
        for (const c of HARD) {
            const r = g.hardBlockReason(c);
            assert.ok(r, `not hard: ${c}`);
            assert.match(r, /unconditional/);
            assert.match(r, /Stop now and report/);
        }
    });
    test('home-level means home and direct children only', () => {
        for (const p of ['~', '~/x', '$HOME/x', '/Users/a', '/Users/a/b', '/home/a/b', 'C:\\Users\\a', 'C:\\Users\\a\\b', '/', '~bob', '~bob/x', '${HOME:-x}', '${HOME%/}/x', '~/.aos/gate/s1.block']) assert.ok(g.isHomeLevel(p), p);
        for (const p of ['~/dev/x', '$HOME/dev/x', '/Users/a/b/c', '/tmp/x', '/private/tmp/claude-501/x', './build', 'dist', 'C:\\Users\\a\\b\\c']) assert.ok(!g.isHomeLevel(p), p);
    });
});

describe('B hard block cannot be lifted', () => {
    const CASES = ['rm -rf ~', `node -e 'require("fs").rmSync(process.env.HOME,{recursive:true,force:true})'`, 'rm -rf $HOME/.claude', `python3 -c "import shutil, pathlib; shutil.rmtree(pathlib.Path.home())"`];
    test('blocked with no GO', () => {
        add(human('hello'));
        for (const c of CASES) assert.equal(run(c).status, 2, c);
    });
    test('blocked with a literal GO as the last message', () => {
        add(human('GO'));
        for (const c of CASES) { const r = run(c); assert.equal(r.status, 2, c); assert.match(r.stderr, /unconditional/); }
        assert.equal(run('rm -rf ./build').status, 0, 'a normal destructive command is opened by that same GO');
    });
    test('blocked with an active destructive grant, which still covers normal deletes', () => {
        add(human('hello'));
        typed('gogate grant destructive 1h');
        add(human('go on'));
        assert.equal(run('rm -rf ./build').status, 0);
        for (const c of CASES) assert.equal(run(c).status, 2, c);
    });
    test('blocked in mode off, which still allows other guarded commands', () => {
        add(human('hello'));
        typed('gogate off');
        add(human('go on'));
        assert.equal(run('git push origin main').status, 0, 'off is in effect');
        for (const c of CASES) assert.equal(run(c).status, 2, c);
    });
    test('blocked with a valid GO token for this session', () => {
        const m = path.join(home, 'master.jsonl');
        add(human('GO worker-1'), m);
        fs.mkdirSync(path.join(home, '.aos', 'go'), { recursive: true });
        fs.writeFileSync(path.join(home, '.aos', 'go', 'worker-1.token'), JSON.stringify({ target: 'worker-1', issued_at: new Date().toISOString(), master_transcript: m }));
        const w = path.join(home, 'w.jsonl');
        add({ type: 'agent-name', agentName: 'worker-1' }, w);
        add(human('x'), w);
        for (const c of CASES) assert.equal(run(c, { transcript_path: w }).status, 2, c);
        assert.equal(run('rm -rf ./build', { transcript_path: w }).status, 0, 'the token itself is valid and opens a normal delete');
    });
});

describe('S6 the other harness paths enforce the same block functionally', () => {
    let saved;
    beforeEach(() => { saved = process.env.HOME; process.env.HOME = home; });
    const restore = () => { process.env.HOME = saved; };
    afterEach(restore);
    const ROOT = path.resolve(__dirname, '..');
    const params = (command) => ({ options: [{ kind: 'allow_once', optionId: 'allow' }, { kind: 'reject_once', optionId: 'reject' }], toolCall: { rawInput: { command } } });
    const acpOpts = () => ({ allowDefault: 'allow', name: 'w-acp', consume: false, goWait: 0, cwd: work });
    const validToken = (name) => {
        const m = path.join(home, `master-${name}.jsonl`);
        add(human(`GO ${name}`), m);
        fs.mkdirSync(path.join(home, '.aos', 'go'), { recursive: true });
        fs.writeFileSync(path.join(home, '.aos', 'go', `${name}.token`), JSON.stringify({ target: name, issued_at: new Date().toISOString(), master_transcript: m }));
    };

    test('go-check denies a hard block and records the cooldown marker for the worker', async () => {
        const chk = await import(pathToFileURL(path.join(ROOT, 'bin', 'go-check.mjs')).href);
        const r = chk.check(g, { session: 'w-chk', command: 'rm -rf ~', consume: false });
        assert.equal(r.code, 1);
        assert.match(r.out.reason, /unconditional/);
        assert.ok(fs.existsSync(path.join(home, '.aos', 'gate', `${g.nameKey('w-chk')}.block`)));
        restore();
    });

    test('aos-acp rejects a hard block even with allowDefault allow and a valid token', async () => {
        const acp = await import(pathToFileURL(path.join(ROOT, 'bin', 'aos-acp.mjs')).href);
        assert.equal((await acp.decidePermission(params('echo hi'), acpOpts())).outcome.optionId, 'allow', 'harmless stays allowed');
        assert.equal((await acp.decidePermission(params('rm -rf ~'), acpOpts())).outcome.optionId, 'reject');
        validToken('w-acp');
        assert.equal((await acp.decidePermission(params('rm -rf $HOME/.ssh'), acpOpts())).outcome.optionId, 'reject');
        assert.equal((await acp.decidePermission(params(`node -e 'require("fs").rmSync(process.env.HOME,{recursive:true})'`), acpOpts())).outcome.optionId, 'reject');
        assert.ok(fs.existsSync(path.join(home, '.aos', 'go', 'w-acp.token')), 'a hard block does not consume the token');
        restore();
    });

    test('aos-acp applies the block cooldown to a freshly written script', async () => {
        const acp = await import(pathToFileURL(path.join(ROOT, 'bin', 'aos-acp.mjs')).href);
        const older = path.join(work, 'old.py');
        fs.writeFileSync(older, 'print(1)');
        const past = new Date(Date.now() - 3600e3);
        fs.utimesSync(older, past, past);
        assert.equal((await acp.decidePermission(params('git push origin main'), acpOpts())).outcome.optionId, 'reject');
        sleep(30);
        const fresh = path.join(work, 'new.py');
        fs.writeFileSync(fresh, 'print(2)');
        assert.equal((await acp.decidePermission(params(`python3 ${fresh}`), acpOpts())).outcome.optionId, 'reject');
        assert.equal((await acp.decidePermission(params(`python3 ${older}`), acpOpts())).outcome.optionId, 'allow');
        restore();
    });

    test('the OpenCode plugin throws on a hard block and on nothing harmless', async () => {
        const client = { session: { get: async ({ path: p }) => ({ data: { id: p.id, parentID: null } }), messages: async () => ({ data: [] }), prompt: async () => ({ data: {} }) } };
        const mod = await import(`file://${path.join(ROOT, '.opencode', 'plugins', 'bdb-aos.js')}?t=${Date.now()}${Math.random()}`);
        const hooks = await mod.default({ directory: work, client });
        const call = (command) => hooks['tool.execute.before']({ tool: 'bash', sessionID: 'ocs-del', callID: `c${++n}` }, { args: { command } });
        await call('echo hi');
        await assert.rejects(call('rm -rf ~'), /unconditional/);
        await assert.rejects(call('cd ~ && rm -rf .'), /unconditional/);
        await assert.rejects(call('H=$HOME; rm -rf $H'), /unconditional/);
        await assert.rejects(call(`node -e 'require("fs").rmSync(process.env.HOME,{recursive:true})'`), /unconditional/);
        assert.ok(fs.existsSync(path.join(home, '.aos', 'gate', `${g.sessionKey('oc-ocs-del')}.block`)), 'cooldown marker');
        restore();
    });
});

describe('B2 variables and substitutions that cannot be resolved', () => {
    test('a delete target that still holds a variable or substitution is unscoped (needs GO)', () => {
        for (const c of ['rm -rf "$BUILD"', 'rm -f $x', 'rm -rf $(find . -name x)', 'rm -rf `cat list`', 'rm -rf ${DIR:-out}/x', 'x=$(date); rm -rf "$x"']) {
            assert.equal(g.commandScopes(c), null, c);
            assert.ok(guarded(c), c);
            assert.ok(!hard(c), c);
        }
    });
    test('an unresolvable cd counts as the hook cwd', () => {
        assert.deepEqual(g.commandScopes('cd "$d" && rm -rf .'), ['destructive']);
        assert.ok(!hard('cd - && rm -rf .'));
    });
    test('a resolvable assignment is substituted, not unscoped', () => {
        assert.deepEqual(g.commandScopes('d=build; rm -rf "$d"'), ['destructive']);
        assert.deepEqual(g.commandScopes('export d=./out && rm -rf $d/x'), ['destructive']);
        assert.deepEqual(g.commandScopes('cd build && rm -rf "$(pwd)/x"'), ['destructive']);
    });
    test('osascript delete and move-to-trash, and python -m with a delete-ish module, are unscoped', () => {
        for (const c of [`osascript -e 'tell application "Finder" to delete (POSIX file "/x")'`, `osascript -e 'tell application "Finder" to move x to trash'`,
            'osascript - <<E\ntell application "Finder" to delete item 1\nE', 'python3 -m rmtree_tool x', 'python3 -m send2trash x']) {
            assert.equal(g.commandScopes(c), null, c);
        }
        assert.deepEqual(g.commandScopes(`osascript -e 'display dialog "hi"'`), []);
    });
});

describe('perf and symlinks', () => {
    test('a 50 KB command and a 256 KB script classify within 500 ms each', () => {
        const big = Array.from({ length: 3000 }, (_, i) => `echo "step ${i} rm -rf ~ $(date)" && ls ./d${i}`).join(' ; ').slice(0, 50 * 1024);
        let t0 = Date.now();
        g.commandScopes(big); g.hardBlockReason(big); g.isGuardedCommand(big);
        assert.ok(Date.now() - t0 < 500, `50 KB command took ${Date.now() - t0} ms`);
        const body = Array.from({ length: 6000 }, (_, i) => `x${i} = "value ${i} 'quoted' rmtree(" # don't\nprint(x${i})`).join('\n').slice(0, 255 * 1024);
        fs.writeFileSync(path.join(work, 'big.py'), body);
        t0 = Date.now();
        g.commandScopes('python3 big.py'); g.hardBlockReason('python3 big.py');
        assert.ok(Date.now() - t0 < 500, `256 KB script took ${Date.now() - t0} ms`);
    });
    test('a symlinked script is resolved and its target analysed', () => {
        const target = path.join(work, 'real.js');
        fs.writeFileSync(target, "require('fs').rmSync(process.env.HOME,{recursive:true})");
        const link = path.join(work, 'link.js');
        fs.symlinkSync(target, link);
        assert.ok(hard('node link.js'));
        const ok = path.join(work, 'fine.py');
        fs.writeFileSync(ok, 'print(1)');
        fs.symlinkSync(ok, path.join(work, 'fine-link.py'));
        assert.deepEqual(g.commandScopes('python3 fine-link.py'), []);
    });
    test('a link created after a block counts as fresh even when its target is old', () => {
        const old = path.join(work, 'older.py');
        fs.writeFileSync(old, 'print(1)');
        const past = new Date(Date.now() - 3600e3);
        fs.utimesSync(old, past, past);
        g.setGateContext({ cwd: work, blockTs: Date.now() - 1000 });
        sleep(20);
        fs.symlinkSync(old, path.join(work, 'newlink.py'));
        assert.equal(g.commandScopes('python3 older.py').length, 0);
        assert.equal(g.commandScopes('python3 newlink.py'), null);
    });
});

describe('S4 cooldown keys', () => {
    test('the Claude hook falls back to the transcript path when session_id is missing', () => {
        add(human('hello'));
        const r = gateRaw({ tool_name: 'Bash', tool_input: { command: 'git push origin main' }, transcript_path: t });
        assert.equal(r.status, 2);
        const files = fs.readdirSync(path.join(home, '.aos', 'gate')).filter((f) => f.endsWith('.block'));
        assert.equal(files.length, 1);
        assert.match(files[0], /^x-/);
    });
});

describe('C file-writing tools are never commands', () => {
    test('Write / Edit / MultiEdit / NotebookEdit content is not classified', () => {
        add(human('hello'));
        const content = 'rm -rf ~\nrequire("fs").rmSync(process.env.HOME,{recursive:true})\ngit push origin main';
        for (const tool_name of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
            assert.equal(gateRaw({ tool_name, tool_input: { file_path: '/x/y.js', content, new_string: content }, transcript_path: t, session_id: 's1' }).status, 0, tool_name);
            assert.equal(gateRaw({ tool_name, tool_input: { file_path: '/x/y.js', command: 'rm -rf ~' }, transcript_path: t, session_id: 's1' }).status, 0, `${tool_name} with a command key`);
        }
        assert.equal(run('rm -rf ~').status, 2, 'the same text as a Bash command is blocked');
    });
});

describe('H interpreter code is inspected at execution points', () => {
    test('prose in string literals is not a command (pb4 form passes)', () => {
        assert.ok(!guarded(PB4));
        assert.equal(g.commandScopes(PB4).length, 0);
    });
    test('the pb4 form plus a real spawn is classified by what it spawns', () => {
        const body = PB4.replace("open('a.md', 'w')", `import subprocess\nsubprocess.run(["gh","pr","merge","12"])\nopen('a.md', 'w')`);
        assert.deepEqual(g.commandScopes(body), ['merge']);
        assert.ok(guarded(body));
    });
    test('os.system git push is push-main', () => {
        assert.deepEqual(g.commandScopes('python3 - <<E\nimport os; os.system("git push origin main")\nE'), ['push-main']);
    });
    test('node child_process and ruby/perl spawn points', () => {
        assert.deepEqual(g.commandScopes(`node -e "require('child_process').execSync('git push origin main')"`), ['push-main']);
        assert.deepEqual(g.commandScopes(`node -e "require('child_process').spawnSync('gh',['pr','merge','5'])"`), ['merge']);
        assert.deepEqual(g.commandScopes(`ruby -e "system('git push origin main')"`), ['push-main']);
        assert.deepEqual(g.commandScopes('perl -e \'system("git push origin main")\''), ['push-main']);
        assert.deepEqual(g.commandScopes('ruby - <<E\nx = `git push origin main`\nE'), ['push-main']);
    });
    test('obfuscated or built code is unscoped (guarded, never grantable)', () => {
        for (const c of [
            `python3 -c "import base64;exec(base64.b64decode('aW1wb3J0IG9z'))"`,
            `python3 -c "exec(open('x').read())"`,
            `python3 -c "eval(s)"`,
            `python3 -c "exec(compile(s, 'x', 'exec'))"`,
            `python3 -c "import codecs; codecs.decode('abc','rot13')"`,
            `node -e "eval(process.argv[1])"`,
            `node -e "new Function(code)()"`,
            `node -e "eval(atob('eA=='))"`,
            'python3 - <<E\nexec(s)\nE',
        ]) {
            assert.equal(g.commandScopes(c), null, c);
            assert.ok(guarded(c), c);
        }
    });
    test('re.compile and string mentions of exec are not markers', () => {
        assert.ok(!guarded(`python3 -c "import re; re.compile('exec( eval(')"`));
    });
});

describe('I script files', () => {
    const put = (name, body) => { const f = path.join(work, name); fs.writeFileSync(f, body); return f; };
    test('a node script that removes the home directory is a hard block', () => {
        put('f.js', "require('fs').rmSync(require('os').homedir(),{recursive:true})");
        assert.ok(hard('node f.js'));
        assert.ok(hard(`node ${path.join(work, 'f.js')}`));
        assert.ok(hard('cd ' + work + ' && node f.js'));
        assert.equal(run('node f.js', { cwd: work }).status, 2);
    });
    test('other interpreters and shells read their file', () => {
        put('a.py', 'import shutil, pathlib\nshutil.rmtree(pathlib.Path.home())');
        put('a.rb', "require 'fileutils'\nFileUtils.rm_rf(Dir.home)");
        put('a.sh', 'set -e\nrm -rf $HOME/.cache');
        for (const c of ['python3 a.py', 'python a.py', 'ruby a.rb', 'bash a.sh', 'sh ./a.sh', 'zsh a.sh']) assert.ok(hard(c), c);
    });
    test('script content is classified: destructive, spawn and clean files', () => {
        put('d.js', "require('fs').rmSync('dist',{recursive:true})");
        put('p.py', 'import subprocess\nsubprocess.run(["git","push","origin","main"])');
        put('ok.py', 'print("git push is only prose here")\nopen("x","w").write("rm -rf ~")');
        put('ok.js', "console.log('rm -rf ~', \"require('fs').rmSync(process.env.HOME)\")");
        assert.deepEqual(g.commandScopes('node d.js'), ['destructive']);
        assert.deepEqual(g.commandScopes('python3 p.py'), ['push-main']);
        assert.deepEqual(g.commandScopes('python3 ok.py'), []);
        assert.deepEqual(g.commandScopes('node --test ok.js'), []);
        assert.ok(!hard('node ok.js') && !hard('python3 ok.py'));
    });
    test('missing, oversized and directory targets', () => {
        assert.equal(g.commandScopes('python3 nope.py'), null, 'missing -> unscoped');
        put('big.py', 'x = 1\n'.repeat(60000));
        assert.equal(g.commandScopes('python3 big.py'), null, 'over 256 KB -> unscoped');
        fs.mkdirSync(path.join(work, 'tests'));
        assert.equal(g.commandScopes('node --test tests'), null, 'a directory is not a script: unscoped');
        assert.deepEqual(g.commandScopes('node --version'), []);
        assert.deepEqual(g.commandScopes('python3 -m pytest -q'), []);
    });
    test('node value flags do not hide the script', () => {
        put('h.js', "require('fs').rmSync(process.env.HOME,{recursive:true})");
        put('pre.js', '');
        assert.ok(hard('node --import ./pre.js h.js'));
        assert.ok(hard('node -r ./pre.js h.js arg1'));
    });
});

describe('J block cooldown', () => {
    const blockFile = () => path.join(home, '.aos', 'gate', 's1.block');
    test('a block writes a per-session marker', () => {
        add(human('hello'));
        assert.equal(run('git push origin main').status, 2);
        const ts = JSON.parse(fs.readFileSync(blockFile(), 'utf8')).ts;
        assert.ok(Date.now() - ts < 60000);
    });
    test('a script written after a block needs a GO, an older one is analysed normally', () => {
        add(human('hello'));
        const older = path.join(work, 'older.py');
        fs.writeFileSync(older, 'print("hi")');
        const past = new Date(Date.now() - 3600e3);
        fs.utimesSync(older, past, past);
        assert.equal(run(`python3 ${older}`).status, 0, 'no block yet');
        assert.equal(run('git push origin main').status, 2);
        sleep(30);
        const fresh = path.join(work, 'edit.py');
        fs.writeFileSync(fresh, 'print("harmless")');
        const r = run(`python3 ${fresh}`);
        assert.equal(r.status, 2);
        assert.match(r.stderr, /blocked recently; a freshly written script after a block needs a GO; stop and report/);
        assert.equal(run(`python3 ${older}`).status, 0, 'older than the marker: normal analysis');
        assert.equal(run(`cd ${work} && python3 edit.py`).status, 2, 'relative path after cd');
        add(human('GO'));
        assert.equal(run(`python3 ${fresh}`).status, 0, 'a fresh literal GO opens it');
    });
    test('the cooldown is not lifted by a grant or mode off, and expires after 10 minutes', () => {
        add(human('hello'));
        typed('gogate off');
        add(human('go on'));
        assert.equal(run('git push origin main').status, 0, 'off allows guarded commands, so no marker yet');
        fs.mkdirSync(path.join(home, '.aos', 'gate'), { recursive: true });
        fs.writeFileSync(blockFile(), JSON.stringify({ ts: Date.now() }));
        sleep(30);
        const fresh = path.join(work, 'edit.py');
        fs.writeFileSync(fresh, 'print("harmless")');
        assert.equal(run(`python3 ${fresh}`).status, 2, 'mode off does not lift it');
        fs.writeFileSync(blockFile(), JSON.stringify({ ts: Date.now() - 11 * 60e3 }));
        assert.equal(run(`python3 ${fresh}`).status, 0, 'expired');
    });
    test('the marker is not renewed inside its window', () => {
        add(human('hello'));
        run('git push origin main');
        const first = JSON.parse(fs.readFileSync(blockFile(), 'utf8')).ts;
        sleep(30);
        run('git push origin main');
        assert.equal(JSON.parse(fs.readFileSync(blockFile(), 'utf8')).ts, first);
    });
});

describe('policy: files and dotfiles directly in home need a GO, directories are hard', () => {
    beforeEach(() => {
        fs.writeFileSync(path.join(home, '.DS_Store'), 'x');
        fs.writeFileSync(path.join(home, '.zshrc.bak'), 'x');
        fs.symlinkSync(path.join(home, '.zshrc.bak'), path.join(home, '.zshrc'));
        fs.mkdirSync(path.join(home, 'Documents'));
    });
    const needsGo = (c) => { assert.ok(!hard(c), `hard: ${c}`); assert.equal(g.commandScopes(c), null, `not unscoped: ${c}`); assert.ok(guarded(c), c); };
    test('one regular file or symlink in home: guarded, unscoped, not hard', () => {
        for (const c of ['rm ~/.DS_Store', 'rm -f ~/.DS_Store', 'rm -rf ~/.DS_Store', 'unlink ~/.zshrc', 'mv ~/.zshrc.bak ~/.zshrc', 'shred ~/.DS_Store',
            'rm $HOME/.DS_Store', 'rm ~/missing.txt', 'rmdir ~/Documents', 'rm ~/*.log', 'cd ~ && rm *', 'cd ~ && rm .DS_Store', 'rm ~/.zshrc', 'rm -f $HOME/notes.txt', 'unlink ~/.profile',
            `node -e "require('fs').unlinkSync(process.env.HOME + '/.zshrc')"`, `python3 -c "import os; os.remove(os.environ['HOME'] + '/.zshrc')"`,
            `node -e "require('fs').rmSync(os.homedir()+'/.ssh')"`]) needsGo(c);
    });
    test('a directory in home, or a glob, with a recursive delete or a move is hard', () => {
        for (const c of ['rm -rf ~/Documents', 'mv ~/Documents /tmp', 'rm -rf ~/*', 'mv ~/* /tmp', 'rm -rf ~/{a,b}', 'rm -rf ~/.config', 'rm -rf ~/Library', 'cd ~ && rm -rf .',
            'rsync -a --delete /tmp/e/ ~/Documents', 'chmod -R 700 ~/Documents', 'find ~/Documents -delete']) assert.ok(hard(c), c);
    });
    test('overwriting a dotfile directly in home needs a GO; appends and deeper paths do not', () => {
        for (const c of [': > ~/.x', '> ~/.x', 'echo hi > $HOME/.zshrc', 'truncate -s 0 ~/.x', 'dd if=/dev/zero of=~/.x', 'cp /dev/null ~/.x', 'ln -sf /tmp/a ~/.x', 'tee ~/.x', 'echo hi | tee ~/.profile',
            'cat > ~/.zshrc <<\'EOF\'\nx\nEOF', 'cd ~ && echo x > .bashrc']) needsGo(c);
        for (const c of ['echo hi >> ~/.x', 'echo hi | tee -a ~/.x', 'echo hi > ~/notes.txt', 'echo hi > /tmp/x', 'echo hi > ~/dev/.x', 'ls > /dev/null', 'cp a ~/dev/b']) {
            assert.ok(!hard(c), c);
            assert.ok(!guarded(c), c);
        }
    });
    test('a blanket destructive grant does not cover them; a plain GO does', () => {
        add(human('hello'));
        typed('gogate grant destructive 1h');
        add(human('go on'));
        assert.equal(run('rm -rf ./build').status, 0, 'destructive grant works for normal deletes');
        assert.equal(run('rm ~/.DS_Store').status, 2);
        assert.equal(run('echo x > ~/.x').status, 2);
        assert.equal(run('rm -rf ~/Documents').status, 2);
        add(human('GO'));
        assert.equal(run('rm ~/.DS_Store').status, 0, 'a literal GO opens a file delete');
        assert.equal(run('rm -rf ~/Documents').status, 2, 'but never a hard block');
    });
});

describe('fail closed: file I/O, length, types, pathological input', () => {
    test('devices, FIFOs, directories and links to them are unscoped and never read', () => {
        const t0 = Date.now();
        for (const c of ['python3 /dev/zero', 'node /dev/urandom', 'bash /dev/zero', 'python3 /dev']) assert.equal(g.commandScopes(c), null, c);
        fs.symlinkSync('/dev/zero', path.join(work, 'z.py'));
        assert.equal(g.commandScopes('python3 z.py'), null);
        const fifo = path.join(work, 'f.py');
        if (spawnSync('mkfifo', [fifo]).status === 0) assert.equal(g.commandScopes(`python3 ${fifo}`), null);
        assert.ok(Date.now() - t0 < 2000, 'nothing blocked on a read');
    });
    test('a file over the cap is unscoped, and one at the cap is read', () => {
        fs.writeFileSync(path.join(work, 'cap.py'), 'x = 1\n'.repeat(43700).slice(0, 256 * 1024));
        assert.deepEqual(g.commandScopes('python3 cap.py'), []);
        fs.writeFileSync(path.join(work, 'over.py'), 'x'.repeat(256 * 1024 + 1));
        assert.equal(g.commandScopes('python3 over.py'), null);
    });
    test('the shell text is checked for a hard block before any script file is opened', () => {
        const t0 = Date.now();
        assert.ok(hard('rm -rf ~; python3 /dev/zero'));
        assert.ok(hard('python3 /dev/zero; rm -rf ~'));
        assert.ok(Date.now() - t0 < 1000);
    });
    test('a command over 16 KB is guarded, unscoped, never hard, and only a GO lifts it', () => {
        const long = `echo ${'a'.repeat(17000)}`;
        assert.ok(guarded(long));
        assert.equal(g.commandScopes(long), null);
        assert.ok(!hard(long));
        add(human('hello'));
        typed('gogate grant destructive 1h');
        typed('gogate grant push-feature 1h');
        add(human('go on'));
        const r = run(long);
        assert.equal(r.status, 2);
        assert.match(r.stderr, /command too long for the gate; split it or ask for GO/);
        assert.doesNotMatch(r.stderr, /unconditional/);
        typed('gogate off');
        add(human('go on'));
        assert.equal(run(long).status, 2, 'mode off does not lift it');
        add(human('GO'));
        assert.equal(run(long).status, 0);
        assert.equal(run(`echo ${'a'.repeat(100)}`).status, 0, 'a normal command is unaffected');
    });
    test('argv arrays are joined; any other non-string command is refused', () => {
        add(human('hello'));
        const send = (command) => gateRaw({ tool_name: 'Bash', tool_input: { command }, transcript_path: t, session_id: 's1' });
        assert.equal(send(['rm', '-rf', '~']).status, 2);
        assert.match(send(['rm', '-rf', '~']).stderr, /unconditional/);
        assert.equal(send(['echo', 'hi']).status, 0);
        for (const bad of [{ a: 1 }, 5, true]) assert.equal(send(bad).status, 2, JSON.stringify(bad));
    });
    test('pathological input is decided quickly', () => {
        for (const [name, s] of [['${', '${'.repeat(4000)], ['backticks', '`'.repeat(8000)], ['$(', '$('.repeat(4000)], ['mixed', '`$(${'.repeat(2500)], ['quotes', '"\'`'.repeat(5000)], ['parens', '('.repeat(8000)]]) {
            const c = s.slice(0, 16 * 1024);
            const t0 = Date.now();
            g.hardBlockReason(c); g.gateStoreReason(c); g.isGuardedCommand(c); // what the hook decides with
            assert.ok(Date.now() - t0 < 200, `${name} took ${Date.now() - t0} ms`);
        }
        const t1 = Date.now();
        add(human('hello'));
        run('${'.repeat(4000));
        assert.ok(Date.now() - t1 < 3000, 'the whole hook returns promptly');
    });
});

describe('aos-22 read-only npm lookups and loops', () => {
    test('npm view/info/show/v is never guarded, alone or in loops, with or without sudo/time/watch', () => {
        const pkg = '@hybridlabor-api/bdb-agent-orchestrator@1.5.0';
        for (const c of [`npm view ${pkg} version`, `npm view ${pkg} version --prefer-online`, `npm info ${pkg} version`, `npm show ${pkg}`, `npm v ${pkg} dist-tags`, `pnpm view ${pkg} version`,
            `until npm view ${pkg} version --prefer-online; do sleep 30; done`,
            `while ! npm view ${pkg} version; do sleep 5; done`, `for i in 1 2 3; do npm view ${pkg} version; sleep 1; done`,
            `if npm view ${pkg} version; then echo ok; fi`, `time npm view ${pkg} version`, `sudo npm view ${pkg} version`, `watch npm view ${pkg} version`, `bash -c 'npm view ${pkg} version'`,
            `until npm view ${pkg} version --prefer-online; do sleep 30; done`.replace('until', 'while ! ')]) {
            assert.ok(!guarded(c), c);
            assert.deepEqual(g.commandScopes(c), [], c);
        }
    });
    test('npm version and publish stay guarded, also inside loops', () => {
        for (const c of ['npm version patch', 'npm version 1.5.1 --no-git-tag-version', 'npm publish', 'pnpm version minor',
            'until false; do npm version patch; done', 'for i in 1; do npm version patch; done', 'while true; do npm publish; done',
            'if true; then npm version patch; fi', 'until npm view x version; do npm version patch; done', 'npm view x version; npm version patch', 'watch npm version patch']) {
            assert.ok(guarded(c), c);
            assert.ok(g.commandScopes(c) === null || g.commandScopes(c).includes('publish'), c);
        }
        assert.deepEqual(g.commandScopes('until false; do npm version patch; done'), ['publish']);
    });
    test('the hook allows the lookup loop with a merge/github-write/push-feature/publish grant active', () => {
        add(human('hello'));
        typed('gogate grant merge,github-write,push-feature,publish 1h');
        add(human('go on'));
        assert.equal(run('until npm view @a/b@1.5.0 version --prefer-online; do sleep 30; done').status, 0);
        assert.equal(run('npm version patch').status, 0, 'publish is granted, so the grant covers it');
    });
});

describe('F-B2 pipelines that feed a shell, and programs that execute', () => {
    test('data is not blanked when ANY later stage is a shell or interpreter', () => {
        for (const c of ["echo 'rm -rf ~' | tee /dev/null | sh", "echo 'rm -rf ~' | (bash)", "echo 'git push origin main' | tee /dev/null | sh",
            "echo 'git push origin main' | cat | cat | bash", "printf 'git push origin main' | xargs -I{} sh -c {}"]) assert.ok(guarded(c), c);
        assert.ok(!guarded("echo 'git push origin main' | tee /dev/null | cat"));
    });
    test('awk and sed programs that run commands are not blanked', () => {
        for (const c of [`awk 'BEGIN{system("git push origin main")}'`, `sed -n '1e git push origin main' f`, `sed 's/x/git push origin main/e' f`, `awk 'BEGIN{"git push origin main" | getline}'`]) assert.ok(guarded(c), c);
        for (const c of ["awk '/rm -rf/ {print}' notes.txt", "sed -n '/rmSync(process.env.HOME)/p' file.js", "sed -e 's/rm -rf/x/' f", "awk '{print $1}' f"]) assert.ok(!guarded(c), c);
    });
});

describe('cooldown marker and store guard', () => {
    test('a marker from the future counts as written now', () => {
        fs.mkdirSync(path.join(home, '.aos', 'gate'), { recursive: true });
        fs.writeFileSync(path.join(home, '.aos', 'gate', 'fut.block'), JSON.stringify({ ts: Date.now() + 1e9 }));
        const saved = process.env.HOME;
        process.env.HOME = home;
        try { assert.ok(g.readBlockTs('fut') <= Date.now()); } finally { process.env.HOME = saved; }
    });
    test('cd into ~/.aos followed by a relative gate/ or go/ write is blocked, a read is not', () => {
        for (const c of ['cd ~/.aos && rm -rf gate/s1.json', 'cd "$HOME/.aos"; echo x > go/w.token', 'cd ../.aos && tee gate/x', 'cd ~/.aos\nmv gate/a gate/b', 'cd /x/.aos/ && cp y go/k']) assert.ok(g.gateStoreReason(c), c);
        for (const c of ['cd ~/.aos && cat gate/s1.json', 'cd ~/.aos && ls go', 'cd ~/.aos && ls']) assert.equal(g.gateStoreReason(c), null, c);
    });
});

describe('not-human messages never open the gate', () => {
    test('task-notification, peer and sdk entries are no GO', () => {
        add(human('hello'));
        for (const extra of [{ origin: { kind: 'task-notification' } }, { origin: { kind: 'peer' } }, { origin: { kind: 'coordinator' } }, { promptSource: 'sdk' }]) {
            add(user('GO', extra));
            assert.equal(run('git push origin main').status, 2, JSON.stringify(extra));
            assert.equal(run('rm -rf ./build').status, 2, JSON.stringify(extra));
        }
        add(human('GO'));
        assert.equal(run('rm -rf ./build').status, 0);
    });
});
