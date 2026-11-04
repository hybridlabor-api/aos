const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

describe('installer uv sync', () => {
    test('install does not change shipped uv.lock', () => {
        const installerSrc = fs.readFileSync(path.join(__dirname, '..', 'installer.js'), 'utf8');
        assert.ok(installerSrc.includes("['sync', '--frozen']"));
    });
});
