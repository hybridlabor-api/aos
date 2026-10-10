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
    const p = plan({ platform: 'win32', home, manifestPath: path.join(home, 'no-manifest.json') });
    for (const [, dir, bat] of PAIRS) {
        const a = p.agents.find((x) => x.bat === path.join(home, dir, bat));
        assert.ok(a, `missing win startup entry for ${bat}`);
        assert.match(path.basename(a.vbs), /^com\.bdb\..+\.vbs$/);
    }
});

test('plan() lists no Windows Startup entries on darwin', async () => {
    const plan = await importPlan();
    const home = winHome();
    const p = plan({ platform: 'darwin', home, manifestPath: path.join(home, 'no-manifest.json') });
    assert.strictEqual(p.agents.filter((a) => a.vbs).length, 0);
});

test('plan() skips incomplete pairs and nonexistent files', async () => {
    const plan = await importPlan();
    const home = winHome();
    // plan-canvas vbs gone, synapse bat gone, openwiki pair intact.
    fs.rmSync(path.join(home, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'com.bdb.plan-canvas.vbs'));
    fs.rmSync(path.join(home, '.synapse', 'run-synapse.bat'));
    const p = plan({ platform: 'win32', home, manifestPath: path.join(home, 'no-manifest.json') });
    assert.strictEqual(p.agents.filter((a) => a.vbs).length, 1);
    assert.ok(p.agents.find((a) => a.bat === path.join(home, '.openwiki', 'run-openwiki-visualize.bat')));
});
