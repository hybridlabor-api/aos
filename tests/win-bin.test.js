'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { winBin, psQuote } = require('../lib/win-bin.js');

test('winBin: absolute System32 paths on win32, names untouched elsewhere', () => {
    const env = { SystemRoot: 'D:\\Win' };
    assert.equal(winBin('powershell.exe', { platform: 'win32', env }), 'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.equal(winBin('powershell', { platform: 'win32', env: {} }), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.equal(winBin('taskkill', { platform: 'win32', env }), 'D:\\Win\\System32\\taskkill.exe');
    assert.equal(winBin('schtasks', { platform: 'win32', env }), 'schtasks');
    assert.equal(winBin('powershell.exe', { platform: 'darwin' }), 'powershell.exe');
});

test('psQuote doubles ASCII and typographic single quotes', () => {
    assert.equal(psQuote("a'b\u2018c\u2019d\u201Ae\u201Bf"), "a''b\u2018\u2018c\u2019\u2019d\u201A\u201Ae\u201B\u201Bf");
});
