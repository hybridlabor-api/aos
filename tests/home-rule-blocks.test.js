// A4: an existing ~/AGENTS.md gets the routing and destructive-actions blocks from any cwd (~/CLAUDE.md stays a pointer); the cwd gets nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const routing = require('../lib/routing-rules');
const destructive = require('../lib/destructive-rules');

const INSTALLER = path.join(__dirname, '..', 'installer.js');

test('injectHarnessRules writes the managed blocks into HOME files when run from a project dir (container only)', { skip: process.env.AOS_TEST_SANDBOX !== 'container' }, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-a4-home-'));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-a4-repo-'));
    fs.writeFileSync(path.join(home, 'AGENTS.md'), '# mine\n');
    const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(INSTALLER)}).injectHarnessRules()`], {
        cwd, env: { ...process.env, HOME: home, USERPROFILE: home, AOS_PLUGIN_CLI: 'off' }, encoding: 'utf8', timeout: 120000,
    });
    assert.equal(r.status, 0, r.stderr);
    const claude = fs.readFileSync(path.join(home, 'CLAUDE.md'), 'utf8');
    const agents = fs.readFileSync(path.join(home, 'AGENTS.md'), 'utf8');
    assert.ok(agents.includes(routing.START), 'routing block');
    assert.ok(agents.includes(destructive.START), 'destructive-actions block');
    // ~/CLAUDE.md is only a pointer to ~/AGENTS.md, where the blocks live canonically
    assert.ok(claude.includes('AGENTS.md'));
    assert.ok(!claude.includes(routing.START) && !claude.includes(destructive.START));
    assert.ok(agents.startsWith('# mine'));
    assert.deepEqual(fs.readdirSync(cwd), [], 'nothing written into the cwd');
});

test('a HOME without AGENTS.md gets one created with managed blocks (container only)', { skip: process.env.AOS_TEST_SANDBOX !== 'container' }, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-a4-home-'));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-a4-repo-'));
    const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(INSTALLER)}).injectHarnessRules()`], {
        cwd, env: { ...process.env, HOME: home, USERPROFILE: home, AOS_PLUGIN_CLI: 'off' }, encoding: 'utf8', timeout: 120000,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(home, 'AGENTS.md')));
    const agents = fs.readFileSync(path.join(home, 'AGENTS.md'), 'utf8');
    assert.ok(agents.includes(routing.START), 'routing block should be present');
    assert.ok(agents.includes(destructive.START), 'destructive block should be present');
});
