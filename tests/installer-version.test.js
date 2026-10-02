const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const { version } = require('../package.json');

function run(arg) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-ver-'));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-ver-cwd-'));
    try {
        const started = Date.now();
        const r = spawnSync(process.execPath, [path.join(root, 'installer.js'), arg], {
            cwd,
            env: { ...process.env, HOME: home, USERPROFILE: home },
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 10000,
            encoding: 'utf8',
        });
        return { r, ms: Date.now() - started, left: fs.readdirSync(home) };
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
        fs.rmSync(cwd, { recursive: true, force: true });
    }
}

for (const flag of ['--version', '-V']) {
    test(`${flag} prints the version and touches nothing`, () => {
        const { r, ms, left } = run(flag);
        assert.strictEqual(r.status, 0, r.stderr);
        assert.strictEqual(r.stdout.trim(), version);
        assert.ok(ms < 10000);
        assert.deepStrictEqual(left, []);
    });
}

for (const flag of ['--help', '-h']) {
    test(`${flag} prints usage and touches nothing`, () => {
        const { r, ms, left } = run(flag);
        assert.strictEqual(r.status, 0, r.stderr);
        assert.match(r.stdout, /Usage: aos/);
        assert.ok(ms < 10000);
        assert.deepStrictEqual(left, []);
    });
}

test('the bare words version and help behave like the flags and touch nothing', () => {
    const v = run('version');
    assert.strictEqual(v.r.status, 0, v.r.stderr);
    assert.strictEqual(v.r.stdout.trim(), version);
    assert.deepStrictEqual(v.left, []);
    const h = run('help');
    assert.strictEqual(h.r.status, 0, h.r.stderr);
    assert.match(h.r.stdout, /^Usage: aos/);
    assert.deepStrictEqual(h.left, []);
});
