const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const { aosDistTag, localBinPathHint } = require('../installer.js');
const ur = require('../lib/uninstall-records.js');
const SANDBOX_SKIP = process.env.AOS_TEST_SANDBOX !== 'container' && 'needs AOS_TEST_SANDBOX=container (runs installer entry points)';

test('aosDistTag maps a version to the channel it was published under', () => {
    assert.strictEqual(aosDistTag('5.0.0-beta.3'), 'beta');
    assert.strictEqual(aosDistTag('5.1.0-rc.1'), 'rc');
    assert.strictEqual(aosDistTag('5.0.0'), 'latest');
});

test('localBinPathHint is silent when ~/.local/bin is on PATH and names the right fix per OS', () => {
    const bin = '/home/u/.local/bin';
    assert.strictEqual(localBinPathHint(bin, { pathEnv: `/usr/bin:${bin}/`, platform: 'linux', shell: '/bin/bash' }), null);
    assert.match(localBinPathHint(bin, { pathEnv: '/usr/bin', platform: 'linux', shell: '/bin/bash' }), /export PATH="\$HOME\/\.local\/bin:\$PATH"' >> ~\/\.bashrc/);
    assert.match(localBinPathHint(bin, { pathEnv: '/usr/bin', platform: 'darwin', shell: '' }), />> ~\/\.zshrc/);
    assert.match(localBinPathHint(bin, { pathEnv: '/usr/bin', platform: 'linux', shell: '/usr/bin/fish' }), /fish_add_path/);
    const win = 'C:\\Users\\u\\.local\\bin';
    assert.strictEqual(localBinPathHint(win, { pathEnv: 'C:\\Windows;c:/users/u/.local/bin/', platform: 'win32' }), null);
    assert.match(localBinPathHint(win, { pathEnv: 'C:\\Windows', platform: 'win32' }), /SetEnvironmentVariable\('Path'.*'User'\)/);
});

test('installGlobalBinaries wires aos, aos-hub, aos-gogate, aos-sessions, aos-trail; uninstall removes them', { skip: SANDBOX_SKIP }, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-launch-'));
    try {
        const trail = path.join(home, '.agents', 'skills', 'agenttrail', 'bin', 'agenttrail.mjs');
        fs.mkdirSync(path.dirname(trail), { recursive: true });
        fs.writeFileSync(trail, '');
        const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(REPO, 'installer.js'))}).installGlobalBinaries()`],
            { cwd: home, env: { HOME: home, USERPROFILE: home, PATH: '/usr/bin:/bin', AOS_PLUGIN_CLI: 'off' }, encoding: 'utf8' });
        assert.strictEqual(r.status, 0, r.stderr);
        assert.match(r.stdout + r.stderr, /\.local\/bin is not on your PATH/);

        const bin = path.join(home, '.local', 'bin');
        const read = (n) => fs.readFileSync(path.join(bin, n), 'utf8');
        for (const n of ['aos-hub', 'aos-gogate', 'aos-sessions', 'aos-gate', 'aos-gateway']) assert.match(read(n), new RegExp(`\\.agents/bin/${n}\\.mjs`));
        assert.ok(read('aos-trail').includes(trail));
        const tag = aosDistTag(require('../package.json').version);
        assert.strictEqual(read('aos'), `#!/bin/sh\n# aos-launcher\nexec npx -y @hybridlabor-api/aos@${tag} "$@"\n`);

        // The Windows twins as the installer writes them on win32.
        fs.writeFileSync(path.join(bin, 'aos.cmd'), `@echo off\r\nrem # aos-launcher\r\nnpx -y @hybridlabor-api/aos@${tag} %*\r\n`);
        fs.writeFileSync(path.join(bin, 'aos-hub.ps1'), `# aos-launcher\r\nnode "${path.join(home, '.agents', 'bin', 'aos-hub.mjs')}" $args\r\n`);
        fs.writeFileSync(path.join(bin, 'aos.ps1'), 'Write-Host mine\r\n');

        const lines = ur.reverseRegistrations({ home, dryRun: false });
        assert.ok(lines.some((l) => l.startsWith('Launchers removed from')), lines.join('\n'));
        for (const n of ['aos', 'aos.cmd', 'aos-hub', 'aos-hub.ps1', 'aos-gogate', 'aos-sessions', 'aos-trail']) assert.ok(!fs.existsSync(path.join(bin, n)), `${n} removed`);
        assert.ok(fs.existsSync(path.join(bin, 'aos.ps1')), 'a foreign aos.ps1 stays');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('installGlobalBinaries leaves a foreign ~/.local/bin/aos alone', { skip: SANDBOX_SKIP }, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-launch-'));
    try {
        const own = path.join(home, '.local', 'bin', 'aos');
        fs.mkdirSync(path.dirname(own), { recursive: true });
        fs.writeFileSync(own, '#!/bin/sh\necho other tool\n');
        const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(REPO, 'installer.js'))}).installGlobalBinaries()`],
            { cwd: home, env: { HOME: home, USERPROFILE: home, PATH: `/usr/bin:/bin:${path.dirname(own)}`, AOS_PLUGIN_CLI: 'off' }, encoding: 'utf8' });
        assert.strictEqual(r.status, 0, r.stderr);
        assert.doesNotMatch(r.stdout + r.stderr, /not on your PATH/);
        assert.strictEqual(fs.readFileSync(own, 'utf8'), '#!/bin/sh\necho other tool\n');
        ur.reverseRegistrations({ home, dryRun: false });
        assert.ok(fs.existsSync(own), 'uninstall keeps it too');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
