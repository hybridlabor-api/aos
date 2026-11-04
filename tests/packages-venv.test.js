const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { venvPython } = require('../lib/v5/packages.js');

describe('venv path resolution', () => {
    test('posix vs win32 resolution (absolute path, Windows-style path with spaces)', () => {
        const dirPosix = '/var/lib/my project';
        const posixPath = venvPython(dirPosix, 'linux');
        assert.ok(posixPath.includes('/var/lib/my project/.venv/bin/python'));

        const dirWin32 = 'C:\\Program Files\\my project';
        const win32Path = venvPython(dirWin32, 'win32');
        assert.ok(win32Path.includes(path.join('C:\\Program Files\\my project', '.venv', 'Scripts', 'python.exe')));
    });
});
