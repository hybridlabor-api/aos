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

test('defaults: standard, only the opt-in Token Saver is left out', () => {
    const o = parse();
    assert.strictEqual(o.profile, 'standard');
    assert.strictEqual(o.profileGiven, false);
    assert.deepStrictEqual(o.without, []);
    const r = p.resolve(o, {});
    assert.strictEqual(r.profile, 'standard');
    assert.strictEqual(r.contextHooks, true);
    assert.deepStrictEqual([...r.excluded], ['token-saver']);
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
    assert.deepStrictEqual([...r.excluded].sort(), ['memb', 'synapse', 'token-saver']);
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
    assert.deepStrictEqual(p.readSettings(home), { disabled: [], updates: 'notify' });
    p.writeSettings(home, { ...p.readSettings(home), profile: 'minimal', disabled: ['fleet'] });
    assert.deepStrictEqual(p.readSettings(home), { disabled: ['fleet'], profile: 'minimal', updates: 'notify' });
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

test('F8: an unknown command exits 2 and writes nothing, neither in HOME nor in the cwd repo (container only)', { skip: process.env.AOS_TEST_SANDBOX !== 'container' }, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-f8-home-'));
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-f8-repo-'));
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'installer.js'), 'gateway', 'status'], {
        cwd: repo, env: { ...process.env, HOME: home, USERPROFILE: home, AOS_PLUGIN_CLI: 'off' }, encoding: 'utf8', timeout: 120000,
    });
    assert.strictEqual(r.status, 2, r.stderr);
    assert.match(r.stderr, /unknown command "gateway"/);
    assert.deepStrictEqual(fs.readdirSync(repo), []);
    assert.deepStrictEqual(fs.readdirSync(home), []);
});

test('installer: --hooks-only --no-hooks --dry-run writes nothing under HOME (container only)', { skip: process.env.AOS_TEST_SANDBOX !== 'container' }, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-opt-dry-'));
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'installer.js'), '--hooks-only', '--no-hooks', '--dry-run', '-y', '--no-intro'], {
        env: { ...process.env, HOME: home, USERPROFILE: home, AOS_PLUGIN_CLI: 'off' }, encoding: 'utf8', timeout: 120000,
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(fs.readdirSync(home), []);
});

// ---- review-install-options repair (S1, S2, S3, S6, R1, P1-P3) ----

const collect = () => { const lines = []; return [lines, (m) => { lines[lines.length] = m; }]; };
const writeRaw = (home, text) => {
    fs.mkdirSync(path.dirname(p.settingsFile(home)), { recursive: true });
    fs.writeFileSync(p.settingsFile(home), text);
};
const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-opt-b-'));

test('S1: inherited object keys are not profiles (flag, env, saved value)', () => {
    for (const bad of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
        assert.throws(() => parse([`--profile=${bad}`]), /Unknown profile/, bad);
        assert.throws(() => parse([], { AOS_PROFILE: bad }), /Unknown profile/, bad);
        assert.strictEqual(p.knownProfile(bad), false, bad);
        assert.strictEqual(p.resolve(parse(), { profile: bad }).profile, 'standard', bad);
        assert.strictEqual(p.profileOf({ profile: bad }), 'standard', bad);
    }
    const home = tmpHome();
    writeRaw(home, '{"profile":"__proto__"}');
    const [warns, warn] = collect();
    const st = p.readSettings(home, warn);
    assert.strictEqual(st.profile, undefined);
    assert.strictEqual(p.resolve(parse(), st).profile, 'standard');
    assert.strictEqual(warns.length, 1);
    assert.match(warns[0], /profile/);
});

test('S2: a corrupt or odd settings file never throws and falls back to defaults', () => {
    const cases = {
        'null': 'null', 'string': '"minimal"', 'number': '7', 'array': '[1,2]', 'invalid json': '{nope',
        'numbers in disabled': '{"disabled":[1,2]}', 'disabled string': '{"disabled":"memb"}',
        'noHooks string': '{"noHooks":"yes"}', 'proto key': '{"__proto__":{"profile":"minimal"},"constructor":1}',
    };
    for (const [name, text] of Object.entries(cases)) {
        const home = tmpHome();
        writeRaw(home, text);
        const [warns, warn] = collect();
        let st;
        assert.doesNotThrow(() => { st = p.readSettings(home, warn); }, name);
        assert.deepStrictEqual(st.disabled, [], name);
        assert.strictEqual(st.profile, undefined, name);
        assert.strictEqual(st.noHooks, undefined, name);
        assert.ok(!Object.hasOwn(st, '__proto__') && !Object.hasOwn(st, 'constructor'), name);
        assert.strictEqual(({}).profile, undefined, `${name}: no pollution`);
        assert.ok(warns.length >= 1, `${name}: warns once or more`);
        assert.doesNotThrow(() => p.resolve(parse(), st), name);
    }
    for (const odd of [null, 'x', [], 5, { disabled: 'memb', profile: 'constructor', noHooks: 'yes' }, { disabled: [null, 3, {}] }]) {
        const r = p.resolve(parse(), odd);
        assert.strictEqual(r.profile, 'standard');
        assert.strictEqual(r.contextHooks, true);
        assert.deepStrictEqual([...r.excluded], ['token-saver']);
    }
    const none = tmpHome();
    const [quiet, warn] = collect();
    assert.deepStrictEqual(p.readSettings(none, warn), { disabled: [], updates: 'notify' });
    assert.strictEqual(quiet.length, 0, 'a missing file is silent');
});

