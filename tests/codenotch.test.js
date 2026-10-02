// Codenotch installer: fully offline. fetch, hdiutil, xattr, plutil, copy and roots are fakes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-cn-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const cn = require('../lib/codenotch.js');

const DMG = Buffer.from('fake dmg bytes');
const SHA = crypto.createHash('sha256').update(DMG).digest('hex');

function setup({ tag = 'v1.2.0', sha = SHA, status = 200, headers = {}, assets, installed, state, appsInDmg = ['Codenotch.app'], applicationsWritable = true, copyFails = false } = {}) {
    const dir = fs.mkdtempSync(path.join(root, 'case-'));
    const roots = { applications: path.join(dir, 'Applications'), userApplications: path.join(dir, 'home', 'Applications'), tmp: dir };
    if (applicationsWritable) fs.mkdirSync(roots.applications);
    else fs.writeFileSync(roots.applications, 'file, not a dir');
    const stateFile = path.join(dir, 'home', '.agents', '.bdb-codenotch.json');
    const plists = {};
    const mkApp = (p, version, bundleId = 'com.bdb.codenotch') => {
        fs.mkdirSync(path.join(p, 'Contents'), { recursive: true });
        fs.writeFileSync(path.join(p, 'Contents', 'Info.plist'), 'x');
        plists[p] = { CFBundleShortVersionString: version, CFBundleIdentifier: bundleId };
    };
    if (installed) mkApp(path.join(roots.applications, 'Codenotch.app'), installed);
    if (state) {
        fs.mkdirSync(path.dirname(stateFile), { recursive: true });
        fs.writeFileSync(stateFile, JSON.stringify(state));
    }
    const calls = { fetch: [], hdiutil: [], xattr: [] };
    const body = {
        tag_name: tag,
        assets: assets || [
            { name: 'Codenotch.dmg', browser_download_url: 'https://dl/Codenotch.dmg' },
            { name: 'Codenotch.dmg.sha256', browser_download_url: 'https://dl/Codenotch.dmg.sha256' },
        ],
    };
    const res = (ok, st, data, buf) => ({ ok, status: st, headers: { get: (k) => headers[k] }, json: async () => data, arrayBuffer: async () => buf });
    const opts = {
        platform: 'darwin', home: path.join(dir, 'home'), roots, stateFile, interactive: false,
        fetch: async (url) => {
            calls.fetch.push(url);
            if (url.includes('api.github.com')) return res(status === 200, status, body);
            if (url.endsWith('.sha256')) { const b = Buffer.from(`${sha}  Codenotch.dmg\n`); return res(true, 200, null, b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); }
            return res(true, 200, null, DMG.buffer.slice(DMG.byteOffset, DMG.byteOffset + DMG.length));
        },
        hdiutil: (args) => {
            calls.hdiutil.push(args);
            if (args[0] === 'attach') {
                const mp = args[args.indexOf('-mountpoint') + 1];
                for (const a of appsInDmg) mkApp(path.join(mp, a), '1.2.0');
                fs.symlinkSync('/Applications', path.join(mp, 'Applications'));
            }
        },
        xattr: (args) => { calls.xattr.push(args); },
        plutil: (args) => {
            const key = args[1], p = path.dirname(path.dirname(args[args.length - 1]));
            if (!plists[p]) throw new Error('no plist');
            return plists[p][key] + '\n';
        },
        copyApp: (src, dest) => {
            if (copyFails) { fs.mkdirSync(dest, { recursive: true }); throw new Error('copy failed'); }
            fs.cpSync(src, dest, { recursive: true });
            plists[dest] = plists[src];
        },
        confirm: async () => true,
    };
    return { dir, roots, stateFile, calls, opts, mkApp };
}

const readState = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

test('non-macOS is a no-op: no fetch, nothing touched', async () => {
    for (const platform of ['win32', 'linux']) {
        const c = setup();
        const r = await cn.installCodenotch({ ...c.opts, platform });
        assert.strictEqual(r.status, 'skipped-platform');
        assert.strictEqual(c.calls.fetch.length, 0);
    }
});

