// Tests for launchd service verification, interval job status, and test isolation.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const pk = require('../lib/v5/packages.js');
const gwPkg = require('../lib/v5/pkg-gateway.js');
const menu = require('../lib/v5/menu.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-svc-verify-'));

// openwiki verify probes the real `openwiki --help`; put a stub first on PATH so the result does not depend on the host.
const stubOpenwiki = (t) => {
    const bin = tmp();
    const cmd = path.join(bin, process.platform === 'win32' ? 'openwiki.cmd' : 'openwiki');
    fs.writeFileSync(cmd, process.platform === 'win32' ? '@echo OpenWiki v0.5.0\r\n' : '#!/bin/sh\necho "OpenWiki v0.5.0"\n', { mode: 0o755 });
    const prev = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${prev}`;
    t.after(() => { process.env.PATH = prev; });
};

describe('launchd service verification', () => {
    test('memb WebUI: loaded and running passes verify', () => {
        const home = tmp();
        const membDir = path.join(home, 'modules', 'memB');
        fs.mkdirSync(path.join(membDir, '.venv', 'bin'), { recursive: true });
        fs.writeFileSync(path.join(membDir, 'package.json'), JSON.stringify({ version: '2.4.0' }));
        fs.writeFileSync(path.join(membDir, '.venv', 'bin', 'python'), '#!/bin/sh\nexit 0', { mode: 0o755 });

        const plistDir = path.join(home, 'Library', 'LaunchAgents');
        fs.mkdirSync(plistDir, { recursive: true });
        const plist = path.join(plistDir, 'com.bdb.memb.webui.plist');
        fs.writeFileSync(plist, '<plist/>');

        const host = {
            moduleBasePath: () => path.join(home, 'modules'),
            resolveTargetPaths: () => ({ targetMcpDir: path.join(home, 'mcp') }),
        };

        const sample = `{\n\t"Label" = "com.bdb.memb.webui";\n\t"LastExitStatus" = 0;\n\t"PID" = 1234;\n};\n`;
        const memb = pk.registry.find((p) => p.id === 'memb');
        const res = memb.verify({
            host,
            home,
            launchctl: () => ({ status: 0, stdout: sample }),
        });
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.detail, '2.4.0');
    });

    test('memb WebUI: plist present but not loaded fails verify and is repaired', async () => {
        const home = tmp();
        const membDir = path.join(home, 'modules', 'memB');
        fs.mkdirSync(path.join(membDir, '.venv', 'bin'), { recursive: true });
        fs.writeFileSync(path.join(membDir, 'package.json'), JSON.stringify({ version: '2.4.0' }));
        fs.writeFileSync(path.join(membDir, '.venv', 'bin', 'python'), '#!/bin/sh\nexit 0', { mode: 0o755 });

        const plistDir = path.join(home, 'Library', 'LaunchAgents');
        fs.mkdirSync(plistDir, { recursive: true });
        const plist = path.join(plistDir, 'com.bdb.memb.webui.plist');
        fs.writeFileSync(plist, '<plist/>');

        const host = {
            moduleBasePath: () => path.join(home, 'modules'),
            resolveTargetPaths: () => ({ targetMcpDir: path.join(home, 'mcp') }),
        };

        let loaded = false;
        const launchctl = () => (loaded ? { status: 0, stdout: '{\n"LastExitStatus" = 0;\n};\n' } : { status: 113, stdout: '' });
        const memb = pk.registry.find((p) => p.id === 'memb');
        const c = {
            host,
            home,
            launchctl,
            bootstrapLaunchd: async () => { loaded = true; return true; },
        };

        const bad = memb.verify(c);
        assert.strictEqual(bad.ok, false);
        assert.strictEqual(bad.detail, 'service not loaded');

        await memb.repair(c);
        assert.strictEqual(loaded, true, 'repair bootstraps the launchd service');

        const fixed = memb.verify(c);
        assert.strictEqual(fixed.ok, true);
    });

    test('synapse: loaded and running passes verify', () => {
        const home = tmp();
        const synDir = path.join(home, 'modules', 'bdb-synapse');
        fs.mkdirSync(synDir, { recursive: true });
        fs.writeFileSync(path.join(synDir, 'package.json'), JSON.stringify({ version: '1.2.0' }));
        const bin = path.join(synDir, 'synapse');
        fs.writeFileSync(bin, '#!/bin/sh\nexit 0', { mode: 0o755 });

        const plistDir = path.join(home, 'Library', 'LaunchAgents');
        fs.mkdirSync(plistDir, { recursive: true });
        const plist = path.join(plistDir, 'com.bdb.synapse.plist');
        fs.writeFileSync(plist, '<plist/>');

        const host = {
            moduleBasePath: () => path.join(home, 'modules'),
            findSynapseBinary: () => bin,
        };

        const synapse = pk.registry.find((p) => p.id === 'synapse');
        const res = synapse.verify({
            host,
            home,
            launchctl: () => ({ status: 0, stdout: '{\n"LastExitStatus" = 0;\n};\n' }),
        });
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.detail, '1.2.0');
    });

    test('synapse: plist present but not loaded fails verify and is repaired', async () => {
        const home = tmp();
        const synDir = path.join(home, 'modules', 'bdb-synapse');
        fs.mkdirSync(synDir, { recursive: true });
        fs.writeFileSync(path.join(synDir, 'package.json'), JSON.stringify({ version: '1.2.0' }));
        const bin = path.join(synDir, 'synapse');
        fs.writeFileSync(bin, '#!/bin/sh\nexit 0', { mode: 0o755 });

        const plistDir = path.join(home, 'Library', 'LaunchAgents');
        fs.mkdirSync(plistDir, { recursive: true });
        const plist = path.join(plistDir, 'com.bdb.synapse.plist');
        fs.writeFileSync(plist, '<plist/>');

        const host = {
            moduleBasePath: () => path.join(home, 'modules'),
            findSynapseBinary: () => bin,
        };

        let loaded = false;
        const launchctl = () => (loaded ? { status: 0, stdout: '{\n"LastExitStatus" = 0;\n};\n' } : { status: 1, stdout: '' });
        const synapse = pk.registry.find((p) => p.id === 'synapse');
        const c = {
            host,
            home,
            launchctl,
            bootstrapLaunchd: async () => { loaded = true; return true; },
        };

        const bad = synapse.verify(c);
        assert.strictEqual(bad.ok, false);
        assert.strictEqual(bad.detail, 'service not loaded');

        await synapse.repair(c);
        assert.strictEqual(loaded, true, 'synapse repair bootstraps the service');

        const fixed = synapse.verify(c);
        assert.strictEqual(fixed.ok, true);
    });

    test('openwiki: loaded interval job passes verify even with no running process', (t) => {
        stubOpenwiki(t);
        const home = tmp();
        const plistDir = path.join(home, 'Library', 'LaunchAgents');
        fs.mkdirSync(plistDir, { recursive: true });
        const plist = path.join(plistDir, 'com.bdb.openwiki.daemon.plist');
        fs.writeFileSync(plist, '<plist/>');

        const openwiki = pk.registry.find((p) => p.id === 'openwiki');
        // launchctl list returns 0 for a scheduled interval job (no PID)
        const res = openwiki.verify({
            home,
            launchctl: () => ({ status: 0, stdout: '{\n"Label" = "com.bdb.openwiki.daemon";\n};\n' }),
        });
        assert.strictEqual(res.ok, true);
    });

    test('openwiki: plist present but not loaded fails verify and is repaired', async (t) => {
        stubOpenwiki(t);
        const home = tmp();
        const plistDir = path.join(home, 'Library', 'LaunchAgents');
        fs.mkdirSync(plistDir, { recursive: true });
        const plist = path.join(plistDir, 'com.bdb.openwiki.daemon.plist');
        fs.writeFileSync(plist, '<plist/>');

        let loaded = false;
        const launchctl = () => (loaded ? { status: 0, stdout: '{\n"Label" = "com.bdb.openwiki.daemon";\n};\n' } : { status: 1, stdout: '' });
        const openwiki = pk.registry.find((p) => p.id === 'openwiki');
        const c = {
            home,
            launchctl,
            bootstrapLaunchd: async () => { loaded = true; return true; },
        };

        const bad = openwiki.verify(c);
        assert.strictEqual(bad.ok, false);
        assert.strictEqual(bad.detail, 'service not loaded');

        await openwiki.repair(c);
        assert.strictEqual(loaded, true, 'openwiki repair bootstraps the daemon');

        const fixed = openwiki.verify(c);
        assert.strictEqual(fixed.ok, true);
    });

    test('hub services: openwiki interval job reports status "scheduled"', async () => {
        const { statusService } = await import('../lib/hub/services.mjs');
        const home = tmp();
        const plistDir = path.join(home, 'Library', 'LaunchAgents');
        fs.mkdirSync(plistDir, { recursive: true });
        fs.writeFileSync(path.join(plistDir, 'com.bdb.openwiki.daemon.plist'), '<plist/>');

        const ctx = {
            home,
            platform: 'darwin',
            run: async (cmd, args) => {
                if (cmd === 'launchctl' && args[0] === 'list') {
                    return { ok: true, stdout: '-\t0\tcom.bdb.openwiki.daemon\n' };
                }
                return { ok: true, stdout: '' };
            },
        };

        const rows = await statusService(ctx);
        const ow = rows.find((r) => r.id === 'openwiki');
        assert.ok(ow);
        assert.strictEqual(ow.loaded, true);
        assert.strictEqual(ow.up, true);
        assert.strictEqual(ow.status, 'scheduled');
    });

    test('hub services: openwiki plist present but not loaded reports "service not loaded"', async () => {
        const { statusService } = await import('../lib/hub/services.mjs');
        const home = tmp();
        const plistDir = path.join(home, 'Library', 'LaunchAgents');
        fs.mkdirSync(plistDir, { recursive: true });
        fs.writeFileSync(path.join(plistDir, 'com.bdb.openwiki.daemon.plist'), '<plist/>');

        const ctx = {
            home,
            platform: 'darwin',
            run: async (cmd, args) => {
                if (cmd === 'launchctl' && args[0] === 'list') {
                    return { ok: true, stdout: '-\t0\tcom.apple.other\n' };
                }
                return { ok: true, stdout: '' };
            },
        };

        const rows = await statusService(ctx);
        const ow = rows.find((r) => r.id === 'openwiki');
        assert.ok(ow);
        assert.strictEqual(ow.loaded, false);
        assert.strictEqual(ow.status, 'service not loaded');
    });

    test('gateway: plist present but not loaded fails verify with "service not loaded"', async () => {
        const home = tmp();
        const plistDir = path.join(home, 'Library', 'LaunchAgents');
        fs.mkdirSync(plistDir, { recursive: true });
        fs.writeFileSync(path.join(plistDir, 'com.bdb.aos.gateway.plist'), '<plist/>');

        const ctx = {
            home,
            platform: 'darwin',
            statusFn: async () => ({ running: false }),
            launchctl: () => ({ status: 1 }),
        };

        const v = await gwPkg.verify(ctx, { tries: 1 });
        assert.strictEqual(v.ok, false);
        assert.strictEqual(v.detail, 'service not loaded');
    });

    test('test isolation: temp-HOME update never calls real service manager (throwing runner)', async () => {
        const home = tmp();
        fs.mkdirSync(path.join(home, '.agents', 'skills', 'dummy-skill'), { recursive: true });
        const throwingRunner = async (cmd, args = []) => {
            if (['launchctl', 'systemctl', 'schtasks'].includes(cmd)) {
                throw new Error(`test isolation violation: real service manager called: ${cmd} ${args.join(' ')}`);
            }
            return { ok: true, status: 0, stdout: '', stderr: '' };
        };

        const host = {
            detectInstallState: () => ({ isInstalled: true, localVersion: '5.2.2', installedModules: [] }),
            resolveTargetPaths: () => ({ targetSkillDir: path.join(home, '.agents', 'skills'), targetMcpDir: path.join(home, 'mcp') }),
            moduleBasePath: () => path.join(home, 'modules'),
            quickUpdateKernel: () => [],
            quickUpdateHarnesses: () => [],
            isNewerVersion: () => false,
            saveManifest: () => {},
            flushSessionManifest: () => {},
            loadExistingEnv: () => ({}),
            PROVIDER_KEY_ENV_NAMES: {},
            findSynapseBinary: () => null,
            refreshOpenWikiSilently: async () => false,
            installMemB: async () => true,
        };

        // Disable gateway in settings so it doesn't try npm install / 30s timeout
        fs.mkdirSync(path.join(home, '.aos'), { recursive: true });
        fs.writeFileSync(path.join(home, '.aos', 'v5-settings.json'), JSON.stringify({ disabled: ['gateway'] }));

        const out = [];
        const opts = {
            home,
            write: (s) => out.push(s),
            ui: {},
            npmView: async () => ({ '@hybridlabor-api/aos': '5.2.2' }),
            run: throwingRunner,
        };

        // If service safety nets fail, this will throw
        const code = await menu.update(host, opts);
        assert.strictEqual(code, 0);
    });
});
