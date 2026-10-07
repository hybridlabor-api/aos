// Hardware & PCB launcher decisions: app-missing gating, doctor message contract, shipped
// prebuilt venv detection and the .venv npmignore contract. Pure node:test, no network,
// no shell, no fs writes outside temporary directories.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const hardwareApps = require('../lib/hardware-apps');
const installer = require('../installer.js');

const fsFrom = (map, existing = []) => ({
    existsSync: (p) => map.has(String(p)) ? map.get(String(p)) : existing.includes(String(p)),
    readdirSync: (p) => { if (map.has(String(p))) return map.get(String(p)); throw new Error('ENOENT'); },
    statSync: (p) => {
        const v = map.get(String(p));
        if (v !== undefined) return { isDirectory: () => Array.isArray(v) || v === true };
        if (existing.includes(String(p))) return { isDirectory: () => true };
        throw new Error('ENOENT');
    },
});

describe('hwAppStatus (app-detection gate)', () => {
    test('darwin KiCad.app present', () => {
        const f = fsFrom(new Map(), ['/Applications/KiCad/KiCad.app']);
        assert.deepEqual(hardwareApps.hwAppStatus('kicad', { platform: 'darwin', fsImpl: f }),
            { found: true, path: '/Applications/KiCad/KiCad.app', label: 'KiCad.app' });
    });
    test('darwin KiCad.app absent, kicad-cli on PATH', () => {
        const f = fsFrom(new Map());
        const status = hardwareApps.hwAppStatus('kicad', { platform: 'darwin', fsImpl: f, env: { PATH: '/opt/bin:/usr/bin' }, dirs: ['/opt/bin'] });
        assert.equal(status.found, false);
        assert.equal(status.label, 'KiCad.app');
    });
    test('darwin OpenSCAD.app absent', () => {
        const f = fsFrom(new Map());
        const status = hardwareApps.hwAppStatus('openscad', { platform: 'darwin', fsImpl: f, env: { PATH: '' } });
        assert.deepEqual(status, { found: false, path: null, label: 'OpenSCAD.app' });
    });
    test('win32: Program Files fallback (no .app naming)', () => {
        const f = fsFrom(new Map([['C:\\Program Files\\OpenSCAD', true]]));
        const status = hardwareApps.hwAppStatus('openscad', { platform: 'win32', fsImpl: f, env: {} });
        assert.equal(status.found, true);
    });
    test('unknown app id -> null, never a fake present verdict', () => {
        assert.equal(hardwareApps.hwAppStatus('blender', { fsImpl: fsFrom(new Map()) }), null);
    });
    test('executableProbe injection wins over fs', () => {
        const f = fsFrom(new Map());
        const status = hardwareApps.hwAppStatus('kicad', { platform: 'darwin', fsImpl: f, executableProbe: (b) => `/usr/local/bin/${b}` });
        assert.equal(status.found, true);
        assert.equal(status.path, '/usr/local/bin/kicad-cli');
    });
});

describe('hwAppGate (skip-if-app-missing)', () => {
    test('split register/skip', () => {
        const gate = hardwareApps.hwAppGate({
            kicad: { found: false, label: 'KiCad.app' },
            openscad: { found: true, label: 'OpenSCAD.app' },
        });
        assert.deepEqual(gate, { register: ['openscad'], skip: ['kicad'] });
    });
    test('both absent -> nothing registered (the installer notice covers both)', () => {
        const gate = hardwareApps.hwAppGate({ kicad: { found: false }, openscad: { found: false } });
        assert.deepEqual(gate.register, []);
        assert.deepEqual(gate.skip.slice().sort(), ['kicad', 'openscad']);
    });
    test('installer surfaces the gate and the strip helper', () => {
        assert.equal(typeof installer.stripHwMcpEntries, 'function');
        assert.equal(typeof installer.hardwareApps.hwAppGate, 'function');
        assert.equal(installer.hardwareApps, hardwareApps);
    });
});

describe('doctor message contract', () => {
    test('app missing message names the app', () => {
        const msg = hardwareApps.appMissingMessage('kicad', { status: { found: false, path: null, label: 'KiCad.app' } });
        assert.match(msg, /app missing: KiCad\.app/);
        const msg2 = hardwareApps.appMissingMessage('openscad', { status: { found: false, path: null, label: 'OpenSCAD.app' } });
        assert.match(msg2, /app missing: OpenSCAD\.app/);
    });
    test('doctor ships the check', () => {
        const src = fs.readFileSync(path.join(ROOT, 'bin', 'aos-doctor.mjs'), 'utf8');
        assert.match(src, /hardware-apps\.js/);
        assert.match(src, /appMissingMessage/);
    });
});

