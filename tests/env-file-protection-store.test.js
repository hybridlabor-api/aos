// WP-9b: env-file-protection denies every file-tool write into the go-gate store (~/.aos/gate, ~/.aos/go),
// whatever the tool, key name, path spelling or symlink layout. Offline: temp HOME per test (left in place),
// the real hook runs as a child process. Nothing is written into the store.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const HOOK = path.join(REPO, '.claude', 'hooks', 'env-file-protection.mjs');

let home;
beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-envp-'));
    fs.mkdirSync(path.join(home, '.aos', 'gate'), { recursive: true });
    fs.mkdirSync(path.join(home, '.aos', 'go'), { recursive: true });
    fs.mkdirSync(path.join(home, '.aos', 'briefs'), { recursive: true });
    fs.mkdirSync(path.join(home, 'work'), { recursive: true });
});

const runRaw = (input) => spawnSync(process.execPath, [HOOK], { input, env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 20000 });
const run = (obj) => runRaw(JSON.stringify(obj));
const TOOLS = [
    ['Write', (p, extra) => ({ tool_name: 'Write', tool_input: { file_path: p }, ...extra })],
    ['Edit', (p, extra) => ({ tool_name: 'Edit', tool_input: { file_path: p }, ...extra })],
    ['MultiEdit', (p, extra) => ({ tool_name: 'MultiEdit', tool_input: { file_path: p, edits: [] }, ...extra })],
    ['NotebookEdit', (p, extra) => ({ tool_name: 'NotebookEdit', tool_input: { notebook_path: p, new_source: 'x' }, ...extra })],
];
const blocked = (p, extra) => { for (const [name, mk] of TOOLS) { const r = run(mk(p, extra)); assert.equal(r.status, 2, `${name} ${p} should be blocked: ${r.stderr}`); } };
const allowed = (p, extra) => { for (const [name, mk] of TOOLS) { const r = run(mk(p, extra)); assert.equal(r.status, 0, `${name} ${p} should be allowed: ${r.stderr}`); } };

describe('store paths are denied for every file tool', () => {
    test('credential, receipts, tokens, grants and the directories themselves', () => {
        blocked(path.join(home, '.aos', 'gate', 'trail-credential.json'));
        blocked(path.join(home, '.aos', 'go', 's1.click-x.json'));
        blocked(path.join(home, '.aos', 'go', 's1.click-g-abc.json.used'));
        blocked(path.join(home, '.aos', 'go', '.consumed'));
        blocked(path.join(home, '.aos', 'gate', 's1.revoke.json'));
        blocked(path.join(home, '.aos', 'gate'));
        blocked(path.join(home, '.aos', 'go'));
        blocked('~/.aos/gate/new.json');
    });

    test('case variants (APFS is case-insensitive)', () => {
        blocked(path.join(home, '.AOS', 'Gate', 'x'));
        blocked(path.join(home, '.Aos', 'GO', 'x'));
    });

    test('relative paths resolve against the hook input cwd', () => {
        blocked('.aos/gate/x.json', { cwd: home });
        blocked('../.aos/go/x.json', { cwd: path.join(home, 'work') });
        blocked('gate/x.json', { cwd: path.join(home, '.aos') });
    });

    test('.. traversal is resolved', () => {
        blocked(path.join(home, 'work', '..', '.aos', 'gate', 'x.json'));
        blocked(path.join(home, 'work', 'a', '..', '..', '.aos', 'go', 'x.json'));
        blocked(path.join(home, '.aos', 'briefs', '..', 'gate', 'x.json'));
    });

    test('a symlinked directory anywhere above the target, with missing parents and leaf', () => {
        fs.symlinkSync(path.join(home, '.aos'), path.join(home, 'link-aos'));
        fs.symlinkSync(path.join(home, '.aos', 'gate'), path.join(home, 'work', 'link-gate'));
        blocked(path.join(home, 'link-aos', 'gate', 'x.json'));
        blocked(path.join(home, 'link-aos', 'gate', 'new-dir', 'deeper', 'x.json'));
        blocked(path.join(home, 'work', 'link-gate', 'x.json'));
        blocked(path.join(home, 'work', 'link-gate', 'missing', 'x.json'));
        blocked(path.join(home, 'work', 'link-gate'));
    });

    test('a symlinked file, also a dangling one, pointing into the store', () => {
        fs.symlinkSync(path.join(home, '.aos', 'gate', 'does-not-exist.json'), path.join(home, 'work', 'dangling.json'));
        fs.writeFileSync(path.join(home, '.aos', 'gate', 'real.json'), '{}');
        fs.symlinkSync(path.join(home, '.aos', 'gate', 'real.json'), path.join(home, 'work', 'live.json'));
        blocked(path.join(home, 'work', 'dangling.json'));
        blocked(path.join(home, 'work', 'live.json'));
    });

    test('a chain of symlinks (link to link to the store)', () => {
        fs.symlinkSync(path.join(home, '.aos', 'go'), path.join(home, 'hop2'));
        fs.symlinkSync(path.join(home, 'hop2'), path.join(home, 'hop1'));
        blocked(path.join(home, 'hop1', 'x.json'));
    });
});

