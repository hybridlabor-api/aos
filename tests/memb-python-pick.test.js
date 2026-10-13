const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pickPython, ensurePythonVenv } = require('../installer.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-pypick-'));
const stub = (table) => (cmd) => { if (cmd in table) return table[cmd]; throw new Error('ENOENT'); };

describe('pickPython', () => {
    test('prefers the newest versioned interpreter that is >= 3.10', () => {
        const run = stub({ python3: 'Python 3.9.6', 'python3.11': 'Python 3.11.4' });
        assert.equal(pickPython([3, 10], { home: tmp(), run, platform: 'linux' }).cmd, 'python3.11');
    });
    test('finds an interpreter in /opt/homebrew/bin when PATH has none', () => {
        const run = stub({ python3: 'Python 3.9.6', '/opt/homebrew/bin/python3.12': 'Python 3.12.1' });
        assert.equal(pickPython([3, 10], { home: tmp(), run, platform: 'linux' }).cmd, '/opt/homebrew/bin/python3.12');
    });
    test('only the system 3.9 -> null', () => {
        assert.equal(pickPython([3, 10], { home: tmp(), run: stub({ python3: 'Python 3.9.6' }), platform: 'linux' }), null);
    });
});

describe('ensurePythonVenv', () => {
    test('no suitable python and no uv: throws with the fix and leaves no .venv', () => {
        const dir = tmp();
        assert.throws(() => ensurePythonVenv(dir, { pick: () => null, hasUv: false, run: () => assert.fail('must not run') }), /Python >= 3\.10.*aos package install memb/);
        assert.equal(fs.existsSync(path.join(dir, '.venv')), false);
    });
    test('no suitable python but uv: installs 3.12 and builds the venv on it', () => {
        const calls = [];
        ensurePythonVenv(tmp(), { pick: () => null, hasUv: true, run: (c, a) => calls.push(a.join(' ')) });
        assert.deepEqual(calls, ['python install 3.12', 'venv --clear --seed --python 3.12 .venv']);
    });
    test('a venv built on Python 3.9 is rebuilt with --clear', () => {
        const dir = tmp();
        const bin = path.join(dir, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin');
        fs.mkdirSync(bin, { recursive: true });
        fs.writeFileSync(path.join(bin, process.platform === 'win32' ? 'python.exe' : 'python'), '');
        fs.writeFileSync(path.join(dir, '.venv', 'pyvenv.cfg'), 'home = /usr/bin\nversion = 3.9.6\n');
        const calls = [];
        const r = ensurePythonVenv(dir, { pick: () => ({ cmd: 'python3.12' }), hasUv: false, run: (c, a) => calls.push([c, ...a].join(' ')) });
        assert.equal(r.created, true);
        assert.deepEqual(calls, ['python3.12 -m venv --clear .venv']);
    });
});
