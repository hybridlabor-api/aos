const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const SRC = path.join(REPO, 'skills', 'global_config', 'subagent-setup', 'scripts', 'setup-subagents.mjs');

test('an installed copy outside the repo resolves installer.js via AOS_HOME, or fails with a clear error', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-setup-'));
    try {
        const copy = path.join(dir, 'skills', 'subagent-setup', 'scripts', 'setup-subagents.mjs');
        fs.mkdirSync(path.dirname(copy), { recursive: true });
        fs.copyFileSync(SRC, copy);
        const env = { PATH: process.env.PATH, HOME: dir, USERPROFILE: dir };

        const bad = spawnSync(process.execPath, [copy, '--show'], { cwd: dir, env: { ...env, AOS_HOME: path.join(dir, 'nowhere') }, encoding: 'utf8' });
        assert.equal(bad.status, 2);
        assert.match(bad.stderr, /AOS_HOME/);
        assert.match(bad.stderr, /Tried:/);
        assert.doesNotMatch(bad.stderr, /Cannot find module/);

        const ok = spawnSync(process.execPath, [copy, '--show'], { cwd: dir, env: { ...env, AOS_HOME: REPO }, encoding: 'utf8' });
        assert.equal(ok.status, 0, ok.stderr);
        assert.match(ok.stdout, /Subagent Pipeline/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the repo copy still resolves without AOS_HOME', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-setup-'));
    try {
        const r = spawnSync(process.execPath, [SRC, '--show'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, USERPROFILE: dir }, encoding: 'utf8' });
        assert.equal(r.status, 0, r.stderr);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
