const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// plan() lives in the ESM uninstaller; importing it must not run the CLI flow
// (the entry-point guard in the file handles that).
const importPlan = async () => {
    const mod = await import(pathToFileURL(path.join(__dirname, '..', 'bin', 'aos-uninstall.mjs')).href);
    return mod.plan;
};

const PAIRS = [
    ['com.bdb.plan-canvas.vbs', '.agents', 'run-plan-canvas.bat'],
    ['com.bdb.synapse.vbs', '.synapse', 'run-synapse.bat'],
    ['com.bdb.openwiki-visualize.vbs', '.openwiki', 'run-openwiki-visualize.bat'],
];

function winHome() {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-winun-'));
    const startup = path.join(home, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    fs.mkdirSync(startup, { recursive: true });
    // plan() reads %APPDATA% before falling back to <home>AppDataRoaming, so point it at the fixture.
    process.env.APPDATA = path.join(home, 'AppData', 'Roaming');
    for (const [vbs, dir, bat] of PAIRS) {
        fs.mkdirSync(path.join(home, dir), { recursive: true });
        fs.writeFileSync(path.join(home, dir, bat), '@echo off\r\ngoto loop\r\n');
        fs.writeFileSync(path.join(startup, vbs), "'launcher\r\n");
    }
    return home;
}

test('plan() lists the Windows Startup vbs/bat pairs on win32', async () => {
    const plan = await importPlan();
    const home = winHome();
    const p = plan({ platform: 'win32', home, appData: path.join(home, 'AppData', 'Roaming'), manifestPath: path.join(home, 'no-manifest.json') });
    for (const [, dir, bat] of PAIRS) {
        const a = p.agents.find((x) => x.bat === path.join(home, dir, bat));
        assert.ok(a, `missing win startup entry for ${bat}`);
        assert.match(path.basename(a.vbs), /^com\.bdb\..+\.vbs$/);
    }
});

test('plan() lists no Windows Startup entries on darwin', async () => {
    const plan = await importPlan();
    const home = winHome();
    const p = plan({ platform: 'darwin', home, appData: path.join(home, 'AppData', 'Roaming'), manifestPath: path.join(home, 'no-manifest.json') });
    assert.strictEqual(p.agents.filter((a) => a.vbs).length, 0);
});

test('v5 gateway/hub Startup vbs are planned on win32 and removed with one stop each', async () => {
    const mod = await import(pathToFileURL(path.join(__dirname, '..', 'bin', 'aos-uninstall.mjs')).href);
    const home = winHome();
    const appData = path.join(home, 'AppData', 'Roaming');
    const startup = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    const vbsFiles = ['com.bdb.aos.gateway.vbs', 'com.bdb.aos.hub.vbs'].map((n) => path.join(startup, n));
    vbsFiles.forEach((f) => fs.writeFileSync(f, "'launcher\r\n"));
    const opts = { home, appData, manifestPath: path.join(home, 'no-manifest.json') };

    assert.deepStrictEqual(mod.plan({ ...opts, platform: 'win32' }).winSvc.map((s) => s.vbs), vbsFiles);
    assert.deepStrictEqual(mod.plan({ ...opts, platform: 'darwin' }).winSvc, []);

    const calls = [];
    const p = mod.plan({ ...opts, platform: 'win32' });
    mod.removeWinServices(p.winSvc, (cmd, args) => calls.push([cmd, args.join(' ')]));
    mod.removeWinServices(p.winSvc, () => {}); // idempotent: files already gone
    assert.strictEqual(calls.length, 2);
    assert.match(calls[0][1], /aos-gateway\.mjs/);
    assert.match(calls[1][1], /aos-hub\.mjs/);
    vbsFiles.forEach((f) => assert.strictEqual(fs.existsSync(f), false));
});

test('removeWinServices matches only the full path under this home and only this user\'s processes', async () => {
    const mod = await import(pathToFileURL(path.join(__dirname, '..', 'bin', 'aos-uninstall.mjs')).href);
    const ws = require('../lib/v5/win-startup.js');
    const home = winHome();
    const appData = path.join(home, 'AppData', 'Roaming');
    const startup = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    fs.writeFileSync(path.join(startup, 'com.bdb.aos.gateway.vbs'), "'launcher\r\n");
    const p = mod.plan({ home, appData, platform: 'win32', manifestPath: path.join(home, 'no-manifest.json') });
    const calls = [];
    mod.removeWinServices(p.winSvc, (cmd, args) => calls.push(args.join(' ')));
    const want = ws.norm(path.join(home, '.agents', 'bin', 'aos-gateway.mjs'));
    assert.ok(calls[0].includes(want), 'stop call carries the lower-cased full profile path');
    assert.ok(calls[0].includes('GetOwner') && calls[0].includes('$env:USERNAME'), 'owner filter present');
    assert.ok(calls[0].includes('$PID'), 'self exclusion kept');
    assert.ok(!calls[0].includes("Contains('bin\\aos-gateway.mjs')"), 'bare suffix is gone');
});

test('matchesCmd: own profile path matches, another profile does not (case and separators ignored)', () => {
    const ws = require('../lib/v5/win-startup.js');
    const mine = 'C:\\Users\\api\\.agents\\bin\\aos-gateway.mjs';
    assert.ok(ws.matchesCmd('"C:\\Program Files\\nodejs\\node.exe" "c:/users/API/.agents/bin/aos-gateway.mjs" serve', [mine]));
    assert.ok(!ws.matchesCmd('"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\Yola\\.agents\\bin\\aos-gateway.mjs" serve', [mine]));
    assert.ok(!ws.matchesCmd(null, [mine]));
});

test('plan() skips incomplete pairs and nonexistent files', async () => {
    const plan = await importPlan();
    const home = winHome();
    // plan-canvas vbs gone, synapse bat gone, openwiki pair intact.
    fs.rmSync(path.join(home, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'com.bdb.plan-canvas.vbs'));
    fs.rmSync(path.join(home, '.synapse', 'run-synapse.bat'));
    const p = plan({ platform: 'win32', home, appData: path.join(home, 'AppData', 'Roaming'), manifestPath: path.join(home, 'no-manifest.json') });
    assert.strictEqual(p.agents.filter((a) => a.vbs).length, 1);
    assert.ok(p.agents.find((a) => a.bat === path.join(home, '.openwiki', 'run-openwiki-visualize.bat')));
});
