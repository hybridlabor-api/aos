// G2 through the real update path (lib/v5/menu.js update): the stored Basic tier survives. Offline; HOME is a temp dir.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gaps-upd-'));
process.env.HOME = root;
process.env.USERPROFILE = root;
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const menu = require('../lib/v5/menu');
const { storedTierOpts } = require('../installer.js');

const running = require('../package.json').version;

test('aos update saves the stored Basic tier back, not tier 1', async () => {
    const saved = [];
    fs.mkdirSync(path.join(root, '.aos'), { recursive: true });
    fs.writeFileSync(path.join(root, '.aos', 'v5-settings.json'), JSON.stringify({ disabled: ['gateway', 'openwiki', 'deja', 'hub', 'memb'] }));
    const skills = path.join(root, 'skills');
    fs.mkdirSync(path.join(skills, 'fabric'), { recursive: true });
    const host = {
        detectInstallState: () => ({ isInstalled: true, localVersion: '0.0.1', installedModules: [], manifest: { tier: '2', isUniversal: false } }),
        resolveTargetPaths: () => ({ targetSkillDir: skills, targetMcpDir: path.join(root, 'mcp') }),
        moduleBasePath: () => path.join(root, '.agents'),
        quickUpdateKernel: () => [],
        quickUpdateHarnesses: () => [],
        refreshOpenWikiSilently: async () => false,
        loadExistingEnv: () => ({}),
        PROVIDER_KEY_ENV_NAMES: {},
        isNewerVersion: () => false,
        storedTierOpts,
        saveManifest: (d) => saved.push(d),
        flushSessionManifest: () => {},
    };
    const code = await menu.update(host, {
        home: root,
        write: () => {},
        logFile: path.join(root, 'u.log'),
        npmView: async () => running,
    });
    assert.strictEqual(code, 0);
    assert.ok(saved.length >= 1, 'manifest saved');
    assert.strictEqual(saved.at(-1).tier, '2');
    assert.strictEqual(saved.at(-1).isUniversal, false);
});
