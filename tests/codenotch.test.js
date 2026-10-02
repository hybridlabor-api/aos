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
    for (const platform of ['linux', 'freebsd']) {
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

test('mode: default on, AOS_CODENOTCH=0 and --no-codenotch off, force flags on', () => {
    assert.strictEqual(cn.codenotchMode([], {}), 'default');
    assert.strictEqual(cn.codenotchMode(['-y'], {}), 'default');
    assert.strictEqual(cn.codenotchMode([], { AOS_CODENOTCH: '0' }), 'off');
    assert.strictEqual(cn.codenotchMode(['--no-codenotch'], {}), 'off');
    assert.strictEqual(cn.codenotchMode(['--codenotch', '--no-codenotch'], {}), 'off');
    assert.strictEqual(cn.codenotchMode(['--codenotch'], {}), 'force');
    assert.strictEqual(cn.codenotchMode([], { AOS_CODENOTCH: '1' }), 'force');
});

const fakeInstall = (calls, result = { status: 'installed', version: '1.2.0', path: '/Applications/Codenotch.app' }) => async (o) => { calls.push(o); return result; };

test('step: non-interactive runs by default, without any env', async () => {
    const calls = [];
    const r = await cn.runCodenotchStep({ platform: 'darwin', argv: ['-y'], env: {}, interactive: false, install: fakeInstall(calls) });
    assert.strictEqual(r.status, 'installed');
    assert.strictEqual(calls.length, 1);
});

test('step: AOS_CODENOTCH=0 and --no-codenotch skip without installing', async () => {
    for (const [argv, env] of [[[], { AOS_CODENOTCH: '0' }], [['--no-codenotch'], {}]]) {
        const calls = [];
        const r = await cn.runCodenotchStep({ platform: 'darwin', argv, env, interactive: false, install: fakeInstall(calls) });
        assert.strictEqual(r.status, 'opted-out');
        assert.strictEqual(calls.length, 0);
    }
});

test('step: interactive prompt is asked (default yes is the caller initialValue), no skips, yes installs', async () => {
    const asked = [];
    const calls = [];
    const no = await cn.runCodenotchStep({ platform: 'darwin', argv: [], env: {}, interactive: true, ask: async (m) => { asked.push(m); return false; }, install: fakeInstall(calls) });
    assert.strictEqual(no.status, 'declined');
    assert.strictEqual(asked.length, 1);
    assert.match(asked[0], /Install BDB AO Codenotch/);
    const yes = await cn.runCodenotchStep({ platform: 'darwin', argv: [], env: {}, interactive: true, ask: async () => true, install: fakeInstall(calls) });
    assert.strictEqual(yes.status, 'installed');
    const forced = [];
    await cn.runCodenotchStep({ platform: 'darwin', argv: ['--codenotch'], env: {}, interactive: true, ask: async (m) => { forced.push(m); return true; }, install: fakeInstall(calls) });
    assert.strictEqual(forced.length, 0);
});

test('step: a throwing install is contained as a warning result', async () => {
    const warns = [];
    const r = await cn.runCodenotchStep({ platform: 'darwin', argv: [], env: {}, interactive: false, log: { warn: (m) => warns.push(m) }, install: async () => { throw new Error('boom'); } });
    assert.strictEqual(r.status, 'error');
    assert.match(warns[0], /boom/);
});

test('step: real install failures (404, offline, checksum) resolve and never throw', async () => {
    const c404 = setup({ status: 404 });
    assert.strictEqual((await cn.runCodenotchStep({ ...c404.opts, argv: [], env: {}, interactive: false })).status, 'not-found');
    const off = setup();
    const r = await cn.runCodenotchStep({ ...off.opts, fetch: async () => { throw new Error('offline'); }, argv: [], env: {}, interactive: false });
    assert.strictEqual(r.status, 'error');
    const bad = setup({ sha: 'b'.repeat(64) });
    assert.strictEqual((await cn.runCodenotchStep({ ...bad.opts, argv: [], env: {}, interactive: false })).status, 'checksum-mismatch');
});

test('step: linux returns null and never installs or prompts', async () => {
    for (const platform of ['linux']) {
        const calls = [];
        const r = await cn.runCodenotchStep({ platform, argv: [], env: {}, interactive: true, ask: async () => { throw new Error('asked'); }, install: fakeInstall(calls) });
        assert.strictEqual(r, null);
        assert.strictEqual(calls.length, 0);
        assert.strictEqual(cn.codenotchSummaryLine(r), null);
    }
});

test('summary line: installed, skipped, failed', () => {
    const inst = cn.codenotchSummaryLine({ status: 'installed', version: '1.2.0', path: '/Applications/Codenotch.app' });
    assert.match(inst, /installed 1\.2\.0 \(\/Applications\/Codenotch\.app\).*aos-uninstall/);
    const skip = cn.codenotchSummaryLine({ status: 'up-to-date', message: 'already installed (2.0.0) at /Applications/Codenotch.app' });
    assert.match(skip, /skipped.*aos-uninstall/);
    assert.match(cn.codenotchSummaryLine({ status: 'not-found', message: 'no public release' }), /FAILED.*unaffected/);
    assert.match(cn.codenotchSummaryLine({ status: 'checksum-mismatch', message: 'sha256 mismatch' }), /FAILED/);
});

test('installer --help lists the option', () => {
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'installer.js'), '--help'], { encoding: 'utf8', env: { ...process.env, HOME: root } });
    assert.match(r.stdout, /--codenotch/);
    assert.match(r.stdout, /--no-codenotch/);
    assert.match(r.stdout, /AOS_CODENOTCH=0/);
});