test('404 (repo not created yet) is a friendly non-fatal result', async () => {
    const c = setup({ status: 404 });
    const r = await cn.installCodenotch(c.opts);
    assert.strictEqual(r.status, 'not-found');
    assert.match(r.message, /try again later/);
    assert.strictEqual(c.calls.hdiutil.length, 0);
});

test('rate limit is reported, not thrown', async () => {
    const c = setup({ status: 403, headers: { 'x-ratelimit-remaining': '0' } });
    assert.strictEqual((await cn.installCodenotch(c.opts)).status, 'rate-limited');
});

test('checksum mismatch is refused before mounting', async () => {
    const c = setup({ sha: 'a'.repeat(64) });
    const r = await cn.installCodenotch(c.opts);
    assert.strictEqual(r.status, 'checksum-mismatch');
    assert.strictEqual(c.calls.hdiutil.length, 0);
    assert.ok(!fs.existsSync(path.join(c.roots.applications, 'Codenotch.app')));
});

test('missing .sha256 asset is refused', async () => {
    const c = setup({ assets: [{ name: 'Codenotch.dmg', browser_download_url: 'https://dl/Codenotch.dmg' }] });
    const r = await cn.installCodenotch(c.opts);
    assert.strictEqual(r.status, 'error');
    assert.strictEqual(c.calls.hdiutil.length, 0);
});

test('success: mounts read-only, copies, strips quarantine, records state, detaches', async () => {
    const c = setup();
    const r = await cn.installCodenotch(c.opts);
    assert.strictEqual(r.status, 'installed');
    const dest = path.join(c.roots.applications, 'Codenotch.app');
    assert.ok(fs.existsSync(path.join(dest, 'Contents', 'Info.plist')));
    const attach = c.calls.hdiutil[0];
    assert.deepStrictEqual(attach.slice(0, 4), ['attach', '-nobrowse', '-readonly', '-mountpoint']);
    assert.strictEqual(c.calls.hdiutil[c.calls.hdiutil.length - 1][0], 'detach');
    assert.deepStrictEqual(c.calls.xattr[0], ['-dr', 'com.apple.quarantine', dest]);
    assert.deepStrictEqual({ ...readState(c.stateFile), installedAt: undefined }, { path: dest, version: '1.2.0', bundleId: 'com.bdb.codenotch', installedAt: undefined });
    assert.deepStrictEqual(fs.readdirSync(c.dir).filter((n) => n.startsWith('aos-codenotch-')), []);
});

test('second run is idempotent', async () => {
    const c = setup();
    await cn.installCodenotch(c.opts);
    const attaches = c.calls.hdiutil.length;
    const r = await cn.installCodenotch(c.opts);
    assert.strictEqual(r.status, 'up-to-date');
    assert.strictEqual(c.calls.hdiutil.length, attaches);
});

test('newer installed app is skipped, even a foreign one', async () => {
    const c = setup({ installed: '2.0.0' });
    assert.strictEqual((await cn.installCodenotch(c.opts)).status, 'up-to-date');
    assert.strictEqual(c.calls.hdiutil.length, 0);
});

test('older app carrying our marker is replaced automatically in non-interactive mode', async () => {
    const c = setup({ installed: '1.0.0' });
    const d = path.join(c.roots.applications, 'Codenotch.app');
    fs.mkdirSync(path.dirname(c.stateFile), { recursive: true });
    fs.writeFileSync(c.stateFile, JSON.stringify({ path: d, version: '1.0.0', bundleId: 'com.bdb.codenotch' }));
    const r = await cn.installCodenotch(c.opts);
    assert.strictEqual(r.status, 'updated');
    assert.strictEqual(readState(c.stateFile).version, '1.2.0');
    assert.ok(!fs.existsSync(`${d}.aos-old`));
});

test('older app without marker is kept non-interactively, replaced only after confirmation', async () => {
    const c = setup({ installed: '1.0.0' });
    assert.strictEqual((await cn.installCodenotch(c.opts)).status, 'kept-foreign');
    assert.strictEqual(c.calls.hdiutil.length, 0);
    const asked = [];
    const r = await cn.installCodenotch({ ...c.opts, interactive: true, confirm: async (m) => { asked.push(m); return true; } });
    assert.strictEqual(r.status, 'updated');
    assert.strictEqual(asked.length, 1);
    const declined = setup({ installed: '1.0.0' });
    assert.strictEqual((await cn.installCodenotch({ ...declined.opts, interactive: true, confirm: async () => false })).status, 'declined');
});

