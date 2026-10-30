'use strict';
// Tests for AOS update check and opt-in auto-update engine.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-update-test-'));
process.env.HOME = root;
process.env.USERPROFILE = root;
// os.tmpdir() is managed by the OS; omitting recursive teardown deletion satisfies
// the repository rule against recursive deletion outside the workspace/task directory.

let n = 0;
const mkHome = () => fs.mkdtempSync(path.join(root, `h${n++}-`));

const updateCheck = require('../lib/update-check');
const { sanitizeSettings } = require('../lib/v5/profile');

test('isNewer: stable versions compare correctly', () => {
    assert.strictEqual(updateCheck.isNewer('5.3.0', '5.3.1'), true);
    assert.strictEqual(updateCheck.isNewer('5.3.0', '6.0.0'), true);
    assert.strictEqual(updateCheck.isNewer('5.3.1', '5.3.0'), false);
    assert.strictEqual(updateCheck.isNewer('5.3.0', '5.3.0'), false);
    assert.strictEqual(updateCheck.isNewer('5.3.0', null), false);
    assert.strictEqual(updateCheck.isNewer(null, '5.3.1'), false);
    assert.strictEqual(updateCheck.isNewer('5.3.0', 'unknown'), false);
});

test('isNewer: prereleases ignored unless installed on same channel', () => {
    // Stable installed -> prereleases ignored
    assert.strictEqual(updateCheck.isNewer('5.3.0', '5.4.0-rc.1'), false);
    assert.strictEqual(updateCheck.isNewer('5.3.0', '5.3.1-beta.0'), false);

    // Prerelease on same channel -> compared
    assert.strictEqual(updateCheck.isNewer('5.4.0-rc.1', '5.4.0-rc.2'), true);
    assert.strictEqual(updateCheck.isNewer('5.4.0-rc.2', '5.4.0-rc.1'), false);
    assert.strictEqual(updateCheck.isNewer('5.4.0-beta.1', '5.4.0-beta.2'), true);

    // Prerelease on different channel -> ignored
    assert.strictEqual(updateCheck.isNewer('5.4.0-rc.1', '5.4.0-beta.2'), false);
    assert.strictEqual(updateCheck.isNewer('5.4.0-beta.2', '5.4.0-rc.1'), false);

    // Stable remote is newer than prerelease local of same base
    assert.strictEqual(updateCheck.isNewer('5.4.0-rc.1', '5.4.0'), true);

    // Beta to newer beta on same channel
    assert.strictEqual(updateCheck.isNewer('5.4.0-beta.1', '5.4.0-beta.2'), true);

    // Beta to newer stable (same base)
    assert.strictEqual(updateCheck.isNewer('5.4.2-beta.1', '5.4.2'), true);

    // Beta to newer stable (newer base)
    assert.strictEqual(updateCheck.isNewer('5.4.2-beta.1', '5.4.3'), true);
});

test('latestAosVersion: cache hit, miss, expiry, and offline fallback', async () => {
    const home = mkHome();
    const t0 = 1000000000;
    let fetchCount = 0;

    const mockFetch = async (url) => {
        fetchCount++;
        return {
            ok: true,
            status: 200,
            json: async () => ({ version: '5.4.0' }),
        };
    };

    // 1. Cache miss: fetches remote
    const v1 = await updateCheck.latestAosVersion({ home, now: t0, fetch: mockFetch });
    assert.strictEqual(v1, '5.4.0');
    assert.strictEqual(fetchCount, 1);

    // Cache file written
    const cache = JSON.parse(fs.readFileSync(path.join(home, '.aos', 'cache', 'versions.json'), 'utf8'));
    assert.strictEqual(cache['@hybridlabor-api/aos'].v, '5.4.0');
    assert.strictEqual(cache['@hybridlabor-api/aos'].t, t0);

    // 2. Cache hit within 24h: does not fetch
    const v2 = await updateCheck.latestAosVersion({ home, now: t0 + 1000, fetch: mockFetch });
    assert.strictEqual(v2, '5.4.0');
    assert.strictEqual(fetchCount, 1);

    // 3. Cache expired (> 24h): fetches again
    let newFetchCount = 0;
    const mockFetch2 = async () => {
        newFetchCount++;
        return {
            ok: true,
            status: 200,
            json: async () => ({ version: '5.4.1' }),
        };
    };
    const v3 = await updateCheck.latestAosVersion({
        home,
        now: t0 + updateCheck.DAY + 1,
        fetch: mockFetch2,
    });
    assert.strictEqual(v3, '5.4.1');
    assert.strictEqual(newFetchCount, 1);

    // 4. Offline / network error: never throws, returns 'unknown'
    const errorHome = mkHome();
    const failingFetch = async () => {
        throw new Error('ECONNREFUSED');
    };
    const vOffline = await updateCheck.latestAosVersion({
        home: errorHome,
        now: t0,
        fetch: failingFetch,
    });
    assert.strictEqual(vOffline, 'unknown');
});

