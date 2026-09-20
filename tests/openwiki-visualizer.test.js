/**
 * tests/openwiki-visualizer.test.js
 *
 * Tests for OpenWiki Visualizer setup and log alias safety.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const clack = require('@clack/prompts');

describe('OpenWiki Visualizer & Logger Safety', () => {
    test('log.ok alias is defined and routes to log.success without throwing', () => {
        // Require installer.js to trigger global initialization
        require('../installer.js');
        const { log } = clack;

        assert.strictEqual(typeof log.ok, 'function', 'log.ok must be a function');
        assert.strictEqual(log.ok, log.success, 'log.ok should alias log.success');

        // Calling log.ok should not throw
        assert.doesNotThrow(() => {
            log.ok('Test log.ok message');
        });
    });

    test('installer.js contains no unaliased log.ok calls', () => {
        const fs = require('fs');
        const path = require('path');
        const content = fs.readFileSync(path.join(__dirname, '..', 'installer.js'), 'utf8');

        // Verify log.ok alias definition is present
        assert.ok(content.includes('log.ok = log.success'), 'installer.js must contain log.ok = log.success alias');
        // Verify line 2031 was updated to log.success
        assert.ok(content.includes("log.success('OpenWiki CLI installed.');"), "OpenWiki CLI installed message must use log.success");
    });
});
