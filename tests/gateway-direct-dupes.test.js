const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const harness = require('../lib/gateway/harness.js');
const sec = require('../lib/mcp-secrets.js');
const { gatewayCovered, alternatesOf } = require('../lib/gateway/config.js');

const ROOT = path.resolve(__dirname, '..');
const TOKEN = 'f'.repeat(64);
const shipped = sec.shippedServers(ROOT);

function fixture() {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-dupes-'));
    const mcps = path.join(home, '.gemini', 'config', 'mcps');
    const aeBin = { command: path.join(mcps, 'ae-mcp', 'bin', 'ae-mcp'), args: [] };
    const github = JSON.parse(JSON.stringify(shipped.github));
    const file = path.join(home, '.claude.json');
    const data = {
        mcpServers: { github, bdb_after_effects_mcp_fallback: aeBin, mine: { command: 'node', args: ['m.js'] } },
        projects: { '/p/one': { mcpServers: { github, keep: { command: 'x', args: [] } } }, '/p/two': { other: 1 } },
    };
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return { home, file, files: [{ file, kind: 'json' }], aeBin, github };
}
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

test('alternates of a gateway server count as covered; unrelated names do not', () => {
    assert.ok(gatewayCovered('bdb_after_effects_mcp_fallback'));
    assert.ok(gatewayCovered('github'));
    assert.ok(!gatewayCovered('mcsc'));
    assert.deepEqual(alternatesOf('github'), []);
});

test('the built ae-mcp binary is AOS-owned; a binary outside mcps/ is not', () => {
    const fx = fixture();
    assert.ok(sec.isAosOwned('bdb_after_effects_mcp_fallback', fx.aeBin, undefined, shipped));
    assert.ok(!sec.isAosOwned('bdb_after_effects_mcp_fallback', { command: '/opt/ae-mcp', args: [] }, undefined, shipped));
});

test('enable strips duplicates top-level and per project; disable puts each back where it was', () => {
    const fx = fixture();
    const rep = harness.enable({ home: fx.home, token: TOKEN, shipped, files: fx.files, now: 1000 });
    assert.ok(!rep[0].error, rep[0].error);
    let j = read(fx.file);
    assert.equal(j.mcpServers.github, undefined);
    assert.equal(j.mcpServers.bdb_after_effects_mcp_fallback, undefined);
    assert.ok(j.mcpServers.mine && j.mcpServers.aos);
    assert.equal(j.projects['/p/one'].mcpServers.github, undefined);
    assert.ok(j.projects['/p/one'].mcpServers.keep);
    assert.deepEqual(j.projects['/p/two'], { other: 1 });

    harness.disable({ home: fx.home, files: fx.files, now: 2000 });
    j = read(fx.file);
    assert.deepEqual(j.mcpServers.github, fx.github);
    assert.deepEqual(j.mcpServers.bdb_after_effects_mcp_fallback, fx.aeBin);
    assert.deepEqual(j.projects['/p/one'].mcpServers.github, fx.github);
    assert.equal(j.mcpServers.aos, undefined);
});

test('a later per-project record does not drop the earlier top-level record of the same name', () => {
    const fx = fixture();
    const d = read(fx.file);
    delete d.projects['/p/one'].mcpServers.github;
    fs.writeFileSync(fx.file, JSON.stringify(d, null, 2));
    harness.enable({ home: fx.home, token: TOKEN, shipped, files: fx.files, now: 1000 });

    const d2 = read(fx.file);
    d2.projects['/p/one'].mcpServers.github = fx.github;
    fs.writeFileSync(fx.file, JSON.stringify(d2, null, 2));
    harness.enable({ home: fx.home, token: TOKEN, shipped, files: fx.files, now: 2000 });
    const gh = harness.readMigration(fx.home).filter((r) => r.key === 'github');
    assert.deepEqual(gh.map((r) => r.project).sort(), ['/p/one', undefined].sort());

    harness.disable({ home: fx.home, files: fx.files, now: 3000 });
    const j = read(fx.file);
    assert.deepEqual(j.mcpServers.github, fx.github);
    assert.deepEqual(j.projects['/p/one'].mcpServers.github, fx.github);
});