test('S2: unknown ids in disabled are dropped, known ones kept', () => {
    const home = tmpHome();
    writeRaw(home, '{"disabled":["fleet","nope",7,"fleet"],"profile":"full","noHooks":true,"extra":1}');
    const [warns, warn] = collect();
    const st = p.readSettings(home, warn);
    assert.deepStrictEqual(st.disabled, ['fleet']);
    assert.strictEqual(st.profile, 'full');
    assert.strictEqual(st.noHooks, true);
    assert.strictEqual(st.extra, 1);
    assert.strictEqual(warns.length, 1);
});

test('S3: only a flag is saved, AOS_PROFILE is not; settings reset to standard', () => {
    assert.strictEqual(parse(['--profile=minimal']).profileFromFlag, true);
    const viaEnv = parse([], { AOS_PROFILE: 'minimal' });
    assert.strictEqual(viaEnv.profileFromFlag, false);
    assert.strictEqual(viaEnv.profileGiven, true, 'the env still applies to this run');
    assert.strictEqual(p.resolve(viaEnv, {}).profile, 'minimal');
    assert.strictEqual(parse().profileFromFlag, false);
    assert.strictEqual(p.resolve(parse(['--profile=standard']), { profile: 'minimal', noHooks: true }).profile, 'standard');
});

test('S3: uninstall moves the saved options aside and keeps foreign keys', () => {
    const ur = require('../lib/uninstall-records');
    const home = tmpHome();
    p.writeSettings(home, { profile: 'minimal', noHooks: true, disabled: ['fleet'] });
    const dir = path.dirname(p.settingsFile(home));
    const before = fs.readFileSync(p.settingsFile(home), 'utf8');
    assert.strictEqual(ur.resetV5Settings({ home, dryRun: true }).length, 1);
    assert.strictEqual(fs.readFileSync(p.settingsFile(home), 'utf8'), before, 'dry run changes nothing');
    assert.strictEqual(ur.resetV5Settings({ home, dryRun: false }).length, 1);
    const names = fs.readdirSync(dir);
    assert.ok(!names.includes('v5-settings.json'));
    const aside = names.find((n) => n.startsWith('v5-settings.json.removed-'));
    assert.ok(aside, 'the file is moved aside, not removed');
    assert.strictEqual(fs.readFileSync(path.join(dir, aside), 'utf8'), before);
    assert.deepStrictEqual(p.readSettings(home), { disabled: [], updates: 'notify' });
    assert.deepStrictEqual(ur.resetV5Settings({ home, dryRun: false }), []);

    const home2 = tmpHome();
    p.writeSettings(home2, { profile: 'full', keep: 'me' });
    ur.resetV5Settings({ home: home2, dryRun: false });
    assert.deepStrictEqual(p.readSettings(home2), { disabled: [], updates: 'notify', keep: 'me' });
    const lines = ur.reverseRegistrations({ home: home2, dryRun: true });
    assert.ok(!lines.some((l) => /Saved install options/.test(l)), 'nothing owned is left to reset');
});

test('S6: update and repair skip what the profile excludes, like disabled ids', async () => {
    assert.deepStrictEqual([...p.excludedIds({ profile: 'minimal', disabled: ['synapse'] })].sort(), ['alert', 'codenotch', 'control', 'deja', 'fleet', 'gateway', 'hub', 'memb', 'openwiki', 'sessions', 'synapse', 'token-saver']);
    assert.deepStrictEqual([...p.excludedIds(null)], ['token-saver']); // the standard profile leaves the opt-in Token Saver out
    assert.deepStrictEqual([...p.excludedIds({ profile: 'constructor' })], ['token-saver']);

    const pk = require('../lib/v5/packages');
    if (Object.isFrozen(pk.registry)) return;
    const menu = require('../lib/v5/menu');
    const home = tmpHome();
    p.writeSettings(home, { profile: 'minimal', disabled: ['synapse'] });
    const repaired = {};
    const fake = (id) => ({ id, name: id, detect: async () => ({ installed: true }), verify: async () => ({ ok: Boolean(repaired[id]) }), repair: async () => { repaired[id] = true; } });
    const saved = pk.registry.slice();
    try {
        pk.registry.splice(0, pk.registry.length, ...['openwiki', 'synapse', 'ao'].map(fake));
        const code = await menu.repair({ detectInstallState: () => ({}) }, { home, write: () => {}, logFile: path.join(home, 'repair.log') });
        assert.strictEqual(code, 0);
    } finally {
        pk.registry.splice(0, pk.registry.length, ...saved);
    }
    assert.deepStrictEqual(Object.keys(repaired), ['ao'], 'openwiki (profile) and synapse (disabled) are left alone');
});

