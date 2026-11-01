const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseNpx, pinNpx, missingSpecs, pkgDirOf } = require('../lib/gateway/npx-pin');
const { buildUpstreams } = require('../lib/gateway/config');

const GH = { command: 'npx', args: ['-y', 'github/github-mcp-server@2.0.3'] };
const OD = { command: 'npx', args: ['-y', 'nexu-io/open-design', '/x/open-design'] };

function install(pkgDir, name, version, bin) {
    const root = path.join(pkgDir, 'node_modules', ...name.split('/'));
    fs.mkdirSync(path.dirname(path.join(root, bin)), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name, version, bin: { x: bin } }));
    fs.writeFileSync(path.join(root, bin), '');
    return path.join(root, bin);
}

test('parseNpx accepts only exact pinned specs and keeps trailing args', () => {
    assert.deepEqual(parseNpx(OD), { name: 'nexu-io/open-design', version: '', rest: ['/x/open-design'] });
    assert.equal(parseNpx({ command: 'npx', args: ['-y', 'foo@latest'] }), null);
    assert.equal(parseNpx({ command: 'npx', args: ['-y', 'foo'] }), null);
    assert.equal(parseNpx({ command: 'node', args: ['a.js'] }), null);
});

test('pinNpx swaps in node <entry> only when that exact version is installed', () => {
    const pkgDir = pkgDirOf(fs.mkdtempSync(path.join(os.tmpdir(), 'npxpin-')));
    assert.deepEqual(pinNpx(GH, pkgDir), GH);
    assert.deepEqual(missingSpecs({ github: GH, od: OD }, pkgDir).sort(), ['github/github-mcp-server@2.0.3', 'nexu-io/open-design']);
    const entry = install(pkgDir, 'nexu-io/open-design', '', 'dist/cli.js');
    assert.deepEqual(pinNpx(OD, pkgDir), { command: 'node', args: [entry, '/x/open-design'] });
    install(pkgDir, 'github/github-mcp-server', '2025.4.7', 'index.js');
    assert.deepEqual(pinNpx(GH, pkgDir), GH, 'a different installed version is not used');
});

test('buildUpstreams starts a pinned package directly, without npx', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'npxpin-home-'));
    const pkgDir = pkgDirOf(path.join(home, 'gw'));
    const entry = install(pkgDir, 'github/github-mcp-server', '2.0.3', 'dist/index.js');
    const up = buildUpstreams({ shipped: { github: GH }, home, launcher: '/l/aos-mcp-env.mjs', pathEnv: '/bin', adopted: {}, pkgDir });
    const flat = [up.github.command, ...up.github.args].join(' ');
    assert.ok(flat.includes(entry), flat);
    assert.ok(!/\bnpx\b/.test(flat), flat);
});