describe('other harness shapes', () => {
    const target = () => path.join(home, '.aos', 'gate', 'trail-credential.json');

    test('OpenCode: filePath and apply_patch patchText', () => {
        assert.equal(run({ tool_input: { filePath: target() } }).status, 2);
        const patch = `*** Begin Patch\n*** Add File: ${target()}\n+x\n*** End Patch`;
        assert.equal(run({ tool_input: { patchText: patch } }).status, 2);
        assert.equal(run({ args: { patchText: `*** Begin Patch\n*** Update File: ok.txt\n*** Move to: ${target()}\n*** End Patch` } }).status, 2);
        assert.equal(run({ tool_input: { patchText: '*** Begin Patch\n*** Add File: notes/ok.txt\n+x\n*** End Patch' } }).status, 0);
    });

    test('agy: toolCall.args with the file key spellings', () => {
        for (const key of ['filePath', 'file_path', 'TargetFile', 'AbsolutePath']) {
            const r = run({ toolCall: { name: 'write_to_file', args: { [key]: target() } } });
            assert.equal(r.status, 0, `${key}: agy answers on stdout, exit 0`);
            assert.equal(JSON.parse(r.stdout).decision, 'deny', key);
        }
        assert.equal(JSON.parse(run({ toolCall: { args: { TargetFile: path.join(home, 'work', 'ok.txt') } } }).stdout).decision, 'allow');
    });

    test('top-level file_path (legacy shape)', () => {
        assert.equal(run({ file_path: target() }).status, 2);
    });
});

describe('unparseable input', () => {
    test('input that names the store is denied, with plain and JSON-escaped slashes', () => {
        assert.equal(runRaw('{"tool_input":{"file_path":"/home/u/.aos/gate/x.json"').status, 2);
        assert.equal(runRaw('{"tool_input":{"file_path":"\\/home\\/u\\/.aos\\/go\\/x"').status, 2);
        assert.equal(runRaw('garbage ~/.AOS/Gate/x').status, 2);
    });

    test('other unparseable input still passes (the hook must not wedge every write)', () => {
        assert.equal(runRaw('{ this is not json').status, 0);
        assert.equal(runRaw('{"tool_input":{"file_path":"/home/u/notes.md"').status, 0);
    });

    test('empty stdin and a JSON non-object pass', () => {
        assert.equal(runRaw('').status, 0);
        assert.equal(runRaw('null').status, 0);
        assert.equal(runRaw('"x"').status, 0);
        assert.equal(runRaw('[]').status, 0);
    });
});