test('unwritable /Applications falls back to ~/Applications', async () => {
    const c = setup({ applicationsWritable: false });
    const r = await cn.installCodenotch(c.opts);
    assert.strictEqual(r.status, 'installed');
    assert.strictEqual(r.path, path.join(c.roots.userApplications, 'Codenotch.app'));
});

test('failed copy detaches, cleans up and restores the old app', async () => {
    const c = setup({ installed: '1.0.0', copyFails: true });
    const d = path.join(c.roots.applications, 'Codenotch.app');
    fs.mkdirSync(path.dirname(c.stateFile), { recursive: true });
    fs.writeFileSync(c.stateFile, JSON.stringify({ path: d, version: '1.0.0', bundleId: 'com.bdb.codenotch' }));
    const r = await cn.installCodenotch(c.opts);
    assert.strictEqual(r.status, 'error');
    assert.strictEqual(c.calls.hdiutil[c.calls.hdiutil.length - 1][0], 'detach');
    assert.ok(fs.existsSync(path.join(d, 'Contents', 'Info.plist')));
    assert.strictEqual(readState(c.stateFile).version, '1.0.0');
    assert.deepStrictEqual(fs.readdirSync(c.dir).filter((n) => n.startsWith('aos-codenotch-')), []);
});

test('DMG with two apps is rejected and still detached', async () => {
    const c = setup({ appsInDmg: ['A.app', 'B.app'] });
    assert.strictEqual((await cn.installCodenotch(c.opts)).status, 'error');
    assert.strictEqual(c.calls.hdiutil[c.calls.hdiutil.length - 1][0], 'detach');
});

test('uninstall removes only the recorded, unchanged app', async () => {
    const c = setup();
    await cn.installCodenotch(c.opts);
    const dest = path.join(c.roots.applications, 'Codenotch.app');
    const plutil = (args) => c.opts.plutil(args);
    const plan = cn.planCodenotchUninstall({ stateFile: c.stateFile, plutil });
    assert.strictEqual(plan.action, 'remove');
    assert.strictEqual(cn.uninstallCodenotch(plan, { stateFile: c.stateFile }), 'remove');
    assert.ok(!fs.existsSync(dest));
    assert.ok(!fs.existsSync(c.stateFile));

    const k = setup();
    await cn.installCodenotch(k.opts);
    const kdest = path.join(k.roots.applications, 'Codenotch.app');
    const changed = cn.planCodenotchUninstall({ stateFile: k.stateFile, plutil: () => '9.9.9\n' });
    assert.strictEqual(changed.action, 'keep');
    cn.uninstallCodenotch(changed, { stateFile: k.stateFile });
    assert.ok(fs.existsSync(kdest));
    assert.strictEqual(cn.planCodenotchUninstall({ stateFile: path.join(k.dir, 'none.json') }), null);
});

test('compareVersions is semver-ish', () => {
    assert.strictEqual(cn.compareVersions('1.10.0', '1.9.9'), 1);
    assert.strictEqual(cn.compareVersions('1.0', '1.0.0'), 0);
    assert.strictEqual(cn.compareVersions('v0.9.0', '1.0.0'), -1);
});

test('--codenotch and AOS_CODENOTCH=1 opt in; nothing else does', () => {
    assert.strictEqual(cn.codenotchRequested(['--codenotch'], {}), true);
    assert.strictEqual(cn.codenotchRequested([], { AOS_CODENOTCH: '1' }), true);
    assert.strictEqual(cn.codenotchRequested(['-y'], { AOS_CODENOTCH: '0' }), false);
});

test('installer --help lists the option', () => {
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'installer.js'), '--help'], { encoding: 'utf8', env: { ...process.env, HOME: root } });
    assert.match(r.stdout, /--codenotch/);
    assert.match(r.stdout, /AOS_CODENOTCH=1/);
});
