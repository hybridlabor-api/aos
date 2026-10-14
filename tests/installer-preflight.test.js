'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const { checkSystemPrereqs } = require(path.join(REPO, 'installer.js'));

describe('checkSystemPrereqs (installer preflight)', () => {
    test('missing git on macOS throws with brew instructions', () => {
        const errors = [];
        const logger = { error: (msg) => errors.push(msg), warn: () => {} };

        assert.throws(
            () => checkSystemPrereqs({
                which: () => false,
                platform: 'darwin',
                logger,
                exitOnError: true,
            }),
            /brew install git \/ xcode-select --install/
        );
        assert.equal(process.exitCode, 1);
        process.exitCode = 0;

        assert.equal(errors.length, 1);
        assert.match(errors[0], /brew install git \/ xcode-select --install/);
    });

    test('missing git on Windows throws with winget and git-scm instructions', () => {
        const errors = [];
        const logger = { error: (msg) => errors.push(msg), warn: () => {} };

        assert.throws(
            () => checkSystemPrereqs({
                which: () => false,
                platform: 'win32',
                logger,
                exitOnError: true,
            }),
            /git-scm\.com or winget install Git\.Git/
        );
        assert.equal(process.exitCode, 1);
        process.exitCode = 0;

        assert.equal(errors.length, 1);
        assert.match(errors[0], /git-scm\.com or winget install Git\.Git/);
    });

    test('missing git on Linux throws with package manager instructions', () => {
        const errors = [];
        const logger = { error: (msg) => errors.push(msg), warn: () => {} };

        assert.throws(
            () => checkSystemPrereqs({
                which: () => false,
                platform: 'linux',
                logger,
                exitOnError: true,
            }),
            /apt install git \/ dnf install git/
        );
        assert.equal(process.exitCode, 1);
        process.exitCode = 0;

        assert.equal(errors.length, 1);
        assert.match(errors[0], /apt install git \/ dnf install git/);
    });

    test('missing git with exitOnError=false returns error object without throwing', () => {
        const errors = [];
        const logger = { error: (msg) => errors.push(msg), warn: () => {} };

        const res = checkSystemPrereqs({
            which: (bin) => bin === 'gh',
            platform: 'darwin',
            logger,
            exitOnError: false,
        });

        assert.equal(res.ok, false);
        assert.equal(res.missing, 'git');
        assert.match(res.instruction, /brew install git/);
        assert.equal(errors.length, 1);
    });

    test('missing gh on macOS warns with brew gh instructions but does not fail', () => {
        const warnings = [];
        const errors = [];
        const logger = { error: (msg) => errors.push(msg), warn: (msg) => warnings.push(msg) };

        const res = checkSystemPrereqs({
            which: (bin) => bin === 'git',
            platform: 'darwin',
            logger,
            exitOnError: true,
        });

        assert.equal(res.ok, true);
        assert.equal(res.git, true);
        assert.equal(res.gh, false);
        assert.equal(errors.length, 0);
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /brew install gh/);
    });

    test('missing gh on Windows warns with winget instructions', () => {
        const warnings = [];
        const logger = { error: () => {}, warn: (msg) => warnings.push(msg) };

        const res = checkSystemPrereqs({
            which: (bin) => bin === 'git',
            platform: 'win32',
            logger,
            exitOnError: true,
        });

        assert.equal(res.ok, true);
        assert.equal(res.git, true);
        assert.equal(res.gh, false);
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /winget install GitHub\.cli/);
    });

    test('both git and gh present succeeds with no warnings or errors', () => {
        const warnings = [];
        const errors = [];
        const logger = { error: (msg) => errors.push(msg), warn: (msg) => warnings.push(msg) };

        const res = checkSystemPrereqs({
            which: () => true,
            platform: 'darwin',
            logger,
            exitOnError: true,
        });

        assert.equal(res.ok, true);
        assert.equal(res.git, true);
        assert.equal(res.gh, true);
        assert.equal(errors.length, 0);
        assert.equal(warnings.length, 0);
    });
});
