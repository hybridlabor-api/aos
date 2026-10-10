'use strict';
// Real installRustauri against a throwaway HOME, in a child process so installer.js
// reads that HOME at load. Container-only like the other installer tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

test('installRustauri copies both skills into ~/.agents/skills of a temp HOME', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-rustauri-'));
    const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, AOS_TEST_SANDBOX: process.env.AOS_TEST_SANDBOX };
    const script = `const i = require(${JSON.stringify(path.join(ROOT, 'installer.js'))}); process.stdout.write('RESULT:' + String(i.installRustauri()));`;
    const r = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /RESULT:true$/);
    for (const skill of ['tauri-pilot', 'rust-pro']) {
        const file = path.join(home, '.agents', 'skills', skill, 'SKILL.md');
        assert.ok(fs.existsSync(file) && fs.statSync(file).size > 0, `${skill} missing under temp HOME`);
    }
    // The temp dir is deliberately never deleted (rules forbid recursive deletes).
});
