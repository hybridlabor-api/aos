const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const p = require('../lib/v5/profile');
const installer = require('../installer.js');
const { loadLayeredRouterTable } = require('../lib/router/table');

const parse = (argv = []) => p.parseOptions(['node', 'installer.js', ...argv], {}, () => []);

describe('installer router/context flags', () => {
    test('parses --router and --context', () => {
        const o = parse(['--router=budget', '--context=worker']);
        assert.equal(o.router, 'budget');
        assert.equal(o.context, 'worker');
        assert.equal(o.routerFromFlag, true);
        assert.equal(o.contextFromFlag, true);
    });
    test('absent flags leave both undefined', () => {
        const o = parse([]);
        assert.equal(o.router, undefined);
        assert.equal(o.context, undefined);
    });
    test('rejects unknown values', () => {
        assert.throws(() => parse(['--router=nope']), /Unknown router preset/);
        assert.throws(() => parse(['--context=nope']), /Unknown context profile/);
        assert.throws(() => parse(['--router=']), /needs a value/);
    });
});

describe('installer router step', () => {
    const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-router-setup-'));
    test('default preset writes nothing (keeps the shipped table)', () => {
        const h = home();
        assert.equal(installer.writeUserRouterConfig({ home: h, preset: 'default', mainHarness: 'claude', selectedTargets: ['claude'] }), null);
        assert.equal(fs.existsSync(path.join(h, '.aos', 'router.json')), false);
    });
    test('budget puts opencode-go first for builder and scout and loads strictly', () => {
        const h = home();
        const file = installer.writeUserRouterConfig({ home: h, preset: 'budget', mainHarness: 'claude', selectedTargets: ['claude', 'opencode-go'] });
        assert.equal(file, path.join(h, '.aos', 'router.json'));
        const t = loadLayeredRouterTable({ home: h });
        assert.equal(t.preferences.builder[0], 'opencode-go');
        assert.equal(t.preferences.scout[0], 'opencode-go');
        assert.equal(t.preferences.architect[0], 'claude');
    });
    test('claude-only lists claude first for every role', () => {
        const prefs = installer.buildRouterPreferences('claude', ['claude', 'agy'], 'claude-only');
        for (const r of Object.values(prefs)) assert.equal(r[0], 'claude');
    });
    test('rewrite keeps a .bak of the previous file', () => {
        const h = home();
        const args = { home: h, preset: 'claude-only', mainHarness: 'claude', selectedTargets: ['claude'] };
        installer.writeUserRouterConfig(args);
        installer.writeUserRouterConfig(args);
        assert.ok(fs.existsSync(path.join(h, '.aos', 'router.json.bak')));
    });
});
