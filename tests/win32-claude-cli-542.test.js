// 5.4.2 Windows: the fleet mod's `claude --version` probe must run the npm claude.cmd shim through cmd.exe.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fleetRun } = require('../lib/v5/packages');
const fleet = require('../lib/v5/pkg-fleet');

const SHIM = 'C:\\Users\\A B\\AppData\\Roaming\\npm\\claude.cmd';
const fakeFs = {
    statSync: (f) => { if (f.toLowerCase() !== SHIM.toLowerCase()) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return { isFile: () => true }; },
    readFileSync: () => '@ECHO off\r\n"%_prog%" "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n',
};
const winOpts = (spawn) => ({
    platform: 'win32',
    env: { Path: 'C:\\Windows;"C:\\Users\\A B\\AppData\\Roaming\\npm"', PATHEXT: '.COM;.EXE;.BAT;.CMD', SystemRoot: 'C:\\Windows' },
    fs: fakeFs,
    spawn,
});

test('win32 fleet runner: claude resolves to claude.cmd and runs through cmd.exe, not a bare spawn', () => {
    const calls = [];
    const spawn = (file, args, opts) => { calls.push({ file, args, opts }); return { status: 0, stdout: '2.1.289 (Claude Code)\n', stderr: '' }; };
    const r = fleetRun('claude', ['--version'], winOpts(spawn));
    assert.equal(r.status, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].file, 'C:\\Windows\\System32\\cmd.exe');
    assert.deepEqual(calls[0].args.slice(0, 3), ['/d', '/s', '/c']);
    assert.match(calls[0].args[3], /claude\.cmd/i);
    assert.match(calls[0].args[3], /--version/);
    assert.equal(calls[0].opts.windowsVerbatimArguments, true);
});

test('win32 fleet detect: reads the Claude Code version through the shim', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-fleet-win-'));
    const seen = [];
    const spawn = (file, args) => { seen.push(args); return { status: 0, stdout: '2.1.289 (Claude Code)\n', stderr: '' }; };
    const ctx = { home, env: {}, run: (cmd, args, o) => fleetRun(cmd, args, { ...winOpts(spawn), ...o }) };
    const row = await fleet.mods[0].detect(ctx);
    assert.equal(row.claudeVersion, '2.1.289');
    assert.equal(row.claude, true);
    assert.equal(seen.length, 1);
});

test('win32 fleet runner: no claude anywhere reports missing, never throws', () => {
    const spawn = () => { throw new Error('spawn must not run when nothing resolves'); };
    const r = fleetRun('claude', ['--version'], { platform: 'win32', env: { PATH: 'C:\\nothing' }, fs: { statSync: () => { throw new Error('ENOENT'); } }, spawn });
    assert.equal(r.missing, true);
});
