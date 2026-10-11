const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { backupOnce, backupOf } = require('../lib/backup-once.js');
const fleet = require('../lib/v5/pkg-fleet.js');
const records = require('../lib/uninstall-records.js');

const mkHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-bak-once-'));

test('backupOnce copies a file only the first time, per resolved path', () => {
    const dir = mkHome();
    const file = path.join(dir, 'a.json');
    fs.writeFileSync(file, '{}');
    let calls = 0;
    const copy = () => { calls++; fs.copyFileSync(file, `${file}.bak`); return `${file}.bak`; };
    assert.equal(backupOnce(file, copy), `${file}.bak`);
    assert.equal(backupOnce(path.join(dir, '.', 'a.json'), copy), null);
    assert.equal(calls, 1);
    assert.equal(backupOf(file), `${file}.bak`);
    const other = path.join(dir, 'b.json');
    assert.equal(backupOnce(other, () => `${other}.bak`), `${other}.bak`, 'other files keep their own backup');
});

test('a backup that vanished is made again', () => {
    const file = path.join(mkHome(), 'd.json');
    fs.writeFileSync(file, '{}');
    const copy = () => { fs.copyFileSync(file, `${file}.bak`); return `${file}.bak`; };
    backupOnce(file, copy);
    fs.unlinkSync(`${file}.bak`);
    assert.equal(backupOnce(file, copy), `${file}.bak`);
});

test('a failed backup is not remembered and still throws', () => {
    const file = path.join(mkHome(), 'c.json');
    assert.throws(() => backupOnce(file, () => { throw new Error('disk full'); }), /disk full/);
    assert.equal(backupOnce(file, () => 'ok'), 'ok');
});

test('two writers changing the same settings.json in one process leave exactly one .bak', async () => {
    const home = mkHome();
    const dir = path.join(home, '.claude');
    const settingsPath = path.join(dir, 'settings.json');
    fs.mkdirSync(dir, { recursive: true });
    const original = JSON.stringify({ model: 'opus' });
    fs.writeFileSync(settingsPath, original);

    const r = await fleet.install({ home, claudeBin: 'claude', dryRun: false, env: {}, run: async () => ({ status: 0, stdout: '2.1.300 (Claude Code)\n' }) });
    assert.equal(r.changed, true);
    assert.deepEqual(records.addClaudeDeny({ home, settingsPath, rules: ['Bash(rm -rf /:*)'] }), ['Bash(rm -rf /:*)']);

    const baks = fs.readdirSync(dir).filter((f) => f.endsWith('.bak'));
    assert.equal(baks.length, 1, baks.join(', '));
    assert.equal(fs.readFileSync(path.join(dir, baks[0]), 'utf8'), original, 'the one backup holds the pre-run state');
    assert.ok(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).permissions.deny.includes('Bash(rm -rf /:*)'));
});