// ---- Windows (all fakes; nothing real is downloaded or executed)
const WIN_KEY = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Codenotch';
const LOCAL = 'C:\\Users\\Jo Doe\\AppData\\Local';
const UNINST = `${LOCAL}\\Programs\\Codenotch\\Uninstall Codenotch.exe`;
const regOut = (v, extra = {}) => ['', WIN_KEY, `    DisplayName    REG_SZ    Codenotch`, `    DisplayVersion    REG_SZ    ${v}`,
    `    UninstallString    REG_SZ    "${UNINST}" /currentuser`, ...Object.entries(extra).map(([k, x]) => `    ${k}    REG_SZ    ${x}`), ''].join('\r\n');

function winSetup({ tag = 'v1.2.0', sha = null, regVersion = null, assets, runFails = null, regAfter = '1.2.0', state, regScan = false } = {}) {
    const dir = fs.mkdtempSync(path.join(root, 'win-'));
    const stateFile = path.join(dir, 'home', '.agents', '.bdb-codenotch.json');
    if (state) { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(state)); }
    const exeName = `Codenotch-Setup-${tag.replace(/^v/, '')}.exe`;
    const calls = { fetch: [], run: [], reg: [] };
    let installerRan = false;
    const body = { tag_name: tag, assets: assets || [
        { name: exeName, browser_download_url: `https://dl/${exeName}` },
        { name: `${exeName}.sha256`, browser_download_url: `https://dl/${exeName}.sha256` }] };
    const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
    const res = (ok, st, data, buf) => ({ ok, status: st, headers: { get: () => null }, json: async () => data, arrayBuffer: async () => buf });
    const opts = {
        platform: 'win32', home: path.join(dir, 'home'), roots: { tmp: dir }, stateFile, interactive: false,
        fetch: async (url) => {
            calls.fetch.push(url);
            if (url.includes('api.github.com')) return res(true, 200, body);
            if (url.endsWith('.sha256')) return res(true, 200, null, ab(Buffer.from(`${sha || SHA}  ${exeName}\n`)));
            return res(true, 200, null, ab(DMG));
        },
        reg: (args) => {
            calls.reg.push(args);
            const v = installerRan ? regAfter : regVersion;
            if (v === null) throw new Error('ERROR: The system was unable to find the specified registry key or value.');
            const key = args[1];
            if (regScan) {
                if (key.endsWith('\\Uninstall')) return `\r\n${WIN_KEY.replace('\\Codenotch', '')}\\{GUID-1}\r\n${WIN_KEY.replace('\\Codenotch', '')}\\Other\r\n`;
                if (key.endsWith('{GUID-1}')) return regOut(v);
                throw new Error('not found');
            }
            return key.endsWith('\\Codenotch') ? regOut(v) : (() => { throw new Error('not found'); })();
        },
        runInstaller: (exe, args, timeoutMs) => {
            calls.run.push({ exe, args, timeoutMs });
            if (runFails) throw runFails;
            installerRan = true;
        },
        confirm: async () => true,
    };
    return { dir, stateFile, calls, opts };
}

