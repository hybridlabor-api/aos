// #188: AOS-owned mcp entries are written into and removed from a commented opencode.jsonc as a text patch.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const harness = require('../lib/gateway/harness.js');
const sec = require('../lib/mcp-secrets.js');
const { patchJsoncMap, parseJsonc } = require('../lib/jsonc.js');
const records = require('../lib/uninstall-records.js');

const ROOT = path.resolve(__dirname, '..');
const TOKEN = 'f'.repeat(64);
const shipped = sec.shippedServers(ROOT);

const MINE = '    "mine": { "type": "local", "command": ["node", "mine.js"], }, // my own server\n';
const ocGithub = () => `    "github": ${JSON.stringify({ type: 'local', command: [shipped.github.command, ...(shipped.github.args || [])], enabled: true })},\n`;
const doc = (extra, trailing) => `// my opencode config
{
  /* block comment above plugin */
  "plugin": ["opencode-foo@1.0.0",], // line comment
  "mcp": {
    // user server below
${MINE}${extra}    "other": { "type": "remote", "url": "https://example.test/mcp" }${trailing ? ',' : ''}
  },
  "theme": "dark",
}
`;

function fixture(text) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-jsonc188-'));
    const dir = path.join(home, '.config', 'opencode');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'opencode.jsonc');
    fs.writeFileSync(file, text);
    return { home, file, files: [{ file, kind: 'opencode' }] };
}
const comments = ['// my opencode config', '/* block comment above plugin */', '// line comment', '// user server below', '// my own server'];
const baks = (file) => fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith('opencode.jsonc.') && n.includes('bak'));

for (const trailing of [true, false]) {
    test(`enable adds the aos entry, keeps comments and user entries, rerun is a no-op, disable restores the bytes (trailing comma: ${trailing})`, () => {
        const original = doc('', trailing);
        const fx = fixture(original);
        const rep = harness.enable({ home: fx.home, token: TOKEN, shipped, files: fx.files, now: 1000 });
        assert.ok(!rep[0].error && !rep[0].skipped, JSON.stringify(rep[0]));
        const after = fs.readFileSync(fx.file, 'utf8');
        const j = parseJsonc(after);
        assert.ok(j.mcp.aos && harness.isAosShaped(j.mcp.aos));
        for (const c of comments) assert.ok(after.includes(c), c);
        assert.deepEqual(j.plugin, ['opencode-foo@1.0.0']);
        assert.equal(j.theme, 'dark');
        assert.ok(j.mcp.mine && j.mcp.other);
        assert.equal(baks(fx.file).length, 1);

        harness.enable({ home: fx.home, token: TOKEN, shipped, files: fx.files, now: 2000 });
        assert.equal(fs.readFileSync(fx.file, 'utf8'), after);
        assert.equal(baks(fx.file).length, 1);

        harness.disable({ home: fx.home, files: fx.files, now: 3000 });
        assert.equal(fs.readFileSync(fx.file, 'utf8'), original);
    });
}

test('an AOS duplicate entry leaves with the gateway switch and comes back on disable; comments stay throughout', () => {
    const fx = fixture(doc(ocGithub(), true));
    const rep = harness.enable({ home: fx.home, token: TOKEN, shipped, files: fx.files, now: 1000 });
    assert.ok(!rep[0].error, JSON.stringify(rep[0]));
    let text = fs.readFileSync(fx.file, 'utf8');
    let j = parseJsonc(text);
    assert.equal(j.mcp.github, undefined);
    assert.ok(j.mcp.aos && j.mcp.mine && j.mcp.other);
    for (const c of comments) assert.ok(text.includes(c), c);

    harness.disable({ home: fx.home, files: fx.files, now: 2000 });
    text = fs.readFileSync(fx.file, 'utf8');
    j = parseJsonc(text);
    assert.equal(j.mcp.aos, undefined);
    assert.ok(j.mcp.github && j.mcp.mine && j.mcp.other);
    for (const c of comments) assert.ok(text.includes(c), c);
});

test('a user-owned aos entry is left alone in a commented file', () => {
    const original = doc('    "aos": { "type": "local", "command": ["mine"] },\n', true);
    const fx = fixture(original);
    const rep = harness.enable({ home: fx.home, token: TOKEN, shipped, files: fx.files, now: 1000 });
    assert.ok(rep[0].conflict);
    assert.equal(fs.readFileSync(fx.file, 'utf8'), original);
});

test('patchJsoncMap: creates a missing map, empty map, CRLF and rejects non-objects', () => {
    assert.deepEqual(parseJsonc(patchJsoncMap('{\n  // c\n  "a": 1\n}\n', 'mcp', { x: { u: 1 } })), { a: 1, mcp: { x: { u: 1 } } });
    assert.deepEqual(parseJsonc(patchJsoncMap('{ "mcp": {} }', 'mcp', { x: 1 })), { mcp: { x: 1 } });
    const crlf = patchJsoncMap('{\r\n  // c\r\n  "mcp": {\r\n    "a": 1\r\n  }\r\n}\r\n', 'mcp', { b: { u: 1 } });
    assert.ok(!/[^\r]\n/.test(crlf));
    assert.deepEqual(parseJsonc(crlf).mcp, { a: 1, b: { u: 1 } });
    const tc = patchJsoncMap('{\n  "mcp": {\n    "a": 1 // c\n  }\n}\n', 'mcp', { b: 2 });
    assert.ok(tc.includes('"a": 1, // c'), tc);
    assert.deepEqual(parseJsonc(tc).mcp, { a: 1, b: 2 });
    assert.equal(patchJsoncMap('{"mcp": []}', 'mcp', { x: 1 }), null);
    assert.equal(patchJsoncMap('not json', 'mcp', { x: 1 }), null);
});

test('uninstall removes the recorded memory entries from a commented opencode.jsonc and keeps the rest', () => {
    const mem = '    "memb_mcp": { "type": "local", "command": ["node", "x.mjs"], "enabled": true },\n    "deja": { "type": "local", "command": ["mine-deja"], "enabled": true },\n';
    const fx = fixture(doc(mem, true));
    records.recordMemoryDirect(fx.home, { file: fx.file, kind: 'opencode', root: 'mcp', entries: { memb_mcp: { command: 'node' }, deja: { command: 'deja' } } });
    records.reverseMemoryDirect({ home: fx.home });
    const text = fs.readFileSync(fx.file, 'utf8');
    const j = parseJsonc(text);
    assert.equal(j.mcp.memb_mcp, undefined);
    assert.ok(j.mcp.deja, 'a deja entry running another command is the user\'s');
    assert.ok(j.mcp.mine && j.mcp.other);
    for (const c of comments) assert.ok(text.includes(c), c);
});
