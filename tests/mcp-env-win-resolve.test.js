'use strict';
// aos-mcp-env on Windows: npx/uv resolve through the entry's own env via cli-spawn (mocked fs/env), no shell:true.
const { test } = require('node:test');
const assert = require('node:assert');
const cliSpawn = require('../lib/cli-spawn.js');

const files = new Set(['C:\\node\\npx.cmd', 'C:\\Users\\t\\.local\\bin\\uv.exe']);
const fsImpl = {
    statSync: (f) => { if (![...files].some((x) => x.toLowerCase() === f.toLowerCase())) throw new Error('ENOENT'); return { isFile: () => true }; },
    accessSync: () => {}, readFileSync: () => '@echo off\r\n"%~dp0node" %*',
};

test('npx resolves to npx.cmd via the entry PATH (key spelled "Path") and runs through cmd.exe /d /s /c', () => {
    const env = { Path: 'C:\\node;C:\\other', PATHEXT: '.COM;.EXE;.BAT;.CMD', SystemRoot: 'C:\\Windows' };
    const file = cliSpawn.resolveCommand('npx', { platform: 'win32', env, fs: fsImpl });
    assert.match(file, /^C:\\node\\npx\.cmd$/i);
    const inv = cliSpawn.buildInvocation(file, ['-y', '@modelcontextprotocol/server-github@2025.4.8'], { platform: 'win32', env, fs: fsImpl });
    assert.match(inv.file, /cmd\.exe$/i);
    assert.deepStrictEqual(inv.args.slice(0, 3), ['/d', '/s', '/c']);
});

test('uv resolves to uv.exe from a quoted PATH entry', () => {
    const env = { PATH: '"C:\\Users\\t\\.local\\bin"', PATHEXT: '.EXE;.CMD' };
    assert.match(cliSpawn.resolveCommand('uv', { platform: 'win32', env, fs: fsImpl }), /uv\.exe$/i);
});

test('uv is found in ~/.local/bin even when PATH misses it', () => {
    const env = { PATH: 'C:\\nothing', USERPROFILE: 'C:\\Users\\t' };
    assert.match(cliSpawn.resolveCommand('uv', { platform: 'win32', env, fs: fsImpl }), /uv\.exe$/i);
});

test('the launcher exits 127 with ENOENT when nothing resolves, and copies cli-spawn next to itself in the installer list', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'installer.js'), 'utf8');
    assert.match(src, /'cli-spawn\.js'/);
    assert.match(src, /'win-bin\.js'/);
    assert.strictEqual(cliSpawn.resolveCommand('nope', { platform: 'win32', env: { PATH: 'C:\\node' }, fs: fsImpl }), null);
});
