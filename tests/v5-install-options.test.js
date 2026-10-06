// Install options: --profile, --no-hooks, --hooks-only, --without, AOS_DISABLED_MCPS. Pure functions; the installer run is container-only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const p = require('../lib/v5/profile');
const IDS = ['kernel', 'memb', 'synapse', 'openwiki', 'fleet', 'gateway'];
const parse = (argv = [], env = {}) => p.parseOptions(['node', 'installer.js', ...argv], env, IDS);

test('defaults: standard, nothing skipped', () => {
    const o = parse();
    assert.strictEqual(o.profile, 'standard');
    assert.strictEqual(o.profileGiven, false);
    assert.deepStrictEqual(o.without, []);
    const r = p.resolve(o, {});
    assert.strictEqual(r.profile, 'standard');
    assert.strictEqual(r.contextHooks, true);
    assert.strictEqual(r.excluded.size, 0);
});

test('profile: flag wins over AOS_PROFILE, unknown value is an error', () => {
    assert.strictEqual(parse(['--profile=full'], { AOS_PROFILE: 'minimal' }).profile, 'full');
    assert.strictEqual(parse([], { AOS_PROFILE: 'MINIMAL' }).profile, 'minimal');
    assert.throws(() => parse(['--profile=huge']), /Unknown profile "huge"/);
    assert.throws(() => parse(['--profile']), /needs a value/);
});

test('minimal: no context hooks, no gateway, no fleet; full keeps hooks', () => {
    const min = p.resolve(parse(['--profile=minimal']), {});
    assert.strictEqual(min.contextHooks, false);
    assert.ok(min.excluded.has('gateway') && min.excluded.has('fleet'));
    assert.strictEqual(p.resolve(parse(['--profile=full']), {}).contextHooks, true);
});

test('--no-hooks only turns context hooks off; persisted settings apply without flags', () => {
    assert.strictEqual(p.resolve(parse(['--no-hooks']), {}).contextHooks, false);
    assert.strictEqual(p.resolve(parse(), { profile: 'minimal' }).profile, 'minimal');
    assert.strictEqual(p.resolve(parse(), { noHooks: true }).contextHooks, false);
    assert.strictEqual(p.resolve(parse(['--profile=standard']), { noHooks: true }).contextHooks, true, 'explicit profile resets the saved flag');
});

test('--hooks-only is parsed', () => {
    assert.strictEqual(parse(['--hooks-only']).hooksOnly, true);
    assert.strictEqual(parse().hooksOnly, false);
});

test('--without maps to registry ids; unknown id and kernel are errors', () => {
    assert.deepStrictEqual(parse(['--without=memb, fleet']).without, ['memb', 'fleet']);
    const r = p.resolve(parse(['--without=memb']), { disabled: ['synapse'] });
    assert.deepStrictEqual([...r.excluded].sort(), ['memb', 'synapse']);
    assert.throws(() => parse(['--without=nope,memb']), /Unknown id\(s\) in --without: nope/);
    assert.throws(() => parse(['--without=kernel']), /kernel/);
    assert.throws(() => parse(['--without']), /needs a value/);
});

test('every real registry id is accepted by --without', () => {
    const ids = require('../lib/v5/packages').registry.map((x) => x.id).filter((id) => id !== 'kernel');
    assert.deepStrictEqual(p.parseOptions(['n', 'i', `--without=${ids.join(',')}`], {}, () => ['kernel', ...ids]).without, ids);
    for (const id of ['gateway', 'fleet', ...p.PROFILES.minimal.exclude]) assert.ok(ids.includes(id), `${id} is a registry id`);
});

test('AOS_DISABLED_MCPS: listed servers dropped, unknown names reported once', () => {
    const servers = { memb_mcp: {}, deja: {}, tdmcp: {} };
    const list = p.parseList(' deja, nope ,,tdmcp');
    assert.deepStrictEqual(list, ['deja', 'nope', 'tdmcp']);
    const r = p.filterMcpServers(servers, list);
    assert.deepStrictEqual(Object.keys(r.servers), ['memb_mcp']);
    assert.deepStrictEqual(r.unknown, ['nope']);
    assert.deepStrictEqual(Object.keys(servers), ['memb_mcp', 'deja', 'tdmcp'], 'input untouched');
    assert.deepStrictEqual(p.filterMcpServers(servers, []).servers, servers);
});