test('R1: one hook list; the shipped Claude template is covered exactly once', () => {
    const lists = [p.ALWAYS_HOOKS, p.CONTEXT_HOOKS, p.OTHER_HOOKS];
    for (const l of lists) assert.strictEqual(new Set(l).size, l.length);
    // gate-profile.mjs and session-cap.mjs are import-only helpers (of go-gate / memb-inject and aos-session-hint):
    // copied with the hooks, never wired, so in no list.
    assert.deepStrictEqual([...p.HOOK_SCRIPTS].sort(), ['gate-profile.mjs', 'session-cap.mjs', ...lists.flat()].sort());
    assert.strictEqual(new Set(p.HOOK_SCRIPTS).size, p.HOOK_SCRIPTS.length, 'no script in two lists');
    assert.ok(p.CLAUDE_MERGE_HOOKS.every((n) => p.HOOK_SCRIPTS.includes(n)));

    const template = fs.readFileSync(path.join(__dirname, '..', '.claude', 'settings.json'), 'utf8');
    const named = [...new Set([...template.matchAll(/\.claude\/hooks\/([\w-]+\.mjs)/g)].map((m) => m[1]))];
    assert.ok(named.length >= 10, 'the template names the hooks');
    for (const n of named) {
        assert.strictEqual(lists.filter((l) => l.includes(n)).length, 1, `${n} is in exactly one list`);
        assert.ok(p.CLAUDE_MERGE_HOOKS.includes(n), `${n} is owned by the Claude merge`);
    }

    const ur = require('../lib/uninstall-records');
    assert.strictEqual(ur.CODEX_AOS_SCRIPTS, p.HOOK_SCRIPTS);
    for (const rel of ['installer.js', 'lib/uninstall-records.js', 'bin/aos-uninstall.mjs']) {
        const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
        assert.ok(!/\[\s*'go-gate\.mjs'/.test(src), `${rel} holds no copy of the hook list`);
    }
});

test('P1: --hooks-only with --profile or --without is an error; with --no-hooks it is fine', () => {
    assert.throws(() => parse(['--hooks-only', '--profile=minimal']), /--hooks-only cannot be combined/);
    assert.throws(() => parse(['--profile', 'full', '--hooks-only']), /--hooks-only cannot be combined/);
    assert.throws(() => parse(['--hooks-only', '--without=memb']), /--hooks-only cannot be combined/);
    assert.strictEqual(parse(['--hooks-only', '--no-hooks']).hooksOnly, true);
    assert.strictEqual(parse(['--hooks-only'], { AOS_PROFILE: 'minimal' }).hooksOnly, true);
});

test('P2: switches take no value', () => {
    for (const bad of ['--no-hooks=false', '--no-hooks=0', '--no-hooks=', '--hooks-only=1']) {
        assert.throws(() => parse([bad]), /takes no value/, bad);
    }
    assert.strictEqual(parse(['--no-hooks']).noHooks, true);
});

test('P3: --profile and --without accept the space form', () => {
    assert.strictEqual(parse(['--profile', 'minimal']).profile, 'minimal');
    assert.strictEqual(parse(['-y', '--profile', 'FULL', '--dry-run']).profile, 'full');
    assert.deepStrictEqual(parse(['--without', 'memb,fleet']).without, ['memb', 'fleet']);
    assert.throws(() => parse(['--profile', '--no-hooks']), /needs a value/);
    assert.throws(() => parse(['--without', '-y']), /needs a value/);
    assert.throws(() => parse(['--profile', 'huge']), /Unknown profile "huge"/);
});

test('S5: --hooks-only does not belong to status, update or repair', () => {
    for (const cmd of ['status', 'update', 'repair']) assert.throws(() => parse([cmd, '--hooks-only']), new RegExp(`aos ${cmd}`));
    assert.strictEqual(parse(['--hooks-only']).hooksOnly, true);
});
