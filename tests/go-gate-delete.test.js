// Delete classification, the unconditional home hard block, data-vs-command false positives,
// interpreter code and script files, and the block cooldown. Offline; the hook runs as a child
// process with HOME set to a fresh temp dir. Nothing here deletes anything: temp dirs stay.
const { test, describe, beforeEach, before } = require('node:test');
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
    g.setGateContext({ cwd: work, blockTs: 0 });
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
    `python3 -c "import subprocess; subprocess.run(['rm','-rf','build'])"`,
    `node -e "require('child_process').execSync('rm -rf build')"`,
    `node -e "require('fs').rmSync(require('path').join(require('os').homedir(),'dev','x','build'),{recursive:true})"`,
];

const HARD = [
    `node -e 'require("fs").rmSync(process.env.HOME,{recursive:true,force:true})'`,
    `python3 -c "import shutil, pathlib; shutil.rmtree(pathlib.Path.home())"`,
    'rm -rf ~', 'rm -rf ~/', 'rm -rf $HOME', 'rm -rf "$HOME"', 'rm -rf "${HOME}"', 'rm -rf ${HOME}', 'rm -rf ~/.config', 'rm -rf $HOME/.claude',
    'rm -rf /Users/timrennings', 'rm -rf /Users/timrennings/Library', 'rm -rf /home/tim', 'rm -rf /home/tim/.ssh',
    'find ~ -delete', 'find $HOME -maxdepth 1 -delete', 'rm -rf /', 'rm -rf *', 'rm -rf /*',
    'bash -c "rm -rf ~"', "sh -c 'rm -rf $HOME/.ssh'", 'sudo rm -rf ~', '(rm -rf ~)', 'true && rm -rf ~',
    'Remove-Item -Recurse $env:USERPROFILE', 'Remove-Item -Recurse -Force $env:HOME', 'rd /s /q C:\\Users\\tim', 'rd /s /q C:\\Users\\tim\\AppData',
    'rm ~/.zshrc', 'rm -f $HOME/notes.txt', 'rmdir ~/Documents', 'unlink ~/.profile', 'rm -rf %USERPROFILE%',
    `node -e "require('fs').rmSync(require('os').homedir(),{recursive:true})"`,
    `node -e "require('fs').rmSync(require('path').join(require('os').homedir(),'.config'),{recursive:true})"`,
    `node -e "require('fs').rmSync(os.homedir()+'/.ssh')"`,
    `node -e "require('fs').unlinkSync(process.env.HOME + '/.zshrc')"`,
    `python3 -c "import shutil,os; shutil.rmtree(os.path.expanduser('~'))"`,
    `python3 -c "import shutil,os; shutil.rmtree(os.path.expanduser('~/.config'))"`,
    `python3 -c "import shutil,os; shutil.rmtree(os.environ['HOME'])"`,
    `python3 -c "import os; os.remove(os.environ['HOME'] + '/.zshrc')"`,
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
        for (const p of ['~', '~/x', '$HOME/x', '/Users/a', '/Users/a/b', '/home/a/b', 'C:\\Users\\a', 'C:\\Users\\a\\b', '/', '*']) assert.ok(g.isHomeLevel(p), p);
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
    test('the OpenCode/ACP/go-check callers see the same function', async () => {
        const chk = await import(pathToFileURL(path.resolve(__dirname, '..', 'bin', 'go-check.mjs')).href);
        const r = chk.check(g, { session: 'w', command: 'rm -rf ~', consume: false });
        assert.equal(r.code, 1);
        assert.match(r.out.reason, /unconditional/);
        const acp = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'aos-acp.mjs'), 'utf8');
        const oc = fs.readFileSync(path.resolve(__dirname, '..', '.opencode', 'plugins', 'bdb-aos.js'), 'utf8');
        assert.match(acp, /hardBlockReason\(cmd\)/);
        assert.match(oc, /hardBlockReason\(cmd\)/);
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
        assert.deepEqual(g.commandScopes('node --test tests'), []);
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
