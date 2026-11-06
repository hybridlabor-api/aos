const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ensurePythonVenv } = require('../installer.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-venvrun-'));

const mkWinVenv = (dir, cfg) => {
    const py = path.join(dir, '.venv', 'Scripts', 'python.exe');
    fs.mkdirSync(path.dirname(py), { recursive: true });
    fs.writeFileSync(py, '');
    fs.writeFileSync(path.join(dir, '.venv', 'pyvenv.cfg'), cfg);
};

describe('ensurePythonVenv reuse of a venv whose base Python is gone', () => {
    test('home points to a missing base: the venv is rebuilt with --clear, not reused', () => {
        const dir = tmp();
        const missingBase = path.join(dir, 'missing-base');
        mkWinVenv(dir, `home = ${missingBase}\nversion = 3.11.9\n`);
        const calls = [];
        const r = ensurePythonVenv(dir, {
            platform: 'win32',
            pick: () => ({ cmd: 'python3.12' }),
            hasUv: false,
            run: (c, a) => { calls.push([c, ...a].join(' ')); fs.writeFileSync(path.join(dir, '.venv', 'pyvenv.cfg'), `home = ${path.join(dir, 'base')}\nversion = 3.12.1\n`); },
        });
        assert.equal(r.created, true);
        assert.deepEqual(calls, [`python3.12 -m venv --clear ${path.join(dir, '.venv')}`]);
    });

    test('home exists and version is new enough: the venv is reused, no rebuild', () => {
        const dir = tmp();
        mkWinVenv(dir, `home = ${dir}\nversion = 3.12.1\n`);
        const r = ensurePythonVenv(dir, { platform: 'win32', pick: () => null, hasUv: false, run: () => assert.fail('must not rebuild') });
        assert.equal(r.created, false);
    });
});
