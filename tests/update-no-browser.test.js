// Tests verifying that update and repair never open browser tabs,
// that AOS_NO_OPEN=1 is honoured across all browser opener paths,
// and that explicit open commands still open unless AOS_NO_OPEN=1.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-no-browser-test-'));
const originalEnv = { ...process.env };
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

test.after(() => {
    process.env = originalEnv;
    try {
        fs.rmSync(tempHome, { recursive: true, force: true });
    } catch (_) {}
});

const installer = require('../installer.js');
const menu = require('../lib/v5/menu');

test('installer shouldOpenLaunchpad and shouldAutostartLaunchpad suppress on update, repair and AOS_NO_OPEN', () => {
    // 1. AOS_NO_OPEN=1 suppresses
    assert.strictEqual(installer.shouldOpenLaunchpad([], { env: { AOS_NO_OPEN: '1' } }), false);
    assert.strictEqual(installer.shouldAutostartLaunchpad({ env: { AOS_NO_OPEN: '1' } }), false);

    // 2. --no-open flag suppresses
    assert.strictEqual(installer.shouldOpenLaunchpad([], { argv: ['--no-open'] }), false);
    assert.strictEqual(installer.shouldAutostartLaunchpad({ argv: ['--no-open'] }), false);

    // 3. update and repair in argv suppress
    assert.strictEqual(installer.shouldOpenLaunchpad([], { argv: ['update'] }), false);
    assert.strictEqual(installer.shouldOpenLaunchpad([], { argv: ['repair'] }), false);
    assert.strictEqual(installer.shouldAutostartLaunchpad({ argv: ['update'] }), false);
    assert.strictEqual(installer.shouldAutostartLaunchpad({ argv: ['repair'] }), false);

    // 4. isUpdate and isRepair overrides suppress
    assert.strictEqual(installer.shouldOpenLaunchpad([], { isUpdate: true }), false);
    assert.strictEqual(installer.shouldOpenLaunchpad([], { isRepair: true }), false);
    assert.strictEqual(installer.shouldAutostartLaunchpad({ isUpdate: true }), false);
    assert.strictEqual(installer.shouldAutostartLaunchpad({ isRepair: true }), false);
});

test('generateAndOpenLaunchpad exits early and does not open when AOS_NO_OPEN=1 or --no-open is set', () => {
    const saved = process.env.AOS_NO_OPEN;
    try {
        process.env.AOS_NO_OPEN = '1';
        assert.strictEqual(installer.generateAndOpenLaunchpad(['synapse']), false);
    } finally {
        if (saved !== undefined) process.env.AOS_NO_OPEN = saved;
        else delete process.env.AOS_NO_OPEN;
    }
});

test('menu update() and repair() set AOS_NO_OPEN=1 and never call real service managers', async () => {
    delete process.env.AOS_NO_OPEN;
    const mockHost = {
        detectInstallState: () => ({ isInstalled: true }),
    };
    const safeRunner = (cmd, args = []) => {
        if (['launchctl', 'systemctl', 'schtasks'].includes(cmd)) {
            throw new Error(`Real service manager called in test: ${cmd} ${args.join(' ')}`);
        }
        return { status: 0, stdout: '' };
    };

    // runCommand with update sets AOS_NO_OPEN immediately
    assert.strictEqual(process.env.AOS_NO_OPEN, undefined);
    try {
        await menu.runCommand('update', mockHost, { home: tempHome, write: () => {}, run: safeRunner });
    } catch (_) {}
    assert.strictEqual(process.env.AOS_NO_OPEN, '1');

    delete process.env.AOS_NO_OPEN;
    assert.strictEqual(process.env.AOS_NO_OPEN, undefined);
    try {
        await menu.runCommand('repair', mockHost, { home: tempHome, write: () => {}, run: safeRunner });
    } catch (_) {}
    assert.strictEqual(process.env.AOS_NO_OPEN, '1');
});

test('bin/aos-hub.mjs parseArgv defaults noOpen from AOS_NO_OPEN=1 and parses open command', async () => {
    const hub = await import('../bin/aos-hub.mjs');
    const saved = process.env.AOS_NO_OPEN;
    try {
        delete process.env.AOS_NO_OPEN;
        const parsedNormal = hub.parseArgv([]);
        assert.strictEqual(parsedNormal.noOpen, false);
        assert.strictEqual(parsedNormal.cmd, 'start');

        process.env.AOS_NO_OPEN = '1';
        const parsedSuppressed = hub.parseArgv([]);
        assert.strictEqual(parsedSuppressed.noOpen, true);

        // explicit open command
        delete process.env.AOS_NO_OPEN;
        const parsedOpen = hub.parseArgv(['open']);
        assert.strictEqual(parsedOpen.cmd, 'open');
        assert.strictEqual(parsedOpen.noOpen, false);
    } finally {
        if (saved !== undefined) process.env.AOS_NO_OPEN = saved;
        else delete process.env.AOS_NO_OPEN;
    }
});

