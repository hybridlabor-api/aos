// Gateway doctor rows: direct-by-design duplicates and unverified harness rows (report only).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const doctor = require('../lib/gateway/doctor.js');
const HARNESS_ROWS = require('../lib/harnesses.json');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-p0-'));

test('unverified harness rows are listed by the doctor as not managed by the gateway', () => {
    const row = doctor.gatewayChecks({ home: tmp(), files: [], platform: 'linux' })
        .find((c) => c.name === 'not managed by the gateway (unverified)');
    assert.ok(row, 'row present');
    const ids = row.detail.split(', ');
    for (const h of HARNESS_ROWS.filter((x) => !x.verified)) assert.ok(ids.includes(h.id), h.id);
    for (const h of HARNESS_ROWS.filter((x) => x.verified)) assert.ok(!ids.includes(h.id), h.id);
});

test('a direct-by-design server gets a "direct by design" row next to the unchanged duplicates row', () => {
    const home = tmp();
    const file = path.join(home, '.claude.json');
    fs.writeFileSync(file, JSON.stringify({ mcpServers: {
        aos: { type: 'http', url: 'http://127.0.0.1:7790/mcp' },
        bdb_blender_official_mcp: { command: 'node', args: ['b.js'] },
    } }));
    const checks = doctor.gatewayChecks({ home, files: [{ file, kind: 'claude' }], platform: 'linux' });
    const dup = checks.find((c) => c.name === `gateway duplicates in ${file}`);
    const byDesign = checks.find((c) => c.name === `gateway direct by design in ${file}`);
    assert.ok(dup, 'existing duplicates row still present');
    assert.ok(byDesign, 'direct-by-design row present');
    assert.equal(byDesign.ok, true);
    assert.match(byDesign.detail, /bdb_blender_official_mcp/);
});