test('win32: default-on success runs the installer with /S only, verifies registry, records state', async () => {
    const c = winSetup();
    const r = await cn.runCodenotchStep({ ...c.opts, argv: [], env: {}, interactive: false });
    assert.strictEqual(r.status, 'installed');
    assert.strictEqual(c.calls.run.length, 1);
    assert.deepStrictEqual(c.calls.run[0].args, ['/S']);
    assert.match(path.basename(c.calls.run[0].exe), /^Codenotch-Setup-1\.2\.0\.exe$/);
    assert.deepStrictEqual({ ...readState(c.stateFile), installedAt: undefined }, { platform: 'win32', uninstallPath: UNINST, version: '1.2.0', installedAt: undefined });
    assert.strictEqual(r.path, UNINST);
    assert.match(cn.codenotchSummaryLine(r), /installed.*Jo Doe.*aos-uninstall/);
    assert.deepStrictEqual(fs.readdirSync(c.dir).filter((n) => n.startsWith('aos-codenotch-')), []);
});

test('win32: opt-outs skip without any network or process', async () => {
    for (const [argv, env] of [[[], { AOS_CODENOTCH: '0' }], [['--no-codenotch'], {}]]) {
        const c = winSetup();
        const r = await cn.runCodenotchStep({ ...c.opts, argv, env, interactive: false });
        assert.strictEqual(r.status, 'opted-out');
        assert.strictEqual(c.calls.fetch.length, 0);
        assert.strictEqual(c.calls.run.length, 0);
    }
});

test('win32: checksum mismatch is refused and nothing runs', async () => {
    const c = winSetup({ sha: 'c'.repeat(64) });
    const r = await cn.runCodenotchStep({ ...c.opts, argv: [], env: {}, interactive: false });
    assert.strictEqual(r.status, 'checksum-mismatch');
    assert.strictEqual(c.calls.run.length, 0);
});

test('win32: asset selection is exact first, then the single *Setup*.exe, else refused', async () => {
    const mk = (n) => [{ name: n, browser_download_url: `https://dl/${n}` }, { name: `${n}.sha256`, browser_download_url: `https://dl/${n}.sha256` }];
    const tolerant = winSetup({ assets: mk('Codenotch-Setup-x64.exe') });
    assert.strictEqual((await cn.installCodenotch(tolerant.opts)).status, 'installed');
    const two = winSetup({ assets: [...mk('A-Setup.exe'), ...mk('B-Setup.exe')] });
    assert.strictEqual((await cn.installCodenotch(two.opts)).status, 'error');
    const noSha = winSetup({ assets: [{ name: 'Codenotch-Setup-1.2.0.exe', browser_download_url: 'https://dl/x' }] });
    const r = await cn.installCodenotch(noSha.opts);
    assert.strictEqual(r.status, 'error');
    assert.strictEqual(noSha.calls.run.length, 0);
});

test('win32: equal or newer installed version is skipped', async () => {
    for (const v of ['1.2.0', '2.0.0']) {
        const c = winSetup({ regVersion: v });
        const r = await cn.installCodenotch(c.opts);
        assert.strictEqual(r.status, 'up-to-date');
        assert.strictEqual(c.calls.run.length, 0);
        assert.match(cn.codenotchSummaryLine(r), /skipped/);
    }
});

test('win32: older foreign install is kept non-interactively, recorded one is updated', async () => {
    const foreign = winSetup({ regVersion: '1.0.0' });
    assert.strictEqual((await cn.installCodenotch(foreign.opts)).status, 'kept-foreign');
    assert.strictEqual(foreign.calls.run.length, 0);
    const ours = winSetup({ regVersion: '1.0.0', state: { platform: 'win32', uninstallPath: UNINST, version: '1.0.0' } });
    assert.strictEqual((await cn.installCodenotch(ours.opts)).status, 'updated');
});

test('win32: registry missing before install proceeds; missing after install is a failure, not recorded', async () => {
    const c = winSetup({ regVersion: null, regAfter: null });
    const r = await cn.installCodenotch(c.opts);
    assert.strictEqual(r.status, 'error');
    assert.strictEqual(c.calls.run.length, 1);
    assert.ok(!fs.existsSync(c.stateFile));
});

test('win32: registry fallback finds the install by DisplayName', async () => {
    const c = winSetup({ regVersion: '2.0.0', regScan: true });
    assert.strictEqual((await cn.installCodenotch(c.opts)).status, 'up-to-date');
});

