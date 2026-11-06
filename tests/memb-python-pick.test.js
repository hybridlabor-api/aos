const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pickPython, ensurePythonVenv, installMemB } = require('../installer.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-pypick-'));
const stub = (table) => (cmd) => { if (cmd in table) return table[cmd]; throw new Error('ENOENT'); };
const mkInterp = (dir, platform = process.platform) => {
    const py = path.join(dir, '.venv', platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python'));
    fs.mkdirSync(path.dirname(py), { recursive: true });
    fs.writeFileSync(py, '');
};

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
        const dir = tmp();
        ensurePythonVenv(dir, { pick: () => null, hasUv: true, run: (c, a) => { calls.push(a.join(' ')); if (a[0] === 'venv') mkInterp(dir); } });
        assert.deepEqual(calls, ['python install 3.12', `venv --clear --seed --python 3.12 ${path.join(dir, '.venv')}`]);
    });
    test('win32: a venv that reports success without Scripts\\python.exe is an error, not a silent success', () => {
        const dir = tmp();
        assert.throws(
            () => ensurePythonVenv(dir, { platform: 'win32', pick: () => null, hasUv: true, run: () => {} }),
            /Scripts[\\/]python\.exe/,
        );
    });
    test('win32: a venv that writes Scripts\\python.exe is accepted', () => {
        const dir = tmp();
        const r = ensurePythonVenv(dir, { platform: 'win32', pick: () => null, hasUv: true, run: (c, a) => { if (a[0] === 'venv') mkInterp(dir, 'win32'); } });
        assert.equal(r.created, true);
        assert.ok(fs.existsSync(path.join(dir, '.venv', 'Scripts', 'python.exe')));
    });
    test('a venv built on Python 3.9 is rebuilt with --clear', () => {
        const dir = tmp();
        const bin = path.join(dir, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin');
        fs.mkdirSync(bin, { recursive: true });
        fs.writeFileSync(path.join(bin, process.platform === 'win32' ? 'python.exe' : 'python'), '');
        fs.writeFileSync(path.join(dir, '.venv', 'pyvenv.cfg'), 'home = /usr/bin\nversion = 3.9.6\n');
        const calls = [];
        const r = ensurePythonVenv(dir, { pick: () => ({ cmd: 'python3.12' }), hasUv: false, run: (c, a) => { calls.push([c, ...a].join(' ')); mkInterp(dir); } });
        assert.equal(r.created, true);
        assert.deepEqual(calls, [`python3.12 -m venv --clear ${path.join(dir, '.venv')}`]);
    });
    test('venv failure surfaces stderr, sets the half-built .venv aside and names the OS fix', () => {
        const dir = tmp();
        const run = () => { fs.mkdirSync(path.join(dir, '.venv'), { recursive: true }); throw Object.assign(new Error('x'), { stderr: 'ensurepip is not available' }); };
        assert.throws(() => ensurePythonVenv(dir, { pick: () => ({ cmd: 'python3.12' }), hasUv: false, run }), /ensurepip is not available.*fix: /);
        assert.equal(fs.existsSync(path.join(dir, '.venv')), false);
        assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('.venv.broken-')), 'kept aside, not deleted');
    });
});

describe('installMemB venv interpreter guard', () => {
    test('venv reports success but has no interpreter: fails fast, no pip/reconcile/repair, names the path', async () => {
        const membDir = tmp();
        fs.writeFileSync(path.join(membDir, 'requirements.txt'), 'pydantic\n');
        const venvPy = path.join(membDir, '.venv', process.platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python'));
        const pipCalls = [];
        const out = [];
        const write = process.stdout.write;
        const warn = console.warn;
        const log = console.log;
        process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
        console.warn = (...a) => out.push(a.join(' '));
        console.log = (...a) => out.push(a.join(' '));
        let ok;
        try {
            ok = await installMemB(false, {
                membDir,
                download: () => true,
                installDeja: async () => {},
                ensureVenv: () => ({ created: true, viaUv: true }),
                runPip: (cmd) => { pipCalls.push(cmd); return true; },
                reconcile: () => { pipCalls.push('reconcile'); return { status: 'failed' }; },
            });
        } finally {
            process.stdout.write = write;
            console.warn = warn;
            console.log = log;
        }
        assert.equal(ok, false);
        assert.deepEqual(pipCalls, []);
        assert.ok(out.join('\n').includes(venvPy), 'warning names the missing interpreter path');
    });
});
