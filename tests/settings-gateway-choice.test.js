// The gateway adoption choice lives in v5-settings.json (gateway.adopted/declined/promptedAt/mode), never the server definitions.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cfg = require('../lib/gateway/config.js');
const menu = require('../lib/v5/menu.js');
const profile = require('../lib/v5/profile.js');
const adopt = require('../lib/gateway/adopt.js');
const gw = require('../lib/v5/packages.js').registry.find((p) => p.id === 'gateway');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gwchoice-'));
const ENTRY = (n) => ({ command: 'node', args: [`${n}.js`] });

function run(home, scanned, picks) {
    const out = [];
    const asked = [];
    const real = { scan: adopt.scanAdoptable, apply: adopt.applyAdopt, update: gw.update };
    adopt.scanAdoptable = () => ({ adoptable: scanned.map((name) => ({ name, entry: ENTRY(name) })) });
    adopt.applyAdopt = (o) => ({ adopted: o.only, files: [], skipped: [] });
    gw.update = async () => ({ ok: true });
    const ui = { multi: async (msg, items, initial) => { asked.push({ items: items.map((i) => i.value), initial }); return picks; } };
    return menu.adoptGateway({ home, write: (s) => out.push(s), adopt: true, ui }, path.join(home, 'adopt.log'))
        .finally(() => { adopt.scanAdoptable = real.scan; adopt.applyAdopt = real.apply; gw.update = real.update; })
        .then(() => ({ out, asked, settings: profile.readSettings(home).gateway }));
}

function homeWithToken() {
    const home = tmp();
    fs.mkdirSync(cfg.gatewayDir(home), { recursive: true });
    fs.writeFileSync(path.join(cfg.gatewayDir(home), 'token'), 'tok\n');
    return home;
}

test('first run asks and stores the picked names', async () => {
    const home = homeWithToken();
    const r = await run(home, ['foo', 'bar'], ['foo']);
    assert.equal(r.asked.length, 1);
    assert.deepStrictEqual(r.asked[0].initial, []);
    assert.deepStrictEqual(r.settings.adopted, ['foo']);
    assert.deepStrictEqual(r.settings.declined, ['bar']);
    assert.equal(r.settings.mode, 'gateway');
    assert.ok(!Number.isNaN(Date.parse(r.settings.promptedAt)));
});

test('second run with the same servers is silent', async () => {
    const home = homeWithToken();
    await run(home, ['foo', 'bar'], ['foo']);
    const r = await run(home, ['foo', 'bar'], ['foo']);
    assert.equal(r.asked.length, 0);
    assert.deepStrictEqual(r.out, []);
});

test('a new server asks again with the stored adopted set pre-ticked', async () => {
    const home = homeWithToken();
    await run(home, ['foo', 'bar'], ['foo']);
    const r = await run(home, ['foo', 'bar', 'baz'], ['foo', 'baz']);
    assert.equal(r.asked.length, 1);
    assert.deepStrictEqual(r.asked[0].initial, ['foo']);
    assert.deepStrictEqual(r.settings.adopted, ['foo', 'baz']);
    assert.deepStrictEqual(r.settings.declined, ['bar']);
});

test('"none" is remembered as declined and not asked again', async () => {
    const home = homeWithToken();
    const first = await run(home, ['foo', 'bar'], []);
    assert.deepStrictEqual(first.settings.adopted, []);
    assert.deepStrictEqual(first.settings.declined, ['foo', 'bar']);
    assert.equal(first.settings.mode, 'direct');
    const again = await run(home, ['foo', 'bar'], []);
    assert.equal(again.asked.length, 0);
});

test('settings hold names only, never the server definitions', async () => {
    const home = homeWithToken();
    await run(home, ['foo'], ['foo']);
    const raw = JSON.parse(fs.readFileSync(profile.settingsFile(home), 'utf8'));
    assert.deepStrictEqual(Object.keys(raw.gateway).sort(), ['adopted', 'declined', 'mode', 'promptedAt']);
    assert.ok(!JSON.stringify(raw).includes('foo.js'));
});

test('sanitizeSettings keeps valid gateway fields and drops bad ones', () => {
    const { settings, problems } = profile.sanitizeSettings({ gateway: { adopted: ['a', 3], declined: ['b'], mode: 'maybe', promptedAt: 'x' } }, null);
    assert.deepStrictEqual(settings.gateway, { declined: ['b'] });
    assert.equal(problems.length, 3);
});

function homeWithInstalledGateway() {
    const home = homeWithToken();
    const gdir = cfg.gatewayDir(home);
    const bin = path.join(gdir, 'node_modules', '.bin', process.platform === 'win32' ? '1mcp.cmd' : '1mcp');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n');
    const svc = process.platform === 'darwin'
        ? path.join(home, 'Library', 'LaunchAgents', 'com.bdb.aos.gateway.plist')
        : path.join(home, '.config', 'systemd', 'user', 'com.bdb.aos.gateway.service');
    fs.mkdirSync(path.dirname(svc), { recursive: true });
    fs.writeFileSync(svc, 'dummy\n');
    return home;
}

test('settings menu includes gateway option when gateway is installed', async () => {
    const home = homeWithInstalledGateway();
    let shownOptions = [];
    const ui = {
        select: async (msg, options) => {
            if (msg === 'Settings:') {
                shownOptions = options;
                return 'back';
            }
            return 'back';
        },
    };
    const installer = require('../installer.js');
    const host = {
        ...installer,
        detectInstallState: () => ({ isInstalled: true }),
        isNewerVersion: () => false,
    };
    await menu.settings(host, { home, ui, write: () => {} });
    const gwOpt = shownOptions.find((o) => o.value === 'gateway');
    assert.ok(gwOpt, 'gateway option should be visible in settings');
    assert.match(gwOpt.label, /Gateway/);
});

test('gatewaySettings menu dispatches direct option', async () => {
    const home = homeWithToken();
    profile.writeSettings(home, { gateway: { adopted: ['foo'], mode: 'gateway' } });
    const out = [];
    const ui = {
        select: async (msg, options) => 'direct',
    };
    const b = { home, host: {} };
    const fakeGw = { verify: async () => ({ ok: true, detail: 'running' }), update: async () => ({ ok: true }) };
    await menu.gatewaySettings({}, { home, ui, write: (s) => out.push(s) }, b, fakeGw);
    const updated = profile.readSettings(home).gateway;
    assert.strictEqual(updated.mode, 'direct');
});
