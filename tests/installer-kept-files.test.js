// Installer: files written by a run are always recorded (no phantom "edited" files), guard files never stay stale,
// and a pinned package is not reported as an available update forever. Temp HOME only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-kept-'));
process.env.HOME = root;
process.env.USERPROFILE = root;
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const installer = require('../installer.js');
const versions = require('../lib/v5/versions');
const menu = require('../lib/v5/menu');
const pk = require('../lib/v5/packages');

const write = (f, c) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); };
const newFiles = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.new'));

test('edited file is kept with .new; unknown guard file is replaced with a .bak', () => {
    const src = path.join(root, 'src');
    const dst = path.join(root, 'dst');
    write(path.join(src, 'SKILL.md'), 'shipped\n');
    write(path.join(src, 'go-gate.mjs'), 'gate v2\n');
    write(path.join(dst, 'SKILL.md'), 'user edit\n');
    write(path.join(dst, 'go-gate.mjs'), 'gate v1 unknown build\n');
    const manifest = {};
    for (const f of ['SKILL.md', 'go-gate.mjs']) manifest[path.join(dst, f)] = { sha256: 'old-recorded-hash' };
    installer.setShippedHashes(new Set());
    assert.strictEqual(installer.resolveFileConflict(path.join(src, 'SKILL.md'), path.join(dst, 'SKILL.md'), manifest, new Set()), 'kept');
    assert.strictEqual(fs.readFileSync(path.join(dst, 'SKILL.md'), 'utf8'), 'user edit\n');
    assert.deepStrictEqual(newFiles(dst), ['SKILL.md.new']);

    assert.strictEqual(installer.resolveFileConflict(path.join(src, 'go-gate.mjs'), path.join(dst, 'go-gate.mjs'), manifest, new Set()), 'wrote');
    assert.strictEqual(fs.readFileSync(path.join(dst, 'go-gate.mjs'), 'utf8'), 'gate v2\n');
    assert.strictEqual(fs.readFileSync(path.join(dst, 'go-gate.mjs.bak'), 'utf8'), 'gate v1 unknown build\n');
});

test('written file is recorded, so the next run does not see an edit', () => {
    const src = path.join(root, 's2', 'a.md');
    const dst = path.join(root, 'd2', 'a.md');
    write(src, 'v2\n');
    write(dst, 'v1\n');
    const manifest = {};
    installer.setShippedHashes(new Set([installer.computeFileHash(dst)]));
    assert.strictEqual(installer.resolveFileConflict(src, dst, manifest, new Set()), 'wrote');
    installer.setShippedHashes(new Set());
    assert.strictEqual(installer.resolveFileConflict(src, dst, manifest, new Set()), 'wrote');
    assert.deepStrictEqual(newFiles(path.dirname(dst)), []);
});

function fakeHost(flushes) {
    const home = fs.mkdtempSync(path.join(root, 'h-'));
    fs.mkdirSync(path.join(home, '.aos'), { recursive: true });
    fs.writeFileSync(path.join(home, '.aos', 'v5-settings.json'), JSON.stringify({ disabled: ['gateway'] }));
    const host = {
        detectInstallState: () => ({ isInstalled: true, localVersion: '4.0.0', installedModules: [] }),
        resolveTargetPaths: () => ({ targetSkillDir: path.join(home, 'skills'), targetMcpDir: path.join(home, 'mcp') }),
        moduleBasePath: () => path.join(home, '.agents'),
        quickUpdateKernel: () => [],
        quickUpdateHarnesses: () => [],
        refreshOpenWikiSilently: async () => false,
        isNewerVersion: installer.isNewerVersion,
        loadExistingEnv: () => ({}),
        PROVIDER_KEY_ENV_NAMES: {},
        saveManifest: () => flushes.push('save'),
        flushSessionManifest: () => flushes.push('flush'),
        DEJA_VERSION: installer.DEJA_VERSION,
    };
    return { home, host, opts: (npmView) => ({ home, write: () => {}, ui: {}, npmView, dryRun: true }) };
}

test('update flushes the install manifest even when the run is stale', async () => {
    const flushes = [];
    const m = fakeHost(flushes);
    await menu.update(m.host, m.opts(async (n) => (n === '@hybridlabor-api/aos' ? '99.0.0' : '1.0.0')));
    assert.ok(flushes.includes('flush'), 'files written by a stale run must still be recorded');
    assert.ok(!flushes.includes('save'), 'the kernel version stays unrecorded for a stale run');
});

test('three updates in a row report nothing available after the first', async () => {
    const flushes = [];
    const m = fakeHost(flushes);
    const view = async (n) => ({ '@hybridlabor-api/aos': '4.0.0', '@vshulcz/deja-vu': '9.9.9' }[n] || '0.0.1');
    for (let i = 0; i < 3; i++) {
        const out = [];
        await menu.update(m.host, { ...m.opts(view), write: (s) => out.push(s) });
        if (i > 0) assert.ok(!out.join('').includes('available'), `run ${i + 1}: ${out.join('')}`);
    }
});

test('a pinned package compares against its pin, not the registry', async () => {
    const deja = pk.registry.find((p) => p.id === 'deja');
    assert.strictEqual(deja.pin({ DEJA_VERSION: installer.DEJA_VERSION }), installer.DEJA_VERSION);
    const rows = await versions.checkAll([{ id: 'deja', npm: '@vshulcz/deja-vu', local: installer.DEJA_VERSION, pin: installer.DEJA_VERSION }], { home: fs.mkdtempSync(path.join(root, 'v-')), npmView: async () => '0.22.1', isNewer: (l, r) => l !== r });
    assert.strictEqual(rows[0].outdated, false);
});
