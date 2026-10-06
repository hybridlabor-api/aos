'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PINNED = /^(@[\w.-]+\/)?[\w.-]+@\d+\.\d+\.\d+$/;

// First non-flag argument after `npx` is the package spec.
const pkgOf = (args) => args.find((a) => !String(a).startsWith('-'));

test('mcp_config.json: every npx server pins <pkg>@x.y.z', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'mcp_config.json'), 'utf8'));
  const npx = Object.entries(cfg.mcpServers).filter(([, v]) => v.command === 'npx');
  assert.ok(npx.length > 0, 'expected npx servers in mcp_config.json');
  for (const [name, v] of npx) {
    assert.match(pkgOf(v.args), PINNED, `${name}: ${JSON.stringify(v.args)}`);
  }
});

test('installer.js and lib/: no unpinned npx MCP definitions', () => {
  const files = ['installer.js', ...fs.readdirSync(path.join(ROOT, 'lib')).filter((f) => f.endsWith('.js')).map((f) => 'lib/' + f)];
  const re = /(?:command\s*:\s*|\[\s*)['"]npx['"]\s*,?([^\]}\n]*)/g;
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(re)) {
      const args = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
      const pkg = pkgOf(args);
      if (pkg === undefined) continue; // command only, args defined elsewhere
      assert.match(pkg, PINNED, `${f}: ${m[0].trim()}`);
    }
  }
});

test('pinned scanner rejects unpinned and accepts pinned specs', () => {
  assert.ok(PINNED.test('@scope/pkg@1.2.3'));
  assert.ok(PINNED.test('pkg@0.16.1'));
  for (const bad of ['pkg', 'pkg@latest', '@scope/pkg', 'pkg@1.2', 'pkg@^1.2.3']) assert.ok(!PINNED.test(bad), bad);
});
