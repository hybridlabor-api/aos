'use strict';
// The PATH the gateway hands its upstream MCP servers on Windows must reach a winget-installed uv.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const cfg = require('../lib/gateway/config');

const home = 'C:\\Users\\u';
const nodePath = 'C:\\Program Files\\nodejs\\node.exe';
const winget = path.join(home, 'AppData', 'Local', 'Microsoft', 'WinGet');
const noPackages = () => { throw new Error('ENOENT'); };

test('win32 PATH carries the winget Links folder even when no package folder exists', () => {
    const parts = cfg.defaultPathEnv({ home, nodePath, platform: 'win32', readdir: noPackages }).split(';');
    assert.ok(parts.includes(path.join(winget, 'Links')), parts.join('\n'));
    assert.equal(parts.filter((p) => /Packages/.test(p)).length, 0);
});

test('win32 PATH carries the astral-sh.uv package folder and no other winget package', () => {
    const seen = [];
    const readdir = (d) => { seen.push(d); return ['Git.Git_abc', 'astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe', 'Astral-sh.UV_other']; };
    const parts = cfg.defaultPathEnv({ home, nodePath, platform: 'win32', readdir }).split(';');
    assert.deepEqual(seen, [path.join(winget, 'Packages')]);
    assert.ok(parts.includes(path.join(winget, 'Packages', 'astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe')));
    assert.ok(parts.includes(path.join(winget, 'Packages', 'Astral-sh.UV_other')));
    assert.ok(!parts.some((p) => /Git\.Git/.test(p)));
});

test('a relocated %LOCALAPPDATA% is honoured', () => {
    const parts = cfg.defaultPathEnv({ home, nodePath, platform: 'win32', localAppData: 'D:\\Local', readdir: noPackages }).split(';');
    assert.ok(parts.includes(path.join('D:\\Local', 'Microsoft', 'WinGet', 'Links')));
    assert.ok(!parts.includes(path.join(winget, 'Links')));
});

test('the earlier entries keep their order in front of winget, without duplicates', () => {
    const parts = cfg.defaultPathEnv({ home, nodePath, platform: 'win32', npmBin: path.join(home, 'AppData', 'Roaming', 'npm'), readdir: noPackages }).split(';');
    assert.deepEqual(parts.slice(0, 5), [path.dirname(nodePath), path.join(home, 'AppData', 'Roaming', 'npm'), path.join(home, '.local', 'bin'), path.join(home, '.cargo', 'bin'), path.join(home, 'go', 'bin')]);
    assert.equal(new Set(parts).size, parts.length);
});

test('POSIX PATH is unchanged: no winget entry, no directory read', () => {
    for (const platform of ['linux', 'darwin']) {
        const out = cfg.defaultPathEnv({ home: '/home/u', nodePath: '/n/bin/node', platform, npmBin: '/g/bin', readdir: () => { throw new Error('must not be called'); } });
        assert.ok(!/WinGet/i.test(out), out);
        assert.equal(out.split(':')[0], path.dirname('/n/bin/node'));
    }
});
