const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const installer = require(path.resolve(__dirname, '..', 'installer.js'));

test('installGoCheck installs a2a-permissions.mjs into <home>/.aos/bin, idempotently', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-perm-home-'));
    try {
        assert.equal(installer.installGoCheck({ targetHome: home }), true);
        const bin = path.join(home, '.aos', 'bin');
        const dest = path.join(bin, 'a2a-permissions.mjs');
        assert.ok(fs.existsSync(dest));
        const before = fs.readFileSync(dest, 'utf8');
        const names = fs.readdirSync(bin).sort();
        assert.equal(installer.installGoCheck({ targetHome: home }), true);
        assert.equal(fs.readFileSync(dest, 'utf8'), before);
        assert.deepEqual(fs.readdirSync(bin).sort(), names);
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
    }
});
