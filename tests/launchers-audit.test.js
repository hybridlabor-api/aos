// Audit P0-1: launchers for every AOS bin (plan-canvas, archify) and detection of an older
// global npm install of the package (printed for the user, never removed automatically).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const ur = require('../lib/uninstall-records.js');
const npmGlobalAos = require('../lib/npm-global-aos.js');
const SANDBOX_SKIP = process.env.AOS_TEST_SANDBOX !== 'container' && 'needs AOS_TEST_SANDBOX=container (runs installer entry points)';

test('LAUNCHERS cover plan-canvas and archify; launcherTarget maps them to the installed skill files', () => {
    for (const name of ['aos-plan-canvas', 'aos-archify']) assert.ok(ur.LAUNCHERS.includes(name), `${name} in LAUNCHERS`);
    const home = path.join(os.tmpdir(), 'aos-launchmap-');
    assert.strictEqual(ur.launcherTarget(home, 'aos-plan-canvas'), path.join(home, '.agents', 'skills', 'plan-canvas', 'scripts', 'plan-canvas.js'));
    assert.strictEqual(ur.launcherTarget(home, 'aos-archify'), path.join(home, '.agents', 'skills', 'archify', 'bin', 'archify.mjs'));
});

test('installGlobalBinaries wires plan-canvas and archify launchers; uninstall removes them', { skip: SANDBOX_SKIP }, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-launch-'));
    try {
        const planCanvas = path.join(home, '.agents', 'skills', 'plan-canvas', 'scripts', 'plan-canvas.js');
        const archify = path.join(home, '.agents', 'skills', 'archify', 'bin', 'archify.mjs');
        for (const f of [planCanvas, archify]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ''); }
        const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(REPO, 'installer.js'))}).installGlobalBinaries()`],
            { cwd: home, env: { HOME: home, USERPROFILE: home, PATH: '/usr/bin:/bin', AOS_PLUGIN_CLI: 'off' }, encoding: 'utf8' });
        assert.strictEqual(r.status, 0, r.stderr);
        const bin = path.join(home, '.local', 'bin');
        const read = (n) => fs.readFileSync(path.join(bin, n), 'utf8');
        for (const [name, target] of [['aos-plan-canvas', planCanvas], ['aos-archify', archify]]) {
            assert.ok(read(name).includes(`# ${ur.LAUNCHER_MARKER.split('# ')[1]}`) || read(name).includes(ur.LAUNCHER_MARKER), `${name} carries the marker`);
            assert.ok(read(name).includes(target), `${name} runs ${target}`);
        }
        const lines = ur.reverseRegistrations({ home, dryRun: false });
        assert.ok(lines.some((l) => l.startsWith('Launchers removed from')), lines.join('\n'));
        for (const n of ['aos-plan-canvas', 'aos-archify']) assert.ok(!fs.existsSync(path.join(bin, n)), `${n} removed`);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('detectGlobalAos reads the npm global root; a failed probe is "could not check", never "fine"', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-npmg-'));
    try {
        const pkgDir = path.join(root, '@hybridlabor-api', 'aos');
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ version: '5.0.0' }));
        const g = npmGlobalAos.detectGlobalAos({ run: () => root + '\n' });
        assert.deepStrictEqual({ ...g, root: g.root }, { checked: true, found: true, root, version: '5.0.0' });

        assert.deepStrictEqual(npmGlobalAos.detectGlobalAos({ run: () => os.tmpdir() }), { checked: true, found: false, root: os.tmpdir() });
        assert.deepStrictEqual(npmGlobalAos.detectGlobalAos({ run: () => { throw new Error('offline'); } }), { checked: false });
        assert.deepStrictEqual(npmGlobalAos.detectGlobalAos({ run: () => '' }), { checked: false });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('globalAosWarning: a prerelease of the same base version is not "older"', () => {
    const w = npmGlobalAos.globalAosWarning({ version: '5.4.0-rc.1', root: '/opt/npm', installedVersion: '5.4.0' });
    assert.ok(!w.some((l) => l.includes('older than')));
});

test('globalAosWarning tells the user the exact removal command and never removes anything', () => {
    const older = npmGlobalAos.globalAosWarning({ version: '4.9.0', root: '/opt/npm', installedVersion: '5.1.0' });
    assert.ok(older.some((l) => l.includes('npm uninstall -g @hybridlabor-api/aos')), older.join('\n'));
    assert.ok(older.some((l) => l.includes('older than the installed v5.1.0')), older.join('\n'));
    const same = npmGlobalAos.globalAosWarning({ version: '5.1.0', root: '/opt/npm', installedVersion: '5.1.0' });
    assert.ok(!same.some((l) => l.includes('older than')));
});

function doctorResults(fakeNpmBody) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-doctor-npm-'));
    const fakeDir = path.join(home, 'fakebin');
    try {
        fs.mkdirSync(fakeDir, { recursive: true });
        fs.writeFileSync(path.join(fakeDir, 'npm'), `#!/bin/sh\n${fakeNpmBody}\n`, { mode: 0o755 });
        let stdout;
        try {
            stdout = spawnSync(process.execPath, [path.join(REPO, 'bin', 'aos-doctor.mjs'), '--json'], {
                encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, PATH: `${fakeDir}:/usr/bin:/bin` },
            });
            stdout = stdout.stdout;
        } catch (err) { stdout = err.stdout; }
        return JSON.parse(stdout).results;
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

test('aos-doctor: flags a global npm install of the package with the removal command in the fix', () => {
    if (process.platform === 'win32') return;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-npmg-doctor-'));
    try {
        const pkgDir = path.join(root, '@hybridlabor-api', 'aos');
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ version: '1.0.0' }));
        const row = doctorResults(`echo ${root}`).find((r) => r.name === 'Global npm install');
        assert.ok(row, 'Global npm install check present');
        assert.strictEqual(row.ok, false);
        assert.match(row.fix, /npm uninstall -g @hybridlabor-api\/aos/);
        assert.match(row.detail, /v1\.0\.0/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('aos-doctor: a failing npm probe reads as "could not check", not as checked-and-fine', () => {
    if (process.platform === 'win32') return;
    const row = doctorResults('exit 1').find((r) => r.name === 'Global npm install');
    assert.ok(row, 'Global npm install check present');
    assert.strictEqual(row.ok, true);
    assert.match(row.detail, /could not check/);
});
