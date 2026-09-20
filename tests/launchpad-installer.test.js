const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    shouldOpenLaunchpad,
    shouldAutostartLaunchpad,
    isDevEnvironment,
    LAUNCHPAD_WEB_MODULES,
} = require('../installer.js');

const repo = path.resolve(__dirname, '..');
const installerSrc = fs.readFileSync(path.join(repo, 'installer.js'), 'utf8');

// A home dir that is guaranteed NOT to be a dev checkout: no dev/bdb-dev,
// no bdb-dev inside it.
function makePlainHome() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'aos-launchpad-home-'));
}

describe('launchpad trigger logic (decoupled from dev checkout)', () => {
    test('opens when daemon modules are installed, even without a dev checkout', () => {
        const home = makePlainHome();
        try {
            for (const mod of ['memb', 'synapse', 'openwiki']) {
                assert.equal(
                    shouldOpenLaunchpad([mod], { homeDir: home, env: {}, argv: ['node', 'installer.js'] }),
                    true,
                    `expected launchpad to open for installed module '${mod}'`
                );
            }
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    test('stays closed on a plain end-user machine with no modules and no flags', () => {
        const home = makePlainHome();
        try {
            assert.equal(
                shouldOpenLaunchpad([], { homeDir: home, env: {}, argv: ['node', 'installer.js'] }),
                false
            );
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    test('explicit flags open the launchpad without a dev checkout', () => {
        const home = makePlainHome();
        try {
            for (const flag of ['--launchpad', '--dashboard', '--open', '--dev']) {
                assert.equal(
                    shouldOpenLaunchpad([], { homeDir: home, env: {}, argv: ['node', 'installer.js', flag] }),
                    true,
                    `expected launchpad to open for flag '${flag}'`
                );
            }
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    test('dev checkout still opens the launchpad', () => {
        const home = makePlainHome();
        fs.mkdirSync(path.join(home, 'dev', 'bdb-dev'), { recursive: true });
        try {
            assert.equal(
                shouldOpenLaunchpad([], { homeDir: home, env: {}, argv: ['node', 'installer.js'] }),
                true
            );
            assert.equal(isDevEnvironment({ homeDir: home, env: {} }), true);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    test('web-module list covers the daemon modules with web interfaces', () => {
        for (const mod of ['memb', 'synapse', 'openwiki']) {
            assert.ok(LAUNCHPAD_WEB_MODULES.includes(mod), `expected '${mod}' in LAUNCHPAD_WEB_MODULES`);
        }
    });
});

describe('launchpad boot autostart is opt-in only', () => {
    test('no autostart on a plain install without flags', () => {
        const home = makePlainHome();
        try {
            assert.equal(
                shouldAutostartLaunchpad({ homeDir: home, env: {}, argv: ['node', 'installer.js'] }),
                false
            );
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    test('--autostart-launchpad opts into autostart', () => {
        const home = makePlainHome();
        try {
            assert.equal(
                shouldAutostartLaunchpad({ homeDir: home, env: {}, argv: ['node', 'installer.js', '--autostart-launchpad'] }),
                true
            );
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    test('dev checkout keeps autostart', () => {
        const home = makePlainHome();
        fs.mkdirSync(path.join(home, 'dev', 'bdb-dev'), { recursive: true });
        try {
            assert.equal(
                shouldAutostartLaunchpad({ homeDir: home, env: {}, argv: ['node', 'installer.js'] }),
                true
            );
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    test('autostart entries are gated, not unconditional', () => {
        assert.match(installerSrc, /if\s*\(!shouldAutostartLaunchpad\(\)\)/);
        assert.match(installerSrc, /--autostart-launchpad/);
        assert.match(installerSrc, /com\.bdb\.launchpad\.plist/);
        assert.match(installerSrc, /com\.bdb\.launchpad\.vbs/);
    });
});

describe('dashboard promotion', () => {
    test('installer summary points at aos-dashboard on port 7900', () => {
        assert.match(installerSrc, /aos-dashboard/);
        assert.match(installerSrc, /127\.0\.0\.1:7900/);
        assert.match(installerSrc, /BDB Agent OS Dashboard/);
    });

    test('browser open stays non-fatal on error', () => {
        assert.match(installerSrc, /child\.on\('error'/);
        assert.match(installerSrc, /spawn\('explorer', \[filePath\]/);
    });
});