describe('round 2: no caps, patch forms, symlink limits', () => {
    const store = () => path.join(home, '.aos', 'gate', 'trail-credential.json');
    const patchRun = (patchText, key = 'patchText') => run({ tool_input: { [key]: patchText }, cwd: home });

    test('a path longer than 4096 characters is still checked', () => {
        const padded = `${home}/${'./'.repeat(3000)}.aos/gate/x.json`;
        assert.ok(padded.length > 4096);
        blocked(padded);
        const paddedGo = `${'../'.repeat(2000)}${home}/.aos/go/x.json`;
        assert.ok(paddedGo.length > 4096);
        blocked(paddedGo);
        allowed(`${home}/${'./'.repeat(3000)}work/ok.txt`);
    });

    test('more than 256 patch targets, the store path last', () => {
        const lines = [];
        for (let i = 0; i < 300; i += 1) lines.push(`*** Add File: work/f${i}.txt`);
        assert.equal(patchRun(`*** Begin Patch\n${lines.join('\n')}\n*** End Patch`).status, 0);
        lines.push(`*** Add File: ${store()}`);
        assert.equal(patchRun(`*** Begin Patch\n${lines.join('\n')}\n*** End Patch`).status, 2);
    });

    test('patch text over 1 MiB is parsed like any other: store and .env lines are denied, the rest passes', () => {
        const pad = `*** Add File: work/pad.txt\n+${'x'.repeat(1 << 20)}\n`;
        assert.equal(patchRun(`${pad}*** End Patch`).status, 0);
        assert.equal(patchRun(`${pad}*** Add File: ${store()}\n`).status, 2);
        assert.equal(patchRun(`${pad}*** Add File: .aos/go/x\n`).status, 2);
        assert.equal(patchRun(`${pad}*** Update File: ${path.join(home, 'work', '.env')}\n`).status, 2);
        assert.equal(patchRun(`${pad}*** Update File: ${path.join(home, 'work', '.env.example')}\n`).status, 0);
    });

    test('20000 blank lines and whitespace runs before a store line do not time out', () => {
        const started = Date.now();
        const text = `*** Begin Patch\n${'\n'.repeat(20000)}${' \t'.repeat(20000)}\n${'\n'.repeat(20000)}*** Add File: ${store()}\n`;
        assert.equal(patchRun(text).status, 2);
        assert.ok(Date.now() - started < 15000);
    });

    test('.. after a symlinked directory is resolved by the OS, not collapsed textually', () => {
        fs.symlinkSync(path.join(home, '.aos', 'gate'), path.join(home, 'work', 's'));
        fs.symlinkSync('s/../gate/n.json', path.join(home, 'work', 'd')); // s/.. is ~/.aos, so this lands in ~/.aos/gate
        blocked(path.join(home, 'work', 'd'));
        blocked(path.join(home, 'work', 's') + '/../gate/n.json'); // path.join would collapse the ".." before the hook sees it
        blocked('s/../go/x.json', { cwd: path.join(home, 'work') });
        allowed(path.join(home, 'work', 'plain', '..', 'ok.txt'));
    });

    test('Delete File, Move to and indented patch lines, in every patch key', () => {
        for (const key of ['patchText', 'patch', 'input']) {
            assert.equal(patchRun(`*** Begin Patch\n*** Delete File: ${store()}\n*** End Patch`, key).status, 2, key);
            assert.equal(patchRun(`*** Update File: a.txt\n*** Move to: ${store()}`, key).status, 2, key);
            assert.equal(patchRun(`*** Begin Patch\n   *** Add File: ${store()}\n*** End Patch`, key).status, 2, key);
            assert.equal(patchRun(`\t*** Delete File: ${store()}`, key).status, 2, key);
            assert.equal(patchRun('*** Begin Patch\n*** Delete File: work/ok.txt\n*** End Patch', key).status, 0, key);
        }
    });

    test('targetsOf is exported and has no limits', async () => {
        const { pathToFileURL } = require('url');
        const m = await import(pathToFileURL(HOOK).href);
        const long = `/${'a/'.repeat(3000)}x`;
        assert.deepEqual(m.targetsOf({ tool_input: { file_path: long } }), [long]);
        assert.deepEqual(m.targetsOf({ args: { filePath: 'a', patchText: '*** Delete File: b\n  *** Add File: c' } }), ['a', 'b', 'c']);
        assert.deepEqual(m.targetsOf(null), []);
        assert.equal(m.envFileReason(path.join(home, '.aos', 'go', 'x')) !== null, true);
        assert.equal(m.envFileReason('/srv/app/.env') !== null, true);
    });

    const chain = (n, end) => {
        for (let i = 0; i < n; i += 1) fs.symlinkSync(i === n - 1 ? end : path.join(home, 'work', `hop${i + 1}`), path.join(home, 'work', `hop${i}`));
        return path.join(home, 'work', 'hop0');
    };

    test('a 41-hop dangling chain fails closed, a short chain to a harmless target is allowed', () => {
        blocked(chain(41, path.join(home, '.aos', 'gate', 'nope.json')));
        const short = path.join(home, 'work', 'short');
        fs.mkdirSync(short);
        fs.symlinkSync(path.join(home, 'work', 'nowhere.txt'), path.join(short, 'a'));
        fs.symlinkSync(path.join(short, 'a'), path.join(short, 'b'));
        allowed(path.join(short, 'b'));
    });

    test('a symlink loop is denied', () => {
        fs.symlinkSync(path.join(home, 'work', 'loop-b'), path.join(home, 'work', 'loop-a'));
        fs.symlinkSync(path.join(home, 'work', 'loop-a'), path.join(home, 'work', 'loop-b'));
        blocked(path.join(home, 'work', 'loop-a'));
        blocked(path.join(home, 'work', 'loop-a', 'deeper', 'x'));
    });
});

describe('everything else is still allowed', () => {
    test('the repo tests dir, briefs, lookalike names, ordinary files', () => {
        allowed(path.join(REPO, 'tests', 'x.test.js'));
        allowed(path.join(home, '.aos', 'briefs', 'wp9.md'));
        allowed(path.join(home, '.aos', 'bus', 'x.json'));
        allowed(path.join(home, '.aos', 'gogate.md'));
        allowed(path.join(home, 'notes', 'gate.md'));
        allowed(path.join(home, 'work', 'go', 'x.json'));
        allowed('relative/ok.txt', { cwd: path.join(home, 'work') });
        allowed(path.join(home, 'work', 'not-yet', 'there', 'x.json'));
    });

    test('a symlinked directory that stays outside the store', () => {
        fs.symlinkSync(path.join(home, '.aos', 'briefs'), path.join(home, 'work', 'link-briefs'));
        allowed(path.join(home, 'work', 'link-briefs', 'x.md'));
    });

    test('empty and missing paths', () => {
        assert.equal(run({ tool_input: { file_path: '' } }).status, 0);
        assert.equal(run({ tool_input: {} }).status, 0);
        assert.equal(run({}).status, 0);
    });

    test('.env files stay protected, templates stay writable', () => {
        assert.equal(run({ tool_input: { file_path: path.join(home, 'work', '.env') } }).status, 2);
        assert.equal(run({ tool_input: { file_path: path.join(home, 'work', '.env.example') } }).status, 0);
    });
});
