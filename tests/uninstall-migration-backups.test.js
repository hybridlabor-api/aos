const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const sandbox = () => { const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-migration-backups-')); fs.mkdirSync(path.join(home, 'empty-bin')); return home; };
const env = (home) => ({ HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), PATH: path.join(home, 'empty-bin'), AOS_PLUGIN_CLI: 'off' });
const write = (p, text = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const uninstall = (home, ...flags) => spawnSync(process.execPath, [path.join(REPO, 'bin', 'aos-uninstall.mjs'), ...flags], { cwd: home, env: env(home), encoding: 'utf8' });

test('uninstall deletes the AOS plugin-migration backup tree and the restore index, nothing else', () => {
    const home = sandbox();
    try {
        const j = (...p) => path.join(home, ...p);
        const backup = j('.agents', 'backups', 'plugin-migration-test-1');
        write(path.join(backup, 'a', 'SKILL.md'), 'backed up');
        write(j('.agents', '.bdb-plugin-migration.json'), JSON.stringify({ registered: {}, backups: [backup] }));
        write(j('.agents', 'backups', 'plugin-x', 'f'));
        write(j('notes.txt'), 'user file');
        write(j('.agents', '.bdb-install-manifest.json'), '{}');

        const r = uninstall(home, '--yes');
        assert.strictEqual(r.status, 0, r.stderr + r.stdout);
        assert.ok(!fs.existsSync(backup), 'plugin-migration backup tree is deleted');
        assert.ok(!fs.existsSync(j('.agents', '.bdb-plugin-migration.json')), 'restore index is deleted');
        assert.ok(fs.existsSync(j('.agents', 'backups', 'plugin-x', 'f')), 'a backup dir AOS did not create stays');
        assert.ok(fs.existsSync(j('notes.txt')), 'user file stays');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