test('a record for a project that no longer exists stays recorded instead of landing top-level', () => {
    const fx = fixture();
    const d = read(fx.file);
    delete d.mcpServers.github;
    fs.writeFileSync(fx.file, JSON.stringify(d, null, 2));
    harness.enable({ home: fx.home, token: TOKEN, shipped, files: fx.files, now: 1000 });
    const d2 = read(fx.file);
    delete d2.projects['/p/one'];
    fs.writeFileSync(fx.file, JSON.stringify(d2, null, 2));
    const rep = harness.disable({ home: fx.home, files: fx.files, now: 2000 });
    assert.ok(rep[0].conflicts.some((c) => c.includes('/p/one')));
    assert.equal(read(fx.file).mcpServers.github, undefined);
    assert.ok(harness.readMigration(fx.home).some((r) => r.project === '/p/one'));
});

const doctor = require('../lib/gateway/doctor.js');
const pkg = require('../lib/v5/pkg-gateway.js');

function withGateway() {
    const fx = fixture();
    const d = read(fx.file);
    d.mcpServers.aos = { type: 'http', url: harness.GATEWAY_URL };
    delete d.mcpServers.github;
    fs.writeFileSync(fx.file, JSON.stringify(d, null, 2));
    const toml = path.join(fx.home, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(toml), { recursive: true });
    fs.writeFileSync(toml, `[mcp_servers.aos]\nurl = "${harness.GATEWAY_URL}"\n\n[mcp_servers.bdb_after_effects_mcp_fallback]\ncommand = ${JSON.stringify(fx.aeBin.command)}\nargs = []\n\n[mcp_servers.mine]\ncommand = "x"\n`);
    return { ...fx, toml, files: [...fx.files, { file: toml, kind: 'toml' }] };
}

test('doctor reports per-project and Codex TOML duplicates red', () => {
    const fx = withGateway();
    const checks = doctor.gatewayChecks({ home: fx.home, files: fx.files, shipped, platform: 'linux' });
    const dup = (f) => checks.find((c) => c.name === `gateway duplicates in ${f}`);
    assert.equal(dup(fx.file).ok, false);
    assert.match(dup(fx.file).detail, /bdb_after_effects_mcp_fallback/);
    assert.match(dup(fx.file).detail, /github \(project \/p\/one\)/);
    assert.equal(checks.find((c) => c.name === `gateway entry in ${fx.toml}`).ok, true);
    assert.equal(dup(fx.toml).ok, false);
    assert.match(dup(fx.toml).detail, /bdb_after_effects_mcp_fallback/);
    assert.doesNotMatch(dup(fx.toml).detail, /mine/);
});

test('verify fails while AOS-owned duplicates sit next to a running gateway, passes once they are gone', async () => {
    const fx = withGateway();
    const ctx = { home: fx.home, env: {}, platform: 'linux', aosRoot: ROOT, statusFn: async () => ({ running: true, port: 7790, upstreams: [] }), sleep: async () => {} };
    const bad = await pkg.verify(ctx, { tries: 1 });
    assert.equal(bad.ok, false);
    assert.ok(bad.dupes.some((d) => d.includes('/p/one')));
    assert.equal((await pkg.verify(ctx, { tries: 1, forwarderOnly: true })).ok, true);

    harness.enable({ home: fx.home, token: TOKEN, shipped, files: fx.files, now: 1000 });
    const good = await pkg.verify(ctx, { tries: 1 });
    assert.equal(good.ok, true, good.detail);
});

