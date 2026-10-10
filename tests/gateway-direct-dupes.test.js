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
    assert.ok(!gatewayCovered('deja'));
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