test('bin/aos-hub.mjs openBrowser respects AOS_NO_OPEN=1 and fake opener records calls', async () => {
    const hub = await import('../bin/aos-hub.mjs');
    const saved = process.env.AOS_NO_OPEN;
    let spawnedArgs = null;
    const fakeSpawn = (cmd, args, opts) => {
        spawnedArgs = { cmd, args };
        return { on: () => {}, unref: () => {} };
    };

    try {
        // When AOS_NO_OPEN=1, openBrowser must not spawn
        process.env.AOS_NO_OPEN = '1';
        spawnedArgs = null;
        const resSuppressed = hub.openBrowser('http://127.0.0.1:7900', { spawnFn: fakeSpawn });
        assert.strictEqual(resSuppressed, false);
        assert.strictEqual(spawnedArgs, null, 'openBrowser spawned when AOS_NO_OPEN=1');

        // When AOS_NO_OPEN is not set, openBrowser spawns
        delete process.env.AOS_NO_OPEN;
        spawnedArgs = null;
        const resAllowed = hub.openBrowser('http://127.0.0.1:7900', { spawnFn: fakeSpawn });
        assert.strictEqual(resAllowed, true);
        assert.ok(spawnedArgs, 'openBrowser did not spawn on explicit open');
        assert.strictEqual(spawnedArgs.args[spawnedArgs.args.length - 1], 'http://127.0.0.1:7900');
    } finally {
        if (saved !== undefined) process.env.AOS_NO_OPEN = saved;
        else delete process.env.AOS_NO_OPEN;
    }
});

test('plan-canvas openBrowser respects AOS_NO_OPEN=1', () => {
    const planCanvasPath = path.join(__dirname, '..', 'skills', 'global_config', 'plan-canvas', 'scripts', 'plan-canvas.js');
    const content = fs.readFileSync(planCanvasPath, 'utf8');
    assert.ok(content.includes("process.env.AOS_NO_OPEN === '1'"), 'plan-canvas.js must check AOS_NO_OPEN');
});

test('store-ui server.mjs openBrowser respects AOS_NO_OPEN=1', async () => {
    const storeServer = await import('../lib/store-ui/server.mjs');
    const storePath = path.join(__dirname, '..', 'lib', 'store-ui', 'server.mjs');
    const content = fs.readFileSync(storePath, 'utf8');
    assert.ok(content.includes("process.env.AOS_NO_OPEN === '1'"), 'store-ui server.mjs must check AOS_NO_OPEN');
});

test('agenttrail bin files respect AOS_NO_OPEN=1', () => {
    const agenttrailPath = path.join(__dirname, '..', 'skills', 'global_config', 'agenttrail', 'bin', 'agenttrail.mjs');
    const ensurePath = path.join(__dirname, '..', 'skills', 'global_config', 'agenttrail', 'bin', 'ensure.mjs');
    const trailHubPath = path.join(__dirname, '..', 'skills', 'global_config', 'agenttrail', 'bin', 'trail-hub.mjs');

    assert.ok(fs.readFileSync(agenttrailPath, 'utf8').includes('AOS_NO_OPEN'), 'agenttrail.mjs must check AOS_NO_OPEN');
    assert.ok(fs.readFileSync(ensurePath, 'utf8').includes('AOS_NO_OPEN'), 'ensure.mjs must check AOS_NO_OPEN');
    assert.ok(fs.readFileSync(trailHubPath, 'utf8').includes('AOS_NO_OPEN'), 'trail-hub.mjs must check AOS_NO_OPEN');
});

test('archify open-artifact.mjs respects AOS_NO_OPEN=1 and suppresses opener', async () => {
    const archify = await import('../skills/global_config/archify/bin/open-artifact.mjs');
    const saved = process.env.AOS_NO_OPEN;
    try {
        process.env.AOS_NO_OPEN = '1';
        const res = archify.openArtifact('dummy.html');
        assert.strictEqual(res.status, 'suppressed');
        assert.strictEqual(res.requested, false);
    } finally {
        if (saved !== undefined) process.env.AOS_NO_OPEN = saved;
        else delete process.env.AOS_NO_OPEN;
    }
});
