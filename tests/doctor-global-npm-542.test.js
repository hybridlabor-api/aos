const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const RUNNING = require('../package.json').version;

function globalRow(version) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-doctor-gnpm-'));
    try {
        const root = path.join(home, 'npmroot');
        fs.mkdirSync(path.join(root, '@hybridlabor-api', 'aos'), { recursive: true });
        fs.writeFileSync(path.join(root, '@hybridlabor-api', 'aos', 'package.json'), JSON.stringify({ version }));
        fs.mkdirSync(path.join(home, 'fakebin'));
        fs.writeFileSync(path.join(home, 'fakebin', 'npm'), `#!/bin/sh\necho ${root}\n`, { mode: 0o755 });
        const r = spawnSync(process.execPath, [path.join(REPO, 'bin', 'aos-doctor.mjs'), '--json'], {
            encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, PATH: `${path.join(home, 'fakebin')}:/usr/bin:/bin` },
        });
        return JSON.parse(r.stdout).results.find((x) => x.name === 'Global npm install');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

test('doctor: a global npm install at the running version is fine (the normal `npm i -g` path)', { skip: process.platform === 'win32' }, () => {
    const row = globalRow(RUNNING);
    assert.strictEqual(row.ok, true);
    assert.match(row.detail, /matches the running version/);
});

test('doctor: a global copy of a different version is still flagged, with the removal command', { skip: process.platform === 'win32' }, () => {
    const row = globalRow('0.0.1');
    assert.strictEqual(row.ok, false);
    assert.match(row.fix, /npm uninstall -g @hybridlabor-api\/aos/);
});