describe('hwServerDirsNeedingSync (shipped prebuilt venvs)', () => {
    const mkHw = (servers, extraExisting = []) => {
        const map = new Map();
        for (const name of servers) {
            const dir = `/hardware/mcp_servers/${name}`;
            map.set(dir, []);
            map.set(`${dir}/pyproject.toml`, true);
        }
        map.set('/hardware', []);
        map.set('/hardware/mcp_servers', servers);
        return fsFrom(map, extraExisting);
    };
    test('python missing (dangling interpreter link) needs uv sync', () => {
        const f = mkHw(['kicad-mcp-server'], []);
        const dirs = hardwareApps.hwServerDirsNeedingSync('/hardware', { fsImpl: f });
        assert.deepEqual(dirs, ['/hardware/mcp_servers/kicad-mcp-server']);
    });
    test('runnable venv (bin/python exists) needs no sync', () => {
        const f = mkHw(['kicad-mcp-server'], ['/hardware/mcp_servers/kicad-mcp-server/.venv/bin/python']);
        assert.deepEqual(hardwareApps.hwServerDirsNeedingSync('/hardware', { fsImpl: f }), []);
    });
    test('win32 checks Scripts/python.exe', () => {
        const f = mkHw(['openscad-mcp-server'], []);
        const dirs = hardwareApps.hwServerDirsNeedingSync('/hardware', { fsImpl: f, platform: 'win32' });
        assert.deepEqual(dirs, ['/hardware/mcp_servers/openscad-mcp-server']);
    });
    test('dir without pyproject.toml is skipped', () => {
        const f = fsFrom(new Map([
            ['/hardware', []],
            ['/hardware/mcp_servers', ['notes']],
            ['/hardware/mcp_servers/notes', []],
        ]), []);
        assert.deepEqual(hardwareApps.hwServerDirsNeedingSync('/hardware', { fsImpl: f }), []);
    });
});

describe('npmignore contract', () => {
    test('.npmignore keeps .venv trees out of every shipped tarball (incl. memb payload)', () => {
        const ignore = fs.readFileSync(path.join(ROOT, '.npmignore'), 'utf8');
        assert.ok(ignore.replace(/\s+/g, '\n').includes('.venv'));
        assert.ok(ignore.replace(/\s+/g, '\n').includes('node_modules'));
    });
    test('package.json files list exists (npm honors .npmignore within it)', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        assert.ok(Array.isArray(pkg.files) && pkg.files.length > 0);
    });
    test('memb-mcp payload is pulled from npm, so a stale venv never enters the config', () => {
        const src = fs.readFileSync(path.join(ROOT, 'installer.js'), 'utf8');
        assert.match(src, /npm pack did not produce the memb-mcp payload/);
        assert.match(src, /downloadOrUpdateModule\('@hybridlabor-api\/memb'/);
    });
});

describe('reconcileMembVenv entryImport (memb-mcp run.py FastMCP fallback)', () => {
    const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-reconcile-'));
    test('without mcp in requirements: entryImport drives the check', () => {
        const dir = tmp();
        fs.writeFileSync(path.join(dir, 'requirements.txt'), 'pydantic>=2.7.3\n');
        const r = installer.reconcileMembVenv(dir, { requirementsPath: path.join(dir, 'requirements.txt'), entryImport: 'import mcp', verifyImports: () => false, runInstall: () => true });
        assert.equal(r.status, 'reinstalled');
        const r2 = installer.reconcileMembVenv(dir, { requirementsPath: path.join(dir, 'requirements.txt'), verifyImports: () => false, runInstall: () => { throw new Error('changed behavior would install'); } });
        assert.equal(r2.status, 'up-to-date');
        fs.rmSync(dir, { recursive: true, force: true });
    });
    test('entry import fine with no mcp line -> up-to-date, no install', () => {
        const dir = tmp();
        fs.writeFileSync(path.join(dir, 'requirements.txt'), 'pydantic>=2.7.3\n');
        const r = installer.reconcileMembVenv(dir, { requirementsPath: path.join(dir, 'requirements.txt'), entryImport: 'try:\n    from mcp.server.fastmcp import FastMCP\nexcept ImportError:\n    pass', verifyImports: () => true, runInstall: () => { throw new Error('should not install'); } });
        assert.equal(r.status, 'up-to-date');
        fs.rmSync(dir, { recursive: true, force: true });
    });
    test('mcp in requirements + failing import -> reinstall (default behavior kept)', () => {
        const dir = tmp();
        fs.writeFileSync(path.join(dir, 'requirements.txt'), 'mcp>=1.0.0\n');
        const r = installer.reconcileMembVenv(dir, { requirementsPath: path.join(dir, 'requirements.txt'), verifyImports: () => false, runInstall: () => true });
        assert.equal(r.status, 'reinstalled');
        fs.rmSync(dir, { recursive: true, force: true });
    });
});