test('doctor reports an adopted server that is still configured directly', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-dupes-adopted-'));
    const file = path.join(home, '.claude.json');
    const mine = { command: 'node', args: ['m.js'], env: {} };
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { aos: { type: 'http', url: harness.GATEWAY_URL, headers: { 'X-AOS-Token': TOKEN } }, mine: { command: 'node', args: ['m.js'] } } }));
    fs.mkdirSync(path.join(home, '.agents', 'gateway'), { recursive: true });
    fs.writeFileSync(path.join(home, '.agents', 'gateway', 'adopted.json'), JSON.stringify({ version: 1, servers: { mine } }));
    const row = doctor.gatewayChecks({ home, files: [{ file, kind: 'claude' }], shipped, platform: 'linux', nodeMajor: 24 })
        .find((c) => c.name === `gateway duplicates in ${file}`);
    assert.equal(row.ok, false);
    assert.match(row.detail, /mine/);
});

test('R2: documented rows migrate (backup, record, idempotent); unverified rows are skipped and untouched', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-rows-'));
    const github = JSON.parse(JSON.stringify(shipped.github));
    const zavora = JSON.parse(JSON.stringify(shipped.zavora_computer_use));
    const mcsc = JSON.parse(JSON.stringify(shipped.mcsc));
    const mine = { command: 'node', args: ['m.js'] };
    const body = (root) => JSON.stringify({ [root]: { github, zavora_computer_use: zavora, mcsc, mine } }, null, 2);
    const mk = (rel, root) => { const file = path.join(home, ...rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body(root)); return file; };
    const on = [
        ['windsurf', mk(['.config', 'devin', 'mcp_config.json'], 'mcpServers'), 'mcpServers', { serverUrl: harness.GATEWAY_URL, headers: { 'X-AOS-Token': TOKEN } }],
        ['cline', mk(['.cline', 'data', 'settings', 'cline_mcp_settings.json'], 'mcpServers'), 'mcpServers', { type: 'streamableHttp', url: harness.GATEWAY_URL, headers: { 'X-AOS-Token': TOKEN } }],
    ];
    const off = [
        mk(['Library', 'Application Support', 'Code', 'User', 'mcp.json'], 'servers'),
        mk(['Library', 'Application Support', 'Cursor', 'User', 'mcp.json'], 'mcpServers'),
        mk(['.gemini', 'antigravity-cli', 'mcp_config.json'], 'mcpServers'),
        mk(['.windsurf', 'mcp.json'], 'mcpServers'),
    ];
    const offBefore = off.map((f) => fs.readFileSync(f, 'utf8'));
    const files = [...on.map(([, f]) => ({ file: f, kind: 'json' })), ...off.map((f) => ({ file: f, kind: 'json' }))];
    const before = on.map(([, f]) => fs.readFileSync(f, 'utf8'));
    const rep = harness.enable({ home, token: TOKEN, shipped, files, now: 1000 });
    on.forEach(([id, file, root, aos], i) => {
        assert.ok(!rep[i].error && !rep[i].skipped, `${id}: ${rep[i].error || rep[i].skipped}`);
        const j = read(file);
        assert.deepEqual(j[root].aos, aos, id);
        assert.equal(j[root].github, undefined, id);
        assert.equal(j[root].zavora_computer_use, undefined, id);
        assert.deepEqual(j[root].mine, mine, id);
        assert.deepEqual(j[root].mcsc, mcsc, `${id}: mcsc stays direct by design`);
        assert.equal(fs.readFileSync(rep[i].backup, 'utf8'), before[i], `${id}: backup holds the original`);
    });
    off.forEach((f, i) => {
        assert.equal(rep[on.length + i].skipped, 'shape unverified', f);
        assert.equal(fs.readFileSync(f, 'utf8'), offBefore[i], `${f} untouched`);
    });
    const recs = harness.readMigration(home);
    for (const [, file] of on) {
        assert.deepEqual(recs.filter((r) => r.file === file && !r.added).map((r) => r.key).sort(), ['github', 'zavora_computer_use']);
        assert.ok(recs.some((r) => r.file === file && r.key === 'aos' && r.added));
    }
    const after = on.map(([, f]) => fs.readFileSync(f, 'utf8'));
    const again = harness.enable({ home, token: TOKEN, shipped, files, now: 2000 });
    assert.ok(again.every((r) => !r.changed), 'second enable is a no-op');
    assert.deepEqual(on.map(([, f]) => fs.readFileSync(f, 'utf8')), after);
});
