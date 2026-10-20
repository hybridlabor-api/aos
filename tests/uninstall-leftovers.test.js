const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'bin', 'aos-uninstall.mjs')).href);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-leftovers-'));
const touch = (...p) => { fs.mkdirSync(path.dirname(path.join(...p)), { recursive: true }); fs.writeFileSync(path.join(...p), 'x'); };

const marker = require('../lib/mcp-copy-marker.js');

test('a recorded MCP copy goes, changed and unrecorded files stay and are reported', async () => {
    const { removeGeneratedMcpTrees } = await load();
    const home = tmp();
    const root = path.join(home, 'Library', 'Application Support', 'Claude', 'mcps');
    const dir = path.join(root, 'tdmcp');
    touch(dir, 'index.js');
    touch(dir, 'lib', 'a.js');
    touch(dir, 'node_modules', 'b.js');
    marker.writeMarker(dir, null, '1');
    fs.writeFileSync(path.join(dir, 'lib', 'a.js'), 'edited');
    touch(dir, 'notes.txt');
    touch(root, 'my-own-mcp', 'node_modules', 'keep.js');
    const r = removeGeneratedMcpTrees({ home, names: ['tdmcp', 'my-own-mcp'] });
    assert.equal(r.kept.length, 1);
    assert.match(r.hints[0], /2 changed or unrecorded/);
    assert.ok(!fs.existsSync(path.join(dir, 'index.js')) && !fs.existsSync(path.join(dir, 'node_modules')));
    assert.ok(fs.existsSync(path.join(dir, 'lib', 'a.js')) && fs.existsSync(path.join(dir, 'notes.txt')));
    assert.ok(!fs.existsSync(path.join(dir, marker.MARKER)));
    assert.ok(fs.existsSync(path.join(root, 'my-own-mcp', 'node_modules', 'keep.js')));
});

test('a fully recorded, unchanged copy is removed whole and the empty mcps dir goes', async () => {
    const { removeGeneratedMcpTrees } = await load();
    const home = tmp();
    const dir = path.join(home, '.config', 'Claude', 'mcps', 'x');
    touch(dir, 'a.js');
    touch(dir, '.venv', 'bin', 'python');
    marker.writeMarker(dir, null, '1');
    const dry = removeGeneratedMcpTrees({ home, names: ['x'], dry: true });
    assert.deepEqual(dry.removed, [dir]);
    assert.ok(fs.existsSync(path.join(dir, 'a.js')), 'dry run deletes nothing');
    removeGeneratedMcpTrees({ home, names: ['x'] });
    assert.ok(!fs.existsSync(path.join(home, '.config', 'Claude', 'mcps')));
});

test('nested __pycache__ trees inside a recorded copy go with it; outside a record they stay', async () => {
    const { removeGeneratedMcpTrees } = await load();
    const home = tmp();
    const root = path.join(home, 'Library', 'Application Support', 'Claude', 'mcps');
    const dir = path.join(root, 'memb-mcp');
    touch(dir, 'run.py');
    touch(dir, 'memb', 'client', 'main.py');
    marker.writeMarker(dir, null, '1');
    touch(dir, 'memb', 'client', '__pycache__', 'main.cpython-311.pyc');
    touch(dir, 'memb', '__pycache__', 'x.pyc');
    touch(root, 'tdmcp', 'sub', '__pycache__', 'keep.pyc');
    const r = removeGeneratedMcpTrees({ home, names: ['memb-mcp', 'tdmcp'] });
    assert.ok(!fs.existsSync(dir), 'copy removed whole');
    assert.deepEqual(r.kept, [path.join(root, 'tdmcp')]);
    assert.ok(fs.existsSync(path.join(root, 'tdmcp', 'sub', '__pycache__', 'keep.pyc')));
});

test('a legacy copy without a record is kept with a hint', async () => {
    const { removeGeneratedMcpTrees } = await load();
    const home = tmp();
    const dir = path.join(home, '.config', 'Claude', 'mcps', 'x');
    touch(dir, 'node_modules', 'a.js');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"x"}');
    const r = removeGeneratedMcpTrees({ home, names: ['x'] });
    assert.deepEqual(r.removed, []);
    assert.deepEqual(r.kept, [dir]);
    assert.match(r.hints[0], /aos update/);
    assert.ok(fs.existsSync(path.join(dir, 'node_modules', 'a.js')));
});

test('removeClaudePointer removes the exact installer pointer, strips only its prefix line, leaves user files', async () => {
    const { removeClaudePointer } = await load();
    const inst = require('../installer.js');
    const home = tmp();
    const f = path.join(home, 'CLAUDE.md');

    fs.writeFileSync(f, inst.CLAUDE_POINTER);
    assert.equal(removeClaudePointer(f), 'removed');
    assert.ok(!fs.existsSync(f));

    fs.writeFileSync(f, `${inst.CLAUDE_PREFIX}# My rules\n`);
    assert.equal(removeClaudePointer(f), 'stripped');
    assert.ok(fs.readdirSync(home).some((n) => n.startsWith('CLAUDE.md.') && n.endsWith('.bak')), 'backup written first');
    assert.equal(fs.readFileSync(f, 'utf8'), '# My rules\n');

    fs.writeFileSync(f, '# My rules\nSee AGENTS.md\n');
    assert.equal(removeClaudePointer(f), null);
    assert.equal(fs.readFileSync(f, 'utf8'), '# My rules\nSee AGENTS.md\n');
});
