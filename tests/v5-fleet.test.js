const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const pkg = require('../lib/v5/pkg-fleet.js');

const KEY = 'bdb-aos-fleet@bdb-marketplace';
const mkHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-fleet-'));
const settingsOf = (home) => path.join(home, '.claude', 'settings.json');
const put = (home, text) => { fs.mkdirSync(path.join(home, '.claude'), { recursive: true }); fs.writeFileSync(settingsOf(home), typeof text === 'string' ? text : JSON.stringify(text)); };
const read = (home) => JSON.parse(fs.readFileSync(settingsOf(home), 'utf8'));
const baks = (home) => fs.readdirSync(path.join(home, '.claude')).filter((f) => f.endsWith('.bak'));
const ctxOf = (home, over = {}) => ({ home, claudeBin: 'claude', dryRun: false, env: {}, run: async () => ({ status: 0, stdout: '2.1.300 (Claude Code)\n' }), ...over });
const withVersion = (v) => ({ run: async () => ({ status: 0, stdout: `${v} (Claude Code)\n` }) });

describe('fleet package step', () => {
    test('contract shape', () => {
        assert.equal(pkg.id, 'fleet');
        for (const f of ['detect', 'install', 'update', 'verify', 'uninstall']) assert.equal(typeof pkg[f], 'function');
    });

    test('fresh install writes marketplace and enabled key', async () => {
        const home = mkHome();
        const r = await pkg.install(ctxOf(home));
        assert.equal(r.ok, true);
        assert.equal(r.changed, true);
        const s = read(home);
        assert.equal(s.enabledPlugins[KEY], true);
        assert.deepEqual(s.extraKnownMarketplaces['bdb-marketplace'], { source: { source: 'github', repo: 'hybridlabor-api/aos' } });
    });

    test('second install writes nothing', async () => {
        const home = mkHome();
        await pkg.install(ctxOf(home));
        const before = fs.statSync(settingsOf(home));
        const text = fs.readFileSync(settingsOf(home), 'utf8');
        const r = await pkg.update(ctxOf(home));
        assert.equal(r.changed, false);
        assert.equal(fs.readFileSync(settingsOf(home), 'utf8'), text);
        assert.equal(fs.statSync(settingsOf(home)).mtimeMs, before.mtimeMs);
        assert.equal(baks(home).length, 0);
    });

    test('existing false is preserved', async () => {
        const home = mkHome();
        put(home, { enabledPlugins: { [KEY]: false } });
        const text = fs.readFileSync(settingsOf(home), 'utf8');
        const r = await pkg.install(ctxOf(home));
        assert.equal(r.optedOut, true);
        assert.equal(fs.readFileSync(settingsOf(home), 'utf8'), text);
    });

    test('AOS_NO_FLEET=1 leaves everything alone', async () => {
        const home = mkHome();
        const r = await pkg.install(ctxOf(home, { env: { AOS_NO_FLEET: '1' } }));
        assert.equal(r.optedOut, true);
        assert.equal(fs.existsSync(settingsOf(home)), false);
    });

    test('old Claude Code is skipped, nothing written', async () => {
        const home = mkHome();
        const r = await pkg.install(ctxOf(home, withVersion('2.1.286')));
        assert.equal(r.skipped, true);
        assert.equal(r.reason, 'Claude Code < 2.1.287');
        assert.equal(fs.existsSync(settingsOf(home)), false);
        assert.equal((await pkg.install(ctxOf(home, withVersion('2.1.287')))).changed, true);
    });

    test('missing claude is skipped, thrown or failing run alike', async () => {
        for (const run of [async () => { throw new Error('ENOENT'); }, async () => ({ status: 127, stdout: '' })]) {
            const home = mkHome();
            const r = await pkg.install(ctxOf(home, { run }));
            assert.equal(r.skipped, true);
            assert.equal(r.reason, 'Claude Code not found');
            assert.equal(fs.existsSync(settingsOf(home)), false);
        }
    });

    test('dryRun reports changes and writes nothing', async () => {
        const home = mkHome();
        const r = await pkg.install(ctxOf(home, { dryRun: true }));
        assert.equal(r.dryRun, true);
        assert.equal(r.actions.length, 2);
        assert.equal(fs.existsSync(settingsOf(home)), false);
    });

    test('other keys are preserved', async () => {
        const home = mkHome();
        put(home, { model: 'opus', enabledPlugins: { 'other@x': true }, extraKnownMarketplaces: { mine: { source: { source: 'github', repo: 'me/mine' } } } });
        const r = await pkg.install(ctxOf(home));
        assert.equal(r.changed, true);
        const s = read(home);
        assert.equal(s.model, 'opus');
        assert.equal(s.enabledPlugins['other@x'], true);
        assert.equal(s.enabledPlugins[KEY], true);
        assert.equal(s.extraKnownMarketplaces.mine.source.repo, 'me/mine');
        assert.equal(baks(home).length, 1);
    });

    test('settings with comments are read but never rewritten', async () => {
        const home = mkHome();
        const text = '{\n // my comment\n "model": "opus", /* x */\n "enabledPlugins": { "other@x": true, },\n}\n';
        put(home, text);
        const r = await pkg.install(ctxOf(home));
        assert.equal(r.ok, false);
        assert.match(r.error, /comments/);
        assert.equal(fs.readFileSync(settingsOf(home), 'utf8'), text);
        assert.equal(baks(home).length, 0);
        assert.equal((await pkg.verify(ctxOf(home))).ok, false);
    });

    test('a bdb-marketplace entry pointing elsewhere is left alone and the step skips', async () => {
        const home = mkHome();
        const settings = { extraKnownMarketplaces: { 'bdb-marketplace': { source: { source: 'github', repo: 'someone/else' } } } };
        put(home, settings);
        const r = await pkg.install(ctxOf(home));
        assert.equal(r.skipped, true);
        assert.match(r.reason, /someone\/else/);
        assert.deepEqual(read(home), settings);
        assert.equal((await pkg.verify(ctxOf(home))).skipped, true);
    });

    test('AOS_NO_FLEET wins even over a broken settings file', async () => {
        const home = mkHome();
        put(home, '{ not json');
        const ctx = ctxOf(home, { env: { AOS_NO_FLEET: '1' } });
        assert.equal((await pkg.install(ctx)).optedOut, true);
        assert.equal((await pkg.verify(ctx)).optedOut, true);
    });

    test('unreadable or invalid settings return an error instead of throwing', async () => {
        const home = mkHome();
        put(home, '{ not json');
        assert.equal((await pkg.install(ctxOf(home))).ok, false);
        const dirHome = mkHome();
        fs.mkdirSync(settingsOf(dirHome), { recursive: true });
        for (const f of ['install', 'verify', 'uninstall', 'detect']) await assert.doesNotReject(pkg[f](ctxOf(dirHome)));
        assert.equal((await pkg.install(ctxOf(dirHome))).ok, false);
    });

    test('version comes from the line that starts with it', async () => {
        for (const [out, ok] of [['2.10.0 (Claude Code)', true], ['2.2.0', true], ['2.1.287-beta.1', true], ['Node 20.11.0 warning\n2.1.200 (Claude Code)', false], ['warning only', false]]) {
            const r = await pkg.install(ctxOf(mkHome(), { run: async () => ({ status: 0, stdout: out }) }));
            assert.equal(!r.skipped, ok, out);
        }
    });

    test('non-object enabledPlugins and broken symlink are errors, nothing written', async () => {
        const home = mkHome();
        put(home, { enabledPlugins: [] });
        const text = fs.readFileSync(settingsOf(home), 'utf8');
        const r = await pkg.install(ctxOf(home));
        assert.equal(r.ok, false);
        assert.equal(fs.readFileSync(settingsOf(home), 'utf8'), text);

        const h2 = mkHome();
        fs.mkdirSync(path.join(h2, '.claude'));
        fs.symlinkSync(path.join(h2, 'nope.json'), settingsOf(h2));
        const r2 = await pkg.install(ctxOf(h2));
        assert.equal(r2.ok, false);
        assert.equal(fs.existsSync(path.join(h2, 'nope.json')), false);
    });

    test('symlinked settings.json is written through', async () => {
        const home = mkHome();
        const real = path.join(home, 'real.json');
        fs.writeFileSync(real, '{"a":1}');
        fs.mkdirSync(path.join(home, '.claude'));
        fs.symlinkSync(real, settingsOf(home));
        await pkg.install(ctxOf(home));
        assert.ok(fs.lstatSync(settingsOf(home)).isSymbolicLink());
        assert.equal(JSON.parse(fs.readFileSync(real, 'utf8')).enabledPlugins[KEY], true);
    });

    test('CLAUDE_CONFIG_DIR from ctx.env is honoured', async () => {
        const home = mkHome();
        const dir = path.join(mkHome(), 'cfg');
        await pkg.install(ctxOf(home, { env: { CLAUDE_CONFIG_DIR: dir } }));
        assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).enabledPlugins[KEY], true);
        assert.equal(fs.existsSync(settingsOf(home)), false);
    });

    test('uninstall removes only a true key', async () => {
        const home = mkHome();
        put(home, { model: 'x', enabledPlugins: { [KEY]: true, 'bdb-aos@bdb-marketplace': true }, extraKnownMarketplaces: { m: {} } });
        const r = await pkg.uninstall(ctxOf(home));
        assert.equal(r.changed, true);
        const s = read(home);
        assert.deepEqual(s.enabledPlugins, { 'bdb-aos@bdb-marketplace': true });
        assert.equal(s.model, 'x');
        assert.deepEqual(s.extraKnownMarketplaces, { m: {} });

        const h2 = mkHome();
        put(h2, { enabledPlugins: { [KEY]: false } });
        const text = fs.readFileSync(settingsOf(h2), 'utf8');
        assert.equal((await pkg.uninstall(ctxOf(h2))).changed, false);
        assert.equal(fs.readFileSync(settingsOf(h2), 'utf8'), text);

        const h3 = mkHome();
        assert.equal((await pkg.uninstall(ctxOf(h3))).changed, false);
        assert.equal(fs.existsSync(settingsOf(h3)), false);
    });

    test('uninstall dryRun writes nothing', async () => {
        const home = mkHome();
        put(home, { enabledPlugins: { [KEY]: true } });
        const r = await pkg.uninstall(ctxOf(home, { dryRun: true }));
        assert.equal(r.dryRun, true);
        assert.equal(read(home).enabledPlugins[KEY], true);
    });

    test('verify outcomes', async () => {
        const home = mkHome();
        assert.equal((await pkg.verify(ctxOf(home))).ok, false);
        await pkg.install(ctxOf(home));
        assert.equal((await pkg.verify(ctxOf(home))).ok, true);

        const off = mkHome();
        put(off, { enabledPlugins: { [KEY]: false } });
        const o = await pkg.verify(ctxOf(off));
        assert.equal(o.ok, true);
        assert.equal(o.optedOut, true);
        assert.equal((await pkg.verify(ctxOf(mkHome(), { env: { AOS_NO_FLEET: '1' } }))).optedOut, true);

        const old = await pkg.verify(ctxOf(mkHome(), withVersion('2.0.0')));
        assert.deepEqual([old.ok, old.skipped, old.detail], [true, true, 'skipped (Claude Code < 2.1.287)']);
        const gone = await pkg.verify(ctxOf(mkHome(), { run: async () => { throw new Error('x'); } }));
        assert.deepEqual([gone.ok, gone.skipped, gone.detail], [true, true, 'skipped (Claude Code not found)']);
    });

    test('detect reports version and key state', async () => {
        const home = mkHome();
        let d = await pkg.detect(ctxOf(home));
        assert.deepEqual([d.installed, d.version, d.enabled], [false, '2.1.300', null]);
        await pkg.install(ctxOf(home));
        d = await pkg.detect(ctxOf(home));
        assert.deepEqual([d.installed, d.enabled], [true, true]);
        assert.equal((await pkg.detect(ctxOf(home, { run: async () => ({ status: 1 }) }))).claude, false);
    });
});

describe('marketplace.json', () => {
    test('lists bdb-aos-fleet pointing at a real plugin folder, version matches bdb-aos', () => {
        const m = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
        const fleet = m.plugins.find((p) => p.name === 'bdb-aos-fleet');
        const main = m.plugins.find((p) => p.name === 'bdb-aos');
        assert.ok(fleet);
        assert.equal(fleet.source, './plugins/bdb-aos-fleet');
        assert.equal(fleet.version, main.version);
        assert.ok(fs.existsSync(path.join(ROOT, fleet.source, '.claude-plugin', 'plugin.json')));
    });
});