test('win32: silent installer failure and timeout are warnings, never throws', async () => {
    const e = new Error('timed out after 300s');
    const t = winSetup({ runFails: e });
    const r = await cn.runCodenotchStep({ ...t.opts, argv: [], env: {}, interactive: false });
    assert.strictEqual(r.status, 'error');
    assert.match(r.message, /silent installer failed.*timed out/);
    assert.match(cn.codenotchSummaryLine(r), /FAILED/);
});

test('win32: default runner maps ETIMEDOUT and non-zero exit, passes timeout and /S', () => {
    let seen;
    assert.throws(() => cn.runWinProgram((exe, args, o) => { seen = { exe, args, o }; return { error: { code: 'ETIMEDOUT' } }; }, 'C:\\a b\\x.exe', ['/S'], 1500), /timed out after 2s/);
    assert.deepStrictEqual(seen.args, ['/S']);
    assert.strictEqual(seen.o.timeout, 1500);
    assert.throws(() => cn.runWinProgram(() => ({ status: 3 }), 'x', ['/S'], 1), /code 3/);
    assert.doesNotThrow(() => cn.runWinProgram(() => ({ status: 0 }), 'x', ['/S'], 1));
});

test('win32: uninstall string parsing handles quotes, spaces and backslashes', () => {
    assert.strictEqual(cn.uninstallExeFrom({ UninstallString: `"${UNINST}" /currentuser` }), UNINST);
    assert.strictEqual(cn.uninstallExeFrom({ UninstallString: 'C:\\Program Files\\Codenotch\\uninstall.exe /S' }), 'C:\\Program Files\\Codenotch\\uninstall.exe');
    assert.strictEqual(cn.uninstallExeFrom({ InstallLocation: `${LOCAL}\\Programs\\Codenotch` }), `${LOCAL}\\Programs\\Codenotch\\uninstall.exe`);
});

test('win32 uninstall: runs the recorded uninstaller with /S only while path and version match', () => {
    const state = { platform: 'win32', uninstallPath: UNINST, version: '1.2.0' };
    const mk = (reg, exists = () => true) => {
        const dir = fs.mkdtempSync(path.join(root, 'wu-'));
        const stateFile = path.join(dir, 's.json');
        fs.writeFileSync(stateFile, JSON.stringify(state));
        return { stateFile, plan: cn.planCodenotchUninstall({ stateFile, reg, exists }) };
    };
    const ran = [];
    const ok = mk((a) => regOut('1.2.0'));
    assert.strictEqual(ok.plan.action, 'remove');
    assert.strictEqual(cn.uninstallCodenotch(ok.plan, { stateFile: ok.stateFile, runUninstaller: (e, a) => ran.push([e, a]) }), 'remove');
    assert.deepStrictEqual(ran, [[UNINST, ['/S']]]);
    assert.ok(!fs.existsSync(ok.stateFile));

    for (const [label, m] of [['version changed', mk(() => regOut('1.3.0'))], ['registry missing', mk(() => { throw new Error('nf'); })], ['path changed', mk(() => regOut('1.2.0').replace(UNINST, 'C:\\other\\u.exe'))]]) {
        assert.strictEqual(m.plan.action, 'keep', label);
        assert.strictEqual(cn.uninstallCodenotch(m.plan, { stateFile: m.stateFile, runUninstaller: () => assert.fail('must not run') }), 'keep');
        assert.ok(fs.existsSync(m.stateFile));
    }
    const gone = mk(() => regOut('1.2.0'), () => false);
    assert.strictEqual(gone.plan.action, 'gone');
    const failing = mk(() => regOut('1.2.0'));
    assert.strictEqual(cn.uninstallCodenotch(failing.plan, { stateFile: failing.stateFile, runUninstaller: () => { throw new Error('x'); } }), 'error');
    assert.ok(fs.existsSync(failing.stateFile));
});

test('darwin is unchanged and linux stays a no-op through the step', async () => {
    const calls = [];
    assert.strictEqual((await cn.runCodenotchStep({ platform: 'darwin', argv: [], env: {}, interactive: false, install: fakeInstall(calls) })).status, 'installed');
    assert.strictEqual(await cn.runCodenotchStep({ platform: 'linux', argv: [], env: {}, interactive: false, install: fakeInstall(calls) }), null);
    assert.strictEqual(calls.length, 1);
});
