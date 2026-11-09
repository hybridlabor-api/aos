const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'bin', 'aos-uninstall.mjs')).href);
const mkHome = () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-ow-skill-'));
    const dir = path.join(home, '.agents', 'skills', 'openwiki-skill');
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), 'x');
    fs.writeFileSync(path.join(dir, 'scripts', 'openwiki_daemon.py'), 'x');
    return { home, dir };
};

test('win32: the task is ended and deleted and the daemon process stopped before the skill dir goes', async () => {
    const { removeOpenWikiSkill } = await load();
    const { home, dir } = mkHome();
    const calls = [];
    const r = removeOpenWikiSkill({ home, platform: 'win32', run: (cmd, args) => { calls.push([cmd, args.join(' ')]); assert.ok(fs.existsSync(dir), 'dir still there while stopping'); } });
    assert.deepEqual(calls.slice(0, 2).map((c) => c[1]), ['/End /TN BDB_OpenWiki_Daemon', '/Delete /TN BDB_OpenWiki_Daemon /F']);
    assert.equal(calls[2][0], 'powershell');
    assert.match(calls[2][1].toLowerCase(), /openwiki_daemon\.py/);
    assert.ok(r.removed && r.stoppedDaemon);
    assert.ok(!fs.existsSync(dir));
});

test('a failing schtasks (no such task) does not stop the removal', async () => {
    const { removeOpenWikiSkill } = await load();
    const { home, dir } = mkHome();
    const r = removeOpenWikiSkill({ home, platform: 'win32', run: () => { throw new Error('ERROR: not found'); } });
    assert.ok(r.removed);
    assert.ok(!fs.existsSync(dir));
});

test('non-Windows: no process tools are called, the dir is removed', async () => {
    const { removeOpenWikiSkill } = await load();
    const { home, dir } = mkHome();
    const r = removeOpenWikiSkill({ home, platform: 'linux', run: () => { throw new Error('must not run'); } });
    assert.ok(r.removed);
    assert.ok(!fs.existsSync(dir));
});

test('a locked file is reported, not thrown', async () => {
    const { removeOpenWikiSkill } = await load();
    const { home } = mkHome();
    const r = removeOpenWikiSkill({ home, platform: 'linux', rm: () => { throw new Error('EPERM'); } });
    assert.equal(r.removed, false);
    assert.equal(r.error, 'EPERM');
});

test('a missing dir is a no-op', async () => {
    const { removeOpenWikiSkill } = await load();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-ow-skill-'));
    assert.equal(removeOpenWikiSkill({ home, platform: 'linux' }).removed, false);
});
