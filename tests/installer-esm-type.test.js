const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

test('installer writes {"type": "commonjs"} when home has {"type": "module"}', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-home-'));
    fs.writeFileSync(path.join(home, 'package.json'), JSON.stringify({ type: "module" }));
    const root = path.resolve(__dirname, '..');

    const result = spawnSync(process.execPath, [path.join(root, 'installer.js'), '-y'], { env: { ...process.env, HOME: home } });
    // ignoring exit code since installer may fail on unrelated things without internet/proper setup

    const targetFile = path.join(home, '.agents', 'package.json');
    assert.ok(fs.existsSync(targetFile));
    const content = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
    assert.deepStrictEqual(content, { type: "commonjs" });

    // Verify require works for lib/gateway/config.js inside the copied tree
    const reqResult = spawnSync(process.execPath, ['-e', `require('${path.join(home, '.agents', 'lib', 'gateway', 'config.js')}')`], { env: { ...process.env, HOME: home } });
    assert.strictEqual(reqResult.status, 0, reqResult.stderr.toString());
});
