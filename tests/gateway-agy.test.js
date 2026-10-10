const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const harness = require('../lib/gateway/harness.js');
const sec = require('../lib/mcp-secrets.js');

const ROOT = path.resolve(__dirname, '..');
const TOKEN = 'e'.repeat(64);
const shipped = sec.shippedServers(ROOT);

function fixture() {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-agy-'));
    const g = path.join(home, '.gemini', 'config', 'mcp_config.json');
    const p = path.join(home, 'proj', '.agents', 'mcp_config.json');
    for (const f of [g, p]) {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, JSON.stringify({ mcpServers: { mine: { command: 'node', args: ['m.js'] }, github: sec.wrapServer('github', shipped.github, sec.launcherPath(home)) }, other: 1 }, null, 2));
    }
    return { home, g, p, files: [{ file: g, kind: 'json' }, { file: p, kind: 'json' }] };
}

test('classify recognises Antigravity global and workspace files only', () => {
    const fx = fixture();
    assert.equal(harness.classify(fx.g, 'json'), 'agy');
    assert.equal(harness.classify(fx.p, 'json'), 'agy');
    assert.equal(harness.classify(path.join(fx.home, '.gemini', 'antigravity-cli', 'mcp_config.json'), 'json'), 'other');
});

test('enable adds serverUrl aos, keeps unrelated content, backs up, is idempotent; disable restores', () => {
    const fx = fixture();
    const before = fs.readFileSync(fx.g, 'utf8');
    const rep = harness.enable({ home: fx.home, token: TOKEN, shipped, files: fx.files, now: 1000 });
    assert.ok(rep.every((r) => r.kind === 'agy' && r.changed && !r.skipped && !r.error));
    const j = JSON.parse(fs.readFileSync(fx.g, 'utf8'));
    assert.deepEqual(j.mcpServers.aos, { serverUrl: harness.GATEWAY_URL, headers: { 'x-aos-token': TOKEN } });
    assert.equal(j.other, 1);
    assert.deepEqual(j.mcpServers.mine.args, ['m.js']);
    assert.equal(j.mcpServers.github, undefined);
    assert.equal(fs.readFileSync(rep[0].backup, 'utf8'), before);
    const again = harness.enable({ home: fx.home, token: TOKEN, shipped, files: fx.files, now: 2000 });
    assert.ok(again.every((r) => !r.changed));
    const dis = harness.disable({ home: fx.home, files: fx.files, now: 3000 });
    assert.ok(dis.some((r) => r.removedAos));
    const back = JSON.parse(fs.readFileSync(fx.g, 'utf8'));
    assert.equal(back.mcpServers.aos, undefined);
    assert.ok(back.mcpServers.github);
});

test('AOS-shaped match is a prefix on the gateway URL, for url and serverUrl', () => {
    assert.ok(harness.isAosShaped({ url: `${harness.GATEWAY_URL}?preset=x` }));
    assert.ok(harness.isAosShaped({ serverUrl: harness.GATEWAY_URL }));
    assert.ok(!harness.isAosShaped({ serverUrl: 'http://example.com/mcp' }));
});

test('template presets: exclusions become an AND NOT chain, "all" is empty, enable writes ?preset=<kind>', () => {
    const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'mcp_config.json'), 'utf8')).presets;
    const { presetFor } = require('../lib/gateway/config.js');
    assert.equal(presetFor('agy', presets), 'NOT bdb_davinci_mcp');
    assert.equal(presetFor('claude', presets), '');
    assert.equal(presetFor('unknown', presets), null);
    assert.equal(presetFor('x', { x: ['a', 'b'] }), 'NOT a AND NOT b');

    const fx = fixture();
    harness.enable({ home: fx.home, token: TOKEN, shipped, files: fx.files, presets, now: 1000 });
    assert.equal(JSON.parse(fs.readFileSync(fx.g, 'utf8')).mcpServers.aos.serverUrl, `${harness.GATEWAY_URL}?preset=agy`);
    assert.ok(harness.isAosShaped({ serverUrl: `${harness.GATEWAY_URL}?preset=agy` }));

    const claude = path.join(fx.home, '.claude.json');
    fs.writeFileSync(claude, JSON.stringify({ mcpServers: {} }));
    harness.enable({ home: fx.home, token: TOKEN, shipped, files: [{ file: claude, kind: 'json' }], presets, now: 2000 });
    assert.equal(JSON.parse(fs.readFileSync(claude, 'utf8')).mcpServers.aos.url, `${harness.GATEWAY_URL}?preset=claude`);
});
