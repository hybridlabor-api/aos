// Gateway hygiene: mcp.json holds exactly selected servers + adopted servers after add/install/update.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const cfg = require('../lib/gateway/config.js');
const selection = require('../lib/gateway/selection.js');
const pkg = require('../lib/v5/pkg-gateway.js');
const profile = require('../lib/v5/profile.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gwhyg-'));
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const mcpKeys = (home) => Object.keys(rj(path.join(cfg.gatewayDir(home), 'mcp.json')).mcpServers).sort();

function gatewayHome(selected) {
    const home = tmp();
    const dir = cfg.gatewayDir(home);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'token'), 'a'.repeat(64));
    fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({ mcpServers: {} }));
    fs.writeFileSync(cfg.adoptedPath(home), JSON.stringify({ servers: { user_own: { command: 'node', args: ['own.js'], env: {} } } }));
    profile.writeSettings(home, { disabled: [], gateway: { servers: selected } });
    return home;
}

test('applyServerChange with a non-empty selection writes exactly selected + adopted', () => {
    const home = gatewayHome(['github', 'deja']);
    selection.applyServerChange({ home, aosRoot: ROOT, add: 'chrome-devtools', platform: 'darwin', env: {} });
    assert.deepEqual(mcpKeys(home), ['chrome-devtools', 'deja', 'github', 'user_own']);
    selection.applyServerChange({ home, aosRoot: ROOT, remove: 'deja', platform: 'darwin', env: {} });
    assert.deepEqual(mcpKeys(home), ['chrome-devtools', 'github', 'user_own']);
});

for (const verb of ['install', 'update']) {
    test(`gateway ${verb} with a non-empty selection writes exactly selected + adopted`, async () => {
        const home = gatewayHome(['github', 'deja']);
        const ctx = {
            home, run: async () => ({ status: 0, stdout: '' }), dryRun: false, platform: 'darwin', log: () => {}, nodePath: '/n/node',
            aosRoot: ROOT, uid: 501, env: {}, sleep: async () => {}, statusFn: async () => ({ running: true, port: cfg.GATEWAY_PORT }),
        };
        await pkg[verb](ctx);
        assert.deepEqual(mcpKeys(home), ['deja', 'github', 'user_own']);
    });
}