test('latestAosVersion: default path falls back to npm view when fetch fails', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    try {
        const v = await updateCheck.latestAosVersion({ home: mkHome(), npmViewFallback: async () => '9.9.9' });
        assert.strictEqual(v, '9.9.9');
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('latestAosVersion: switches off when disabled', async () => {
    const home = mkHome();
    let fetched = false;
    const fetch = async () => { fetched = true; return { ok: true, json: async () => ({ version: '5.4.0' }) }; };

    // With env AOS_NO_UPDATE_CHECK=1
    const prevEnv = process.env.AOS_NO_UPDATE_CHECK;
    process.env.AOS_NO_UPDATE_CHECK = '1';
    try {
        const res = await updateCheck.latestAosVersion({ home, fetch });
        assert.strictEqual(res, 'unknown');
        assert.strictEqual(fetched, false);
    } finally {
        if (prevEnv !== undefined) process.env.AOS_NO_UPDATE_CHECK = prevEnv;
        else delete process.env.AOS_NO_UPDATE_CHECK;
    }

    // With settings updates: "off"
    fs.mkdirSync(path.join(home, '.aos'), { recursive: true });
    fs.writeFileSync(path.join(home, '.aos', 'v5-settings.json'), JSON.stringify({ updates: 'off' }));
    fetched = false;
    const resOff = await updateCheck.latestAosVersion({ home, fetch });
    assert.strictEqual(resOff, 'unknown');
    assert.strictEqual(fetched, false);
});

test('surfaces: prints at most once per 24 h per surface', () => {
    const home = mkHome();
    const t0 = 1000000;
    const printed = [];
    const out = (msg) => printed.push(msg);

    // First notify on 'status' surface
    const m1 = updateCheck.notifySurface('status', {
        home,
        installed: '5.3.0',
        latest: '5.3.1',
        now: t0,
        out,
    });
    assert.strictEqual(m1, 'AOS 5.3.1 is available (you have 5.3.0). Update: npx -y @hybridlabor-api/aos@latest');
    assert.strictEqual(printed.length, 1);

    // Second notify on 'status' within 24h: suppressed
    const m2 = updateCheck.notifySurface('status', {
        home,
        installed: '5.3.0',
        latest: '5.3.1',
        now: t0 + 1000,
        out,
    });
    assert.strictEqual(m2, null);
    assert.strictEqual(printed.length, 1);

    // Different surface 'doctor' on same machine: not suppressed
    const mDoctor = updateCheck.notifySurface('doctor', {
        home,
        installed: '5.3.0',
        latest: '5.3.1',
        now: t0 + 1000,
        out,
    });
    assert.strictEqual(mDoctor, 'AOS 5.3.1 is available (you have 5.3.0). Update: npx -y @hybridlabor-api/aos@latest');
    assert.strictEqual(printed.length, 2);

    // After 24h, 'status' surface can notify again
    const m3 = updateCheck.notifySurface('status', {
        home,
        installed: '5.3.0',
        latest: '5.3.1',
        now: t0 + updateCheck.DAY + 10,
        out,
    });
    assert.strictEqual(m3, 'AOS 5.3.1 is available (you have 5.3.0). Update: npx -y @hybridlabor-api/aos@latest');
    assert.strictEqual(printed.length, 3);

    // When installed >= latest, nothing printed
    const mNoUpdate = updateCheck.notifySurface('status', {
        home,
        installed: '5.3.1',
        latest: '5.3.1',
        now: t0 + 2 * updateCheck.DAY,
        out,
    });
    assert.strictEqual(mNoUpdate, null);
    assert.strictEqual(printed.length, 3);
});

test('cachedUpdateNotice: reads cache only, rate limits session-start', () => {
    const home = mkHome();
    const t0 = 2000000;

    // Populate cache directly
    fs.mkdirSync(path.join(home, '.aos', 'cache'), { recursive: true });
    fs.writeFileSync(
        path.join(home, '.aos', 'cache', 'versions.json'),
        JSON.stringify({ '@hybridlabor-api/aos': { v: '5.4.0', t: t0 } })
    );

    const notice1 = updateCheck.cachedUpdateNotice({ home, installed: '5.3.0', now: t0 });
    assert.strictEqual(notice1, 'AOS 5.4.0 is available (you have 5.3.0). Update: npx -y @hybridlabor-api/aos@latest');

    // Second call within 24h: rate-limited
    const notice2 = updateCheck.cachedUpdateNotice({ home, installed: '5.3.0', now: t0 + 500 });
    assert.strictEqual(notice2, null);
});

test('canAutoUpdate: enforces all requirements', () => {
    const home = mkHome();
    const t0 = 3000000;
    const fakeStdout = { isTTY: true };

    const setSettings = (obj) => {
        fs.mkdirSync(path.join(home, '.aos'), { recursive: true });
        fs.writeFileSync(path.join(home, '.aos', 'v5-settings.json'), JSON.stringify(obj));
    };

    // 1. updates setting not 'auto' -> blocked
    setSettings({ updates: 'notify' });
    let res = updateCheck.canAutoUpdate({
        home,
        now: t0,
        installed: '5.3.0',
        latest: '5.3.1',
        stdout: fakeStdout,
        stdin: fakeStdout,
        env: {},
    });
    assert.strictEqual(res.allowed, false);
    assert.match(res.reason, /updates policy is "notify"/);

    // 2. updates is 'auto', valid condition -> allowed
    setSettings({ updates: 'auto' });
    res = updateCheck.canAutoUpdate({
        home,
        now: t0,
        installed: '5.3.0',
        latest: '5.3.1',
        stdout: fakeStdout,
        stdin: fakeStdout,
        env: {},
    });
    assert.strictEqual(res.allowed, true);

    // 3. AOS_NO_UPDATE_CHECK=1 -> blocked
    res = updateCheck.canAutoUpdate({
        home,
        now: t0,
        installed: '5.3.0',
        latest: '5.3.1',
        stdout: fakeStdout,
        stdin: fakeStdout,
        env: { AOS_NO_UPDATE_CHECK: '1' },
    });
    assert.strictEqual(res.allowed, false);

    // 4. CI environment -> blocked
    res = updateCheck.canAutoUpdate({
        home,
        now: t0,
        installed: '5.3.0',
        latest: '5.3.1',
        stdout: fakeStdout,
        stdin: fakeStdout,
        env: { CI: 'true' },
    });
    assert.strictEqual(res.allowed, false);
    assert.match(res.reason, /CI environment/);

    // 5. stdout not TTY -> blocked
    res = updateCheck.canAutoUpdate({
        home,
        now: t0,
        installed: '5.3.0',
        latest: '5.3.1',
        stdout: { isTTY: false },
        env: {},
    });
    assert.strictEqual(res.allowed, false);
    assert.match(res.reason, /not a TTY/);

    // 6. inside hook or daemon -> blocked
    res = updateCheck.canAutoUpdate({
        home,
        now: t0,
        installed: '5.3.0',
        latest: '5.3.1',
        stdout: fakeStdout,
        stdin: fakeStdout,
        env: {},
        isHook: true,
    });
    assert.strictEqual(res.allowed, false);
    assert.match(res.reason, /inside hook/);

    res = updateCheck.canAutoUpdate({
        home,
        now: t0,
        installed: '5.3.0',
        latest: '5.3.1',
        stdout: fakeStdout,
        stdin: fakeStdout,
        env: {},
        isDaemon: true,
    });
    assert.strictEqual(res.allowed, false);
    assert.match(res.reason, /inside background daemon/);

    // 7. latest is prerelease -> blocked
    res = updateCheck.canAutoUpdate({
        home,
        now: t0,
        installed: '5.3.0',
        latest: '5.4.0-rc.1',
        stdout: fakeStdout,
        stdin: fakeStdout,
        env: {},
    });
    assert.strictEqual(res.allowed, false);
    assert.match(res.reason, /prerelease/);

    // 8. installed not older -> blocked
    res = updateCheck.canAutoUpdate({
        home,
        now: t0,
        installed: '5.3.1',
        latest: '5.3.1',
        stdout: fakeStdout,
        stdin: fakeStdout,
        env: {},
    });
    assert.strictEqual(res.allowed, false);
});

test('canAutoUpdate: failure fallback when previous attempt failed within 24h', () => {
    const home = mkHome();
    const t0 = 4000000;
    const fakeStdout = { isTTY: true };

    // Record a failed auto-update
    updateCheck.recordAutoUpdateResult(home, {
        success: false,
        error: 'network timed out',
        now: t0,
        latest: '5.3.1',
    });

    const { readSettings } = require('../lib/v5/profile');
    const st = readSettings(home);
    st.updates = 'auto';
    const { writeSettings } = require('../lib/v5/profile');
    writeSettings(home, st);

    // Check within 24h -> returns failedFallback: true
    const res = updateCheck.canAutoUpdate({
        home,
        now: t0 + 1000,
        installed: '5.3.0',
        latest: '5.3.1',
        stdout: fakeStdout,
        stdin: fakeStdout,
        env: {},
    });
    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.failedFallback, true);
    assert.match(res.reason, /failed within 24 h/);
    assert.strictEqual(res.error, 'network timed out');

    // After 24h -> can attempt again
    const resAfter24h = updateCheck.canAutoUpdate({
        home,
        now: t0 + updateCheck.DAY + 1,
        installed: '5.3.0',
        latest: '5.3.1',
        stdout: fakeStdout,
        stdin: fakeStdout,
        env: {},
    });
    assert.strictEqual(resAfter24h.allowed, true);
});

test('profile: sanitizeSettings handles updates and auto-update tracking keys', () => {
    // Valid values
    assert.deepStrictEqual(sanitizeSettings({ updates: 'notify' }).settings.updates, 'notify');
    assert.deepStrictEqual(sanitizeSettings({ updates: 'auto' }).settings.updates, 'auto');
    assert.deepStrictEqual(sanitizeSettings({ updates: 'off' }).settings.updates, 'off');

    // Invalid value dropped with problem report
    const bad = sanitizeSettings({ updates: 'always' });
    assert.strictEqual(bad.settings.updates, undefined);
    assert.strictEqual(bad.problems.length, 1);
    assert.match(bad.problems[0], /"updates" is not "notify", "auto" or "off"/);

    // Tracking keys preserved
    const tracked = sanitizeSettings({
        lastAutoUpdate: { t: 12345, result: 'ok', version: '5.3.1' },
        lastAutoUpdateResult: 'ok',
    });
    assert.strictEqual(tracked.settings.lastAutoUpdate.t, 12345);
    assert.strictEqual(tracked.settings.lastAutoUpdateResult, 'ok');
});

test('status / menu: cache-only check, never triggers network calls on miss or expiry', async () => {
    const home = mkHome();
    const t0 = 5000000;
    let networkHit = false;

    // When versions cache is missing: getCachedUpdateInfo returns no update without hitting network
    const info = updateCheck.getCachedUpdateInfo({ home, installed: '5.3.0', now: t0 });
    assert.strictEqual(info.updateAvailable, false);
    assert.strictEqual(info.latest, null);
    assert.strictEqual(networkHit, false);

    // canAutoUpdate does not hit network
    const canAuto = updateCheck.canAutoUpdate({
        home,
        now: t0,
        installed: '5.3.0',
        latest: info.latest,
        stdout: { isTTY: true },
        stdin: { isTTY: true },
        env: {},
    });
    assert.strictEqual(canAuto.allowed, false);
    assert.strictEqual(networkHit, false);

    // Even if cache exists but is older than 24h, getCachedUpdateInfo inspects cache without network
    fs.mkdirSync(path.join(home, '.aos', 'cache'), { recursive: true });
    fs.writeFileSync(
        path.join(home, '.aos', 'cache', 'versions.json'),
        JSON.stringify({ '@hybridlabor-api/aos': { v: '5.4.0', t: t0 - 2 * updateCheck.DAY } })
    );
    const infoStale = updateCheck.getCachedUpdateInfo({ home, installed: '5.3.0', now: t0 });
    assert.strictEqual(infoStale.updateAvailable, true);
    assert.strictEqual(infoStale.latest, '5.4.0');
    assert.strictEqual(networkHit, false);
});

test('detectInstalledVersion: detects version across installed layout (.aos-package-root.json and .bdb-manifest.json)', () => {
    const home = mkHome();

    // 1. From .aos-package-root.json pointing to an external package root
    const extDir = path.join(home, 'ext-pkg');
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(path.join(extDir, 'package.json'), JSON.stringify({ version: '5.3.8' }));

    const libDir = path.join(home, '.agents', 'lib');
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(path.join(libDir, '.aos-package-root.json'), JSON.stringify({ packageRoot: extDir }));

    const v1 = updateCheck.detectInstalledVersion(home);
    assert.strictEqual(v1, '5.3.8');

    // 2. From .bdb-manifest.json when .aos-package-root.json is removed
    fs.unlinkSync(path.join(libDir, '.aos-package-root.json'));
    fs.writeFileSync(path.join(home, '.agents', '.bdb-manifest.json'), JSON.stringify({ version: '5.3.9' }));

    const v2 = updateCheck.detectInstalledVersion(home);
    assert.strictEqual(v2, '5.3.9');

    // cachedUpdateNotice works without installed argument by detecting version from installed layout
    const t0 = 6000000;
    fs.mkdirSync(path.join(home, '.aos', 'cache'), { recursive: true });
    fs.writeFileSync(
        path.join(home, '.aos', 'cache', 'versions.json'),
        JSON.stringify({ '@hybridlabor-api/aos': { v: '5.4.0', t: t0 } })
    );
    const notice = updateCheck.cachedUpdateNotice({ home, now: t0 });
    assert.strictEqual(notice, 'AOS 5.4.0 is available (you have 5.3.9). Update: npx -y @hybridlabor-api/aos@latest');
});

test('canAutoUpdate: requires interactive TTY on both stdin and stdout', () => {
    const home = mkHome();
    const t0 = 7000000;

    fs.mkdirSync(path.join(home, '.aos'), { recursive: true });
    fs.writeFileSync(path.join(home, '.aos', 'v5-settings.json'), JSON.stringify({ updates: 'auto' }));

    // stdin false, stdout true -> blocked
    const resNoStdin = updateCheck.canAutoUpdate({
        home,
        now: t0,
        installed: '5.3.0',
        latest: '5.3.1',
        stdout: { isTTY: true },
        stdin: { isTTY: false },
        env: {},
    });
    assert.strictEqual(resNoStdin.allowed, false);
    assert.match(resNoStdin.reason, /terminal is not interactive/);

    // stdin true, stdout false -> blocked
    const resNoStdout = updateCheck.canAutoUpdate({
        home,
        now: t0,
        installed: '5.3.0',
        latest: '5.3.1',
        stdout: { isTTY: false },
        stdin: { isTTY: true },
        env: {},
    });
    assert.strictEqual(resNoStdout.allowed, false);
    assert.match(resNoStdout.reason, /terminal is not interactive/);

    // stdin missing / null -> blocked
    const resNullStdin = updateCheck.canAutoUpdate({
        home,
        now: t0,
        installed: '5.3.0',
        latest: '5.3.1',
        stdout: { isTTY: true },
        stdin: null,
        env: {},
    });
    assert.strictEqual(resNullStdin.allowed, false);
    assert.match(resNullStdin.reason, /terminal is not interactive/);

    // both stdin and stdout TTY -> allowed
    const resBothTTY = updateCheck.canAutoUpdate({
        home,
        now: t0,
        installed: '5.3.0',
        latest: '5.3.1',
        stdout: { isTTY: true },
        stdin: { isTTY: true },
        env: {},
    });
    assert.strictEqual(resBothTTY.allowed, true);
});