test('gate hooks are never skipped by any profile', () => {
    for (const [name, prof] of Object.entries(p.PROFILES)) {
        for (const h of prof.skippedHooks) assert.ok(!p.ALWAYS_HOOKS.includes(h), `${name} skips gate hook ${h}`);
        assert.ok(prof.skippedHooks.every((h) => p.CONTEXT_HOOKS.includes(h)), `${name} skips only context hooks`);
    }
    for (const g of ['go-gate.mjs', 'graph-gate.mjs']) assert.ok(p.ALWAYS_HOOKS.includes(g));
    assert.strictEqual(p.ALWAYS_HOOKS.filter((h) => p.CONTEXT_HOOKS.includes(h)).length, 0);
    assert.deepStrictEqual(p.PROFILES.minimal.skippedHooks, p.CONTEXT_HOOKS);
});

test('dropContextHooks keeps gate and foreign hooks, drops context and emptied entries', () => {
    const entries = [
        { matcher: 'Bash', hooks: [{ command: 'node "$HOME/.claude/hooks/go-gate.mjs"' }] },
        { hooks: [{ command: 'node "$HOME/.claude/hooks/memb-inject.mjs"' }, { command: 'node mine.js' }] },
        { hooks: [{ command: 'node "$HOME/.claude/hooks/trail-relay.mjs" --agent claude' }] },
        { matcher: 'Stop', hooks: [{ command: 'node "$HOME/.claude/hooks/graph-gate.mjs"' }] },
    ];
    const kept = p.dropContextHooks(entries);
    const cmds = kept.flatMap((e) => e.hooks.map((h) => h.command)).join('\n');
    assert.ok(cmds.includes('go-gate.mjs') && cmds.includes('graph-gate.mjs') && cmds.includes('node mine.js'));
    assert.ok(!/memb-inject|trail-relay/.test(cmds));
    assert.strictEqual(kept.length, 3);
});

test('settings: profile persists in the v5 settings file next to the disabled list', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-opt-'));
    assert.deepStrictEqual(p.readSettings(home), { disabled: [] });
    p.writeSettings(home, { ...p.readSettings(home), profile: 'minimal', disabled: ['fleet'] });
    assert.deepStrictEqual(p.readSettings(home), { disabled: ['fleet'], profile: 'minimal' });
    assert.ok(p.settingsFile(home).endsWith(path.join('.aos', 'v5-settings.json')));
});

test('installer: --hooks-only --no-hooks keeps the gate hooks (container only)', { skip: process.env.AOS_TEST_SANDBOX !== 'container' }, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-opt-home-'));
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'installer.js'), '--hooks-only', '--no-hooks', '-y', '--no-intro'], {
        env: { ...process.env, HOME: home, USERPROFILE: home, AOS_PLUGIN_CLI: 'off' }, encoding: 'utf8', timeout: 120000,
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const settings = fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8');
    assert.ok(settings.includes('go-gate.mjs') && settings.includes('graph-gate.mjs'));
    assert.ok(!settings.includes('memb-inject.mjs') && !settings.includes('trail-relay.mjs'));
    assert.strictEqual(p.readSettings(home).noHooks, true);
});

test('installer: --dry-run --profile writes nothing under HOME (container only)', { skip: process.env.AOS_TEST_SANDBOX !== 'container' }, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-opt-dry-'));
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'installer.js'), '--hooks-only', '--profile=minimal', '--dry-run', '-y', '--no-intro'], {
        env: { ...process.env, HOME: home, USERPROFILE: home, AOS_PLUGIN_CLI: 'off' }, encoding: 'utf8', timeout: 120000,
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(fs.readdirSync(home), []);
});
