// OpenCode plugin profile flag: written per profile, read fail-open, context call sites guarded, gate call sites not.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { writeProfileFlag, flagPath } = require('../lib/opencode-profile');
const records = require('../lib/uninstall-records');
const profile = require('../lib/v5/profile');

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-ocprofile-'));
const ocDir = (home) => path.join(home, '.config', 'opencode');
const readFlag = (home) => JSON.parse(fs.readFileSync(flagPath(ocDir(home)), 'utf8'));
const ctx = (argv) => profile.resolve(profile.parseOptions(['node', 'aos', ...argv], {}, []), {}).contextHooks;

test('profile resolution feeds the flag: standard true, minimal and --no-hooks false', () => {
    const home = tmpHome();
    for (const [argv, want] of [[[], true], [['--profile=standard'], true], [['--profile=minimal'], false], [['--no-hooks'], false]]) {
        writeProfileFlag(ocDir(home), ctx(argv));
        assert.deepStrictEqual(readFlag(home), { contextHooks: want }, argv.join(' '));
    }
});

test('write is idempotent: unchanged content is not rewritten', () => {
    const home = tmpHome();
    assert.strictEqual(writeProfileFlag(ocDir(home), true).changed, true);
    const file = flagPath(ocDir(home));
    const past = new Date(Date.now() - 60000);
    fs.utimesSync(file, past, past);
    assert.strictEqual(writeProfileFlag(ocDir(home), true).changed, false);
    assert.strictEqual(fs.statSync(file).mtimeMs, past.getTime());
    assert.strictEqual(writeProfileFlag(ocDir(home), false).changed, true);
    assert.deepStrictEqual(readFlag(home), { contextHooks: false });
});

test('uninstall removes the flag and its record', () => {
    const home = tmpHome();
    const { file } = writeProfileFlag(ocDir(home), false);
    records.recordOpencodeProfile(home, file);
    assert.ok(records.readRecords(home).opencodeProfile);
    const lines = records.reverseRegistrations({ home, dryRun: false });
    assert.ok(lines.some((l) => l.includes('profile flag')), lines.join('\n'));
    assert.ok(!fs.existsSync(file));
    assert.ok(!records.readRecords(home).opencodeProfile);
});

test('uninstall dry run keeps the flag; a foreign file of that name is kept', () => {
    const home = tmpHome();
    const { file } = writeProfileFlag(ocDir(home), true);
    records.reverseRegistrations({ home, dryRun: true });
    assert.ok(fs.existsSync(file));
    fs.writeFileSync(file, JSON.stringify({ contextHooks: true, mine: 1 }));
    records.reverseRegistrations({ home, dryRun: false });
    assert.ok(fs.existsSync(file));
});

test('installOpencodePlugin calls the flag writer and records it', () => {
    const src = fs.readFileSync(path.join(ROOT, 'installer.js'), 'utf8');
    const body = src.slice(src.indexOf('function installOpencodePlugin('));
    const end = body.indexOf('\nfunction ', 10);
    const fn = body.slice(0, end);
    assert.match(fn, /writeProfileFlag\(opencodeDir, contextHooksOn\)/);
    assert.match(fn, /recordOpencodeProfile\(targetHome/);
});

const plugin = fs.readFileSync(path.join(ROOT, '.opencode', 'plugins', 'bdb-aos.js'), 'utf8').split('\n');
const callLines = (name) => plugin.map((l, i) => [l, i]).filter(([l]) => l.includes(name) && !/^\s*(\/\/|\*)/.test(l));
const guarded = (i) => plugin.slice(Math.max(0, i - 8), i + 1).some((l) => l.includes('contextHooks'));

test('plugin reads the flag once at load and fails open', () => {
    const src = plugin.join('\n');
    assert.match(src, /let contextHooks = true;/);
    assert.match(src, /aos-hooks\/aos-profile\.json/);
    assert.match(src, /contextHooks === false/);
    assert.strictEqual((src.match(/aos-profile\.json/g) || []).length, 1);
});

test('every context call site is guarded by contextHooks', () => {
    for (const name of ['buildMemoryBlock({', 'rulesText()', 'trailAutostart(toolInput, directory, input.client)','postTrail({', "trail('PreToolUse'", "trail('PostToolUse'"]) {
        const sites = callLines(name);
        assert.ok(sites.length, `${name} not found`);
        for (const [l, i] of sites) assert.ok(guarded(i), `${name} unguarded at line ${i + 1}: ${l.trim()}`);
    }
});

test('trail wrapper itself is gated, so the other trail() calls are too', () => {
    const i = plugin.findIndex((l) => l.includes('const trail = '));
    assert.ok(i > 0 && guarded(i + 1), 'trail wrapper');
});

test('no gate or A2A call site depends on contextHooks', () => {
    for (const name of ['issueGoToken(', 'applyGogate(', 'hardBlockReason(', 'gateStoreReason(', 'isGuardedCommand(cmd)', 'checkConventionalCommit(cmd)', 'envFileReason(f)', 'openGraphGate(readGraphState', 'ensureSidecar({', 'deliverA2a(input.client', 'tokenGrantsGo(']) {
        const sites = callLines(name).filter(([l]) => !/^\s*(async\s+)?function\s/.test(l));
        assert.ok(sites.length, `${name} not found`);
        for (const [l, i] of sites) assert.ok(!plugin.slice(Math.max(0, i - 2), i + 1).some((x) => x.includes('contextHooks')), `${name} touches contextHooks at line ${i + 1}: ${l.trim()}`);
    }
});

test('only context hooks are skipped by the profile (list sanity)', () => {
    assert.deepStrictEqual([...profile.CONTEXT_HOOKS].sort(), ['aos-session-hint.mjs', 'memb-inject.mjs', 'rules-inject.mjs', 'trail-autostart.mjs', 'trail-relay.mjs']);
    for (const g of ['go-gate.mjs', 'go-token.mjs', 'go-grant.mjs', 'conventional-commits.mjs', 'env-file-protection.mjs', 'graph-gate.mjs']) assert.ok(profile.ALWAYS_HOOKS.includes(g));
});
