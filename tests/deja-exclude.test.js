const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { ensureDejaExclude } = require('../installer.js');

describe('ensureDejaExclude', () => {
    let tmpCounter = 0;
    const tempExcludeFile = () => {
        // The parent directory does not exist yet -- ensureDejaExclude must create it.
        const dir = path.join(os.tmpdir(), `aos-deja-exclude-${process.pid}-${++tmpCounter}`);
        fs.mkdirSync(dir, { recursive: true });
        return path.join(dir, 'exclude');
    };
    const cleanup = (file) => {
        const tmp = path.dirname(file);
        if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
    };

    test('appends secret to a missing file', () => {
        const file = tempExcludeFile();
        try {
            assert.equal(ensureDejaExclude(file), true);
            assert.equal(fs.readFileSync(file, 'utf8'), 'secret\n');
        } finally { cleanup(file); }
    });

    test('appends secret to an empty file', () => {
        const file = tempExcludeFile();
        try {
            fs.writeFileSync(file, '', 'utf8');
            assert.equal(ensureDejaExclude(file), true);
            assert.equal(fs.readFileSync(file, 'utf8'), 'secret\n');
        } finally { cleanup(file); }
    });

    test('second call does not duplicate', () => {
        const file = tempExcludeFile();
        try {
            assert.equal(ensureDejaExclude(file), true);
            assert.equal(ensureDejaExclude(file), false);
            assert.equal(fs.readFileSync(file, 'utf8'), 'secret\n');
        } finally { cleanup(file); }
    });

    test('user lines are kept verbatim', () => {
        const file = tempExcludeFile();
        try {
            fs.writeFileSync(file, 'my-project\nwork-stuff\n', 'utf8');
            assert.equal(ensureDejaExclude(file), true);
            assert.equal(fs.readFileSync(file, 'utf8'), 'my-project\nwork-stuff\nsecret\n');
        } finally { cleanup(file); }
    });

    test('a # secret comment line does not count as present', () => {
        const file = tempExcludeFile();
        try {
            fs.writeFileSync(file, '# secret\n', 'utf8');
            assert.equal(ensureDejaExclude(file), true);
            assert.equal(fs.readFileSync(file, 'utf8'), '# secret\nsecret\n');
        } finally { cleanup(file); }
    });

    test('a file without trailing newline gets a newline before secret', () => {
        const file = tempExcludeFile();
        try {
            fs.writeFileSync(file, 'my-project', 'utf8');
            assert.equal(ensureDejaExclude(file), true);
            assert.equal(fs.readFileSync(file, 'utf8'), 'my-project\nsecret\n');
        } finally { cleanup(file); }
    });
});
