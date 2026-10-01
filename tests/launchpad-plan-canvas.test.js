const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    shouldOpenLaunchpad,
    shouldAutostartPlanCanvas,
    buildPlanCanvasPlist,
    buildPlanCanvasWinFiles,
    installPlanCanvasAutostart,
    LAUNCHPAD_WEB_MODULES,
} = require('../installer.js');

const src = fs.readFileSync(path.join(__dirname, '..', 'installer.js'), 'utf8');

function tmpHome() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'aos-pc-home-'));
}

describe('launchpad Plan Canvas card', () => {
    test('card links to :4519, shows port pill, status dot and copyable start command', () => {
        assert.match(src, /<a class="card" href="http:\/\/127\.0\.0\.1:4519\/"/);
        assert.match(src, /<span class="port-pill">:4519<\/span>/);
        assert.match(src, /id="dot-plancanvas"/);
        assert.match(src, /checkHealth\('http:\/\/127\.0\.0\.1:4519', 'dot-plancanvas'\)/);
        assert.match(src, /offline — run: <code data-copy="aos-plan-canvas server"/);
    });

    test('plan-canvas is not a launchpad-opening module', () => {
        assert.ok(!LAUNCHPAD_WEB_MODULES.includes('plan-canvas'));
        const home = tmpHome();
        try {
            assert.equal(shouldOpenLaunchpad(['plan-canvas'], { homeDir: home, env: {}, argv: ['node', 'i.js'] }), false);
        } finally { fs.rmSync(home, { recursive: true, force: true }); }
    });
});

describe('Plan Canvas autostart', () => {
    test('opt-in only, and not implied by a dev checkout', () => {
        assert.equal(shouldAutostartPlanCanvas({ argv: ['node', 'i.js'] }), false);
        assert.equal(shouldAutostartPlanCanvas({ argv: ['node', 'i.js', '--autostart-plan-canvas'] }), true);
    });

    test('plist runs the server with idle exit disabled', () => {
        const plist = buildPlanCanvasPlist({ nodeBin: '/usr/bin/node', scriptPath: '/s/plan-canvas.js', home: '/h', logDir: '/h/.agents/logs' });
        assert.match(plist, /<string>com\.bdb\.plan-canvas<\/string>/);
        assert.match(plist, /<string>\/usr\/bin\/node<\/string>\s*<string>\/s\/plan-canvas\.js<\/string>\s*<string>server<\/string>/);
        assert.match(plist, /<key>AOS_PLAN_CANVAS_IDLE_MS<\/key>\s*<string>0<\/string>/);
        assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
    });

    test('windows bat/vbs set idle off and start hidden', () => {
        const f = buildPlanCanvasWinFiles({ nodeBin: 'C:\\node.exe', scriptPath: 'C:\\pc.js', home: 'C:\\h', logDir: 'C:\\h\\logs', batPath: 'C:\\h\\run.bat' });
        assert.match(f.bat, /set AOS_PLAN_CANVAS_IDLE_MS=0/);
        assert.match(f.bat, /"C:\\node\.exe" "C:\\pc\.js" server/);
        assert.match(f.vbs, /"""C:\\h\\run\.bat""", 0, False/);
    });

    test('dry-run and missing flag write nothing; opt-in writes plist idempotently into the injected home', () => {
        const home = tmpHome();
        try {
            const base = { homeDir: home, platform: 'darwin', skipLaunchctl: true, nodeBin: '/usr/bin/node' };
            assert.equal(installPlanCanvasAutostart({ ...base, argv: ['node', 'i.js'] }), false);
            assert.equal(installPlanCanvasAutostart({ ...base, argv: ['node', 'i.js', '--autostart-plan-canvas'], dryRun: true }), false);
            assert.deepEqual(fs.readdirSync(home), []);

            const opts = { ...base, argv: ['node', 'i.js', '--autostart-plan-canvas'], dryRun: false };
            assert.equal(installPlanCanvasAutostart(opts), true);
            const plistPath = path.join(home, 'Library', 'LaunchAgents', 'com.bdb.plan-canvas.plist');
            const first = fs.readFileSync(plistPath, 'utf8');
            assert.match(first, /AOS_PLAN_CANVAS_IDLE_MS/);
            assert.equal(installPlanCanvasAutostart(opts), true);
            assert.equal(fs.readFileSync(plistPath, 'utf8'), first);
        } finally { fs.rmSync(home, { recursive: true, force: true }); }
    });
});
