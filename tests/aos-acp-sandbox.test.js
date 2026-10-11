const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const REPO = path.resolve(__dirname, '..');
const load = (f) => import(pathToFileURL(path.join(REPO, f)).href);
const has = (...bins) => (b) => (bins.includes(b) ? `/bin/${b}` : null);

describe('aos-acp --sandbox', () => {
    test('parseArgs accepts --sandbox; absent by default', async () => {
        const { parseArgs } = await load('bin/aos-acp.mjs');
        assert.strictEqual(parseArgs(['codex', '--name', 'w', '--prompt', 'p', '--sandbox', 'coop']).sandbox, 'coop');
        assert.strictEqual(parseArgs(['codex', '--name', 'w', '--prompt', 'p']).sandbox, undefined);
    });

    test('no flag: run() never resolves or wraps', async () => {
        const { run } = await load('bin/aos-acp.mjs');
        const fs = require('fs'), os = require('os');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-sbx-'));
        let touched = false;
        const fake = `${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(__dirname, 'fixtures', 'fake-acp-agent.mjs'))}`;
        const code = await run({ adapter: 'codex', name: 'sbx-off', prompt: 'p', cwd: dir, allowDefault: 'deny', goWait: 0, cmd: fake, log: path.join(dir, 'l.jsonl'), stdout: { write() {} }, resolveSandbox: () => { touched = true; } });
        assert.strictEqual(touched, false);
        assert.ok(code === 0 || code === 1);
        const start = JSON.parse(fs.readFileSync(path.join(dir, 'l.jsonl'), 'utf8').split('\n')[0]);
        assert.strictEqual('sandbox' in start, false);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('unknown provider and missing binary throw with reason', async () => {
        const { resolveSandbox } = await load('lib/sandbox.mjs');
        assert.throws(() => resolveSandbox('docker', { platform: 'linux', which: has() }), /unknown sandbox provider "docker"/);
        assert.throws(() => resolveSandbox('coop', { platform: 'linux', which: has(), env: {} }), /coop binary not found/);
        assert.throws(() => resolveSandbox('coop', { platform: 'win32', which: has('coop'), env: {} }), /macOS\/Linux/);
        assert.throws(() => resolveSandbox('coop', { platform: 'darwin', which: has('coop'), env: {} }), /AOS_SANDBOX_COOP_CMD is unset/);
        assert.throws(() => resolveSandbox('wsl2', { platform: 'win32', which: has() }), /WSL2 not found/);
    });

    test('coop wrap expands the template', async () => {
        const { resolveSandbox } = await load('lib/sandbox.mjs');
        const env = { AOS_SANDBOX_COOP_CMD: 'coop run --dir {cwd} -- {cmd}' };
        const p = resolveSandbox('coop', { platform: 'darwin', which: has('coop'), env });
        assert.deepStrictEqual(p.wrap(['npx', '-y', 'x'], { cwd: '/w/a', env }), ['coop', 'run', '--dir', '/w/a', '--', 'npx', '-y', 'x']);
    });

    test('wsl2 path conversion and wrap form', async () => {
        const { winToWslPath, resolveSandbox } = await load('lib/sandbox.mjs');
        assert.strictEqual(winToWslPath('C:\\Users\\tim\\proj'), '/mnt/c/Users/tim/proj');
        assert.strictEqual(winToWslPath('D:\\'), '/mnt/d');
        const p = resolveSandbox('wsl2', { platform: 'win32', which: has('wsl.exe') });
        assert.deepStrictEqual(p.wrap(['agy', '--print'], { cwd: 'C:\\x' }), ['wsl.exe', '--cd', '/mnt/c/x', '--exec', 'agy', '--print']);
        assert.throws(() => p.wrap(['agy'], { cwd: '\\\\srv\\share' }), /drive path/);
    });

    test('coop template must carry {cmd}; $ in cwd stays literal', async () => {
        const { resolveSandbox } = await import('../lib/sandbox.mjs');
        const which = (b) => (b === 'coop' ? '/bin/coop' : null);
        assert.throws(() => resolveSandbox('coop', { platform: 'darwin', which, env: { AOS_SANDBOX_COOP_CMD: 'coop run {cwd}' } }), /\{cmd\}/);
        const p = resolveSandbox('coop', { platform: 'darwin', which, env: { AOS_SANDBOX_COOP_CMD: 'coop run --dir {cwd} -- {cmd}' } });
        assert.deepStrictEqual(p.wrap(['agy', 'a b'], { cwd: '/p/$&x', env: { AOS_SANDBOX_COOP_CMD: 'coop run --dir {cwd} -- {cmd}' } }), ['coop', 'run', '--dir', '/p/$&x', '--', 'agy', 'a b']);
    });

    test('wsl2 on darwin is not available', async () => {
        const { PROVIDERS } = await load('lib/sandbox.mjs');
        const r = PROVIDERS.wsl2.available('darwin', has('wsl.exe'));
        assert.strictEqual(r.ok, false);
        assert.match(r.reason, /only available on Windows/);
    });
});
