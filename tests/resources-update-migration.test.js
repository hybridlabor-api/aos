// An `aos update` from 5.3.0 must move the old shipped template (~/.agents/mcp_config.json, read by agy in HOME as a
// workspace config, 21 servers spawned next to the gateway) out of agy's reach. Offline; HOME is a temp dir.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-res-mig-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const installer = require('../installer.js');
const ROOT = path.join(__dirname, '..');

test('installGlobalBinaries (run by every update) retires the 5.3.0 template copy', () => {
    const agents = path.join(home, '.agents');
    fs.mkdirSync(agents, { recursive: true });
    const legacy = path.join(agents, 'mcp_config.json');
    fs.copyFileSync(path.join(ROOT, 'mcp_config.json'), legacy);
    installer.installGlobalBinaries(home);
    assert.ok(!fs.existsSync(legacy), 'agy would still spawn every server from this file');
    assert.ok(fs.existsSync(path.join(agents, 'mcp_config.json.aos-legacy.bak')));
    assert.ok(fs.existsSync(path.join(agents, 'gateway', 'upstream_template.json')), 'the gateway keeps its server list');
});

test('the quick-update step list also runs the migration', () => {
    const src = fs.readFileSync(path.join(ROOT, 'installer.js'), 'utf8');
    assert.match(src, /migrate legacy agy workspace MCP config/);
});
