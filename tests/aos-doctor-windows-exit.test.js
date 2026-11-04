const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');

test('doctor exits cleanly without using process.exit() which causes UV_HANDLE_CLOSING on Windows', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-doc-winexit-'));
    try {
        const script = path.join(REPO, 'bin', 'aos-doctor.mjs');
        // Only verify process.exit(...) is not at the end of the file/handling end results
        const content = fs.readFileSync(script, 'utf8');
        assert.ok(!/process\.exit\(hasCriticalFails \? 1 : 0\)/.test(content), `Found process.exit at the end of ${script}`);

        const r = spawnSync(process.execPath, [script, '--json'], {
            cwd: home,
            env: { HOME: home, USERPROFILE: home, PATH: process.env.PATH },
            encoding: 'utf8'
        });

        assert.ok(r.status === 0 || r.status === 1, `Doctor exited with code ${r.status}`);
        assert.ok(!r.stderr.includes('Assertion failed'), 'Stderr must not contain libuv assertion failures');
    } finally {
        fs.rmSync(home, { recursive: true, force: true });
    }
});
