const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installBinaryAtomically } = require('../installer.js');

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'aos-bin-'));
}

test('installBinaryAtomically swaps in a new inode with the new content', (t) => {
    const dir = tmpDir();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const src = path.join(dir, 'src');
    const dest = path.join(dir, 'ao');
    fs.writeFileSync(src, 'B');
    fs.writeFileSync(dest, 'A');
    const inodeBefore = fs.statSync(dest).ino;

    installBinaryAtomically(src, dest);

    assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'B');
    if (process.platform !== 'win32') {
        assert.strictEqual(fs.statSync(dest).mode & 0o777, 0o755);
    }
    assert.notStrictEqual(fs.statSync(dest).ino, inodeBefore);
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['ao', 'src']);
});

test('installBinaryAtomically leaves dest untouched when the source is missing', (t) => {
    const dir = tmpDir();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const dest = path.join(dir, 'ao');
    fs.writeFileSync(dest, 'A');

    assert.throws(() => installBinaryAtomically(path.join(dir, 'missing'), dest));

    assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'A');
    assert.deepStrictEqual(fs.readdirSync(dir), ['ao']);
});
