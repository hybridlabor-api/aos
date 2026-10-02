// JSONC handling: the stripper respects strings, and no writer ever rewrites a file it failed to parse.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-jsonc-'));
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const inst = require('../installer.js');

let n = 0;
const file = (text, name = 'opencode.jsonc') => {
  const d = path.join(tmp, `case${n++}`);
  fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, name);
  fs.writeFileSync(f, text);
  return f;
};
const baks = (f) => fs.readdirSync(path.dirname(f)).filter((x) => x.endsWith('.bak'));
const MASTER = { mcpServers: { memb_mcp: { command: 'python', args: ['x.py'] } } };

const USER_CFG = `{
  // my plugins
  "plugin": [
    "file:///Users/x/y.js", /* local */
    "http://registry.example/pkg@1",
    "opencode-foo@1.0.0",
  ],
  "note": "a // not a comment, and /* neither */",
  "esc": "quote \\" // still string",
  "trailing": ",}",
}`;

test('stripJsonc keeps // and /* inside strings, drops real comments and trailing commas, BOM', () => {
  const out = JSON.parse(inst.stripJsonc('﻿' + USER_CFG));
  assert.deepEqual(out.plugin, ['file:///Users/x/y.js', 'http://registry.example/pkg@1', 'opencode-foo@1.0.0']);
  assert.equal(out.note, 'a // not a comment, and /* neither */');
  assert.equal(out.esc, 'quote " // still string');
  assert.equal(out.trailing, ',}');
  assert.deepEqual(JSON.parse(inst.stripJsonc('{"a":[1,2,],/* x */"b":{"c":1,},}')), { a: [1, 2], b: { c: 1 } });
  assert.deepEqual(JSON.parse(inst.stripJsonc('{"a":1 // end\n}')), { a: 1 });
});

test('loadJsonConfig: missing and empty are {}, parse failures and non-objects are invalid, never {}', () => {
  assert.equal(inst.loadJsonConfig(path.join(tmp, 'nope.json')).state, 'missing');
  assert.deepEqual(inst.loadJsonConfig(file('  \n')).data, {});
  assert.equal(inst.loadJsonConfig(file(USER_CFG)).state, 'ok');
  for (const bad of ['{"a": ', '[1,2]', 'null', '{"a":1}}', 'not json']) {
    const r = inst.loadJsonConfig(file(bad));
    assert.equal(r.state, 'invalid', bad);
    assert.equal(r.data, null);
    assert.ok(r.error);
  }
});

test('installOpencodePlugin keeps a file:/// plugin entry and the rest of the config', () => {
  const home = path.join(tmp, 'h1');
  const f = file(USER_CFG);
  inst.installOpencodePlugin({ targetHome: home, configPath: f });
  const after = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.ok(after.plugin.includes('file:///Users/x/y.js'));
  assert.ok(after.plugin.includes('http://registry.example/pkg@1'));
  assert.equal(after.note, 'a // not a comment, and /* neither */');
  assert.equal(baks(f).length, 1, 'a backup is made before the rewrite');
});

test('installOpencodePlugin leaves an unparseable config byte-identical', () => {
  const broken = '{ "plugin": ["file:///Users/x/y.js"  "oops" ] }';
  const f = file(broken);
  const r = inst.installOpencodePlugin({ targetHome: path.join(tmp, 'h2'), configPath: f });
  assert.equal(r, null);
  assert.equal(fs.readFileSync(f, 'utf8'), broken);
  assert.equal(baks(f).length, 0);
});

test('syncOpencodeConfigFile: file:/// survives, invalid file untouched', () => {
  const f = file(USER_CFG);
  inst.syncOpencodeConfigFile(f, MASTER);
  const after = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.ok(after.plugin.includes('file:///Users/x/y.js'));
  assert.ok(after.mcp.memb_mcp);
  assert.equal(baks(f).length, 1);

  const broken = '{"plugin": [ "file:///a.js", }{ ';
  const g = file(broken);
  inst.syncOpencodeConfigFile(g, MASTER);
  assert.equal(fs.readFileSync(g, 'utf8'), broken);
  assert.equal(baks(g).length, 0);
});

test('syncMcpConfigFile: invalid and non-object files untouched, valid merged with backup, unchanged not rewritten', () => {
  for (const bad of ['{"mcpServers": {', '[]']) {
    const f = file(bad, 'mcp.json');
    inst.syncMcpConfigFile(f, MASTER);
    assert.equal(fs.readFileSync(f, 'utf8'), bad);
    assert.equal(baks(f).length, 0);
  }
  const f = file('{ // mine\n "mcpServers": { "own": { "url": "http://localhost:1/x" } },\n}', 'mcp.json');
  inst.syncMcpConfigFile(f, MASTER);
  const merged = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(merged.mcpServers.own.url, 'http://localhost:1/x');
  assert.ok(merged.mcpServers.memb_mcp);
  assert.equal(baks(f).length, 1);
  const stat = fs.statSync(f).mtimeMs;
  inst.syncMcpConfigFile(f, MASTER);
  assert.equal(fs.statSync(f).mtimeMs, stat, 'no semantic change, no rewrite');
  const missing = path.join(tmp, 'fresh', 'mcp.json');
  inst.syncMcpConfigFile(missing, MASTER);
  assert.ok(JSON.parse(fs.readFileSync(missing, 'utf8')).mcpServers.memb_mcp);
});
