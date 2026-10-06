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

    test('JSONC settings are read; other keys and marketplaces preserved', async () => {
        const home = mkHome();
        put(home, '{\n // my comment\n "model": "opus", /* x */\n "enabledPlugins": { "other@x": true, },\n "extraKnownMarketplaces": { "bdb-marketplace": { "source": { "source": "github", "repo": "someone/else" } } },\n}\n');
        const r = await pkg.install(ctxOf(home));
        assert.equal(r.changed, true);
        const s = read(home);
        assert.equal(s.model, 'opus');
        assert.equal(s.enabledPlugins['other@x'], true);
        assert.equal(s.enabledPlugins[KEY], true);
        assert.equal(s.extraKnownMarketplaces['bdb-marketplace'].source.repo, 'someone/else');
        assert.equal(baks(home).length, 1);
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
