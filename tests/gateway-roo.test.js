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
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-roo-'));
    const g = path.join(home, 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json');
    const p = path.join(home, 'proj', '.roo', 'mcp.json');
    for (const f of [g, p]) {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, JSON.stringify({ mcpServers: { mine: { command: 'node', args: ['m.js'], alwaysAllow: ['x'] }, github: sec.wrapServer('github', shipped.github, sec.launcherPath(home)) }, other: 1 }, null, 2));
    }
    return { home, g, p, files: [{ file: g, kind: 'json' }, { file: p, kind: 'json' }] };
}

test('classify recognises Roo files', () => {
    const fx = fixture();
    assert.equal(harness.classify(fx.g, 'json'), 'roo');
    assert.equal(harness.classify(fx.p, 'json'), 'roo');
});

test('enable adds streamable-http aos, keeps unrelated content, backs up, is idempotent; disable restores', () => {
    const fx = fixture();
    const before = fs.readFileSync(fx.g, 'utf8');
    const rep = harness.enable({ home: fx.home, token: TOKEN, shipped, files: fx.files, now: 1000 });
    assert.ok(rep.every((r) => r.kind === 'roo' && r.changed && !r.skipped && !r.error));
    const j = JSON.parse(fs.readFileSync(fx.g, 'utf8'));
    assert.deepEqual(j.mcpServers.aos, { type: 'streamable-http', url: harness.GATEWAY_URL, headers: { 'X-AOS-Token': TOKEN } });
    assert.equal(j.other, 1);
    assert.deepEqual(j.mcpServers.mine.alwaysAllow, ['x']);
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

test('Windsurf stays skipped', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-roo-'));
    const file = path.join(home, '.codeium', 'windsurf', 'mcp_config.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"mcpServers":{}}');
    const rep = harness.enable({ home, token: TOKEN, shipped, files: [{ file, kind: 'json' }], now: 1 });
    assert.ok(rep.length === 1 && rep[0].skipped === 'shape unverified');
});

test('a preset URL is AOS-shaped: enable replaces it, disable removes it', () => {
    const fx = fixture();
    const preset = harness.entryFor('roo', TOKEN, 'aos-core');
    assert.equal(preset.url, `${harness.GATEWAY_URL}?preset=aos-core`);
    assert.ok(harness.isAosShaped(preset));
    fs.writeFileSync(fx.g, JSON.stringify({ mcpServers: { aos: preset } }));
    const rep = harness.enable({ home: fx.home, token: TOKEN, shipped, files: fx.files, now: 1000 });
    assert.equal(rep.find((r) => r.file === fx.g).conflict, undefined);
    assert.deepEqual(JSON.parse(fs.readFileSync(fx.g, 'utf8')).mcpServers.aos, harness.entryFor('roo', TOKEN));
    fs.writeFileSync(fx.g, JSON.stringify({ mcpServers: { aos: preset } }));
    harness.disable({ home: fx.home, files: fx.files, now: 2000 });
    assert.equal(JSON.parse(fs.readFileSync(fx.g, 'utf8')).mcpServers.aos, undefined);
});
