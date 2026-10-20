const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'bin', 'aos-uninstall.mjs')).href);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-leftovers-'));
const touch = (...p) => { fs.mkdirSync(path.dirname(path.join(...p)), { recursive: true }); fs.writeFileSync(path.join(...p), 'x'); };

test('removeGeneratedMcpTrees removes AOS copies of shipped servers whole and keeps other servers', async () => {
    const { removeGeneratedMcpTrees } = await load();
    const home = tmp();
    const roots = [path.join(home, 'Library', 'Application Support', 'Claude', 'mcps'), path.join(home, '.gemini', 'config', 'mcps')];
    for (const root of roots) {
        touch(root, 'blender-mcp', 'node_modules', 'a', 'f.js');
        touch(root, 'blender-mcp', 'dist', 'index.js');
        touch(root, 'memb-mcp', '.venv', 'bin', 'python');
        touch(root, 'my-own-mcp', 'node_modules', 'keep.js');
    }
    touch(roots[0], 'tdmcp', 'node_modules', 'b.js');
    touch(roots[0], 'tdmcp', 'notes.txt');

    const owned = [];
    for (const root of roots) for (const n of ['blender-mcp', 'memb-mcp']) owned.push(path.join(root, n, 'server.js'));
    owned.push(path.join(roots[0], 'tdmcp', 'index.js'));
    const { removed: gone, kept } = removeGeneratedMcpTrees({ home, names: ['blender-mcp', 'tdmcp'], owned });
    assert.equal(gone.length, 5);
    assert.deepEqual(kept, []);
    for (const root of roots) {
        assert.ok(!fs.existsSync(path.join(root, 'blender-mcp')), 'emptied server dir is pruned');
        assert.ok(!fs.existsSync(path.join(root, 'memb-mcp')));
        assert.ok(fs.existsSync(path.join(root, 'my-own-mcp', 'node_modules', 'keep.js')), 'non-shipped server untouched');
    }
    assert.ok(!fs.existsSync(path.join(roots[0], 'tdmcp')), 'recognised AOS copy goes whole');
});

test('removeGeneratedMcpTrees drops the mcps dir once nothing is left and is a no-op without one', async () => {
    const { removeGeneratedMcpTrees } = await load();
    const home = tmp();
    assert.deepEqual(removeGeneratedMcpTrees({ home, names: ['x'] }).removed, []);
    touch(home, '.config', 'Claude', 'mcps', 'x', 'dist', 'a.js');
    removeGeneratedMcpTrees({ home, names: ['x'], owned: [path.join(home, '.config', 'Claude', 'mcps', 'x', 'a.js')] });
    assert.ok(!fs.existsSync(path.join(home, '.config', 'Claude', 'mcps')));
    assert.ok(fs.existsSync(path.join(home, '.config', 'Claude')));
});

test('a shipped-name folder that is not an AOS copy keeps its build folders and is reported', async () => {
    const { removeGeneratedMcpTrees } = await load();
    const home = tmp();
    const dir = path.join(home, '.config', 'Claude', 'mcps', 'x');
    touch(dir, 'node_modules', 'a.js');
    touch(dir, 'package.json');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"someone-elses-x"}');
    const r = removeGeneratedMcpTrees({ home, names: ['x'] });
    assert.deepEqual(r.removed, []);
    assert.deepEqual(r.kept, [dir]);
    assert.ok(fs.existsSync(path.join(dir, 'node_modules', 'a.js')));
});

test('dry run lists the trees and deletes nothing', async () => {
    const { removeGeneratedMcpTrees } = await load();
    const home = tmp();
    touch(home, '.config', 'Claude', 'mcps', 'x', 'node_modules', 'a.js');
    const owned = [path.join(home, '.config', 'Claude', 'mcps', 'x', 'a.js')];
    assert.equal(removeGeneratedMcpTrees({ home, names: ['x'], dry: true, owned }).removed.length, 1);
    assert.ok(fs.existsSync(path.join(home, '.config', 'Claude', 'mcps', 'x', 'node_modules', 'a.js')));
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
