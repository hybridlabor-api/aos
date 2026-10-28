const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const INSTALLER = path.join(__dirname, '..', 'installer.js');
const run = (...args) => spawnSync(process.execPath, [INSTALLER, ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, HOME: os.tmpdir(), USERPROFILE: os.tmpdir() } });
const unknownOf = (r) => (/Unknown --platforms value\(s\): ([^.]*)\./.exec(r.stderr + r.stdout) || [])[1];

test('--platforms: values split by PowerShell (one arg with spaces, or separate args) are joined, not rejected as one value', () => {
    for (const args of [['--platforms=1 2 5 77'], ['--platforms=1', '2', '5', '77'], ['--platforms', '1,2,5', '77'], ['--platforms', '1', '2', '5,77']]) {
        const r = run(...args);
        assert.strictEqual(r.status, 1, args.join(' '));
        assert.strictEqual(unknownOf(r), '77', `${args.join(' ')} -> ${r.stderr}`);
    }
});

test('--platforms: the error names the PowerShell quoting fix', () => {
    const r = run('--platforms=99');
    assert.strictEqual(unknownOf(r), '99');
    assert.match(r.stderr, /PowerShell quote the list/);
});
