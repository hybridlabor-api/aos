const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { movePreserved, recoverStaleSwaps } = require('../installer.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-swap-'));
const put = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

test('S1-1: preserved entries of interrupted swaps come back before the stale dirs go', () => {
    const parent = tmp();
    const target = path.join(parent, 'memB');
    put(path.join(`${target}.incoming-20261010`, '.env'), 'KEY=old-run');
    put(path.join(`${target}.previous-20261011`, 'data', 'store.db'), 'db');
    put(path.join(`${target}.previous-20261011`, '.env'), 'KEY=newest');
    put(path.join(`${target}.previous-20261011`, 'index.js'), 'old code');
    put(path.join(parent, 'other.incoming-1', '.env'), 'untouched');
    recoverStaleSwaps(target);
    assert.equal(fs.readFileSync(path.join(target, '.env'), 'utf8'), 'KEY=newest', 'newest stale dir wins');
    assert.equal(fs.readFileSync(path.join(target, 'data', 'store.db'), 'utf8'), 'db');
    assert.ok(!fs.existsSync(path.join(target, 'index.js')), 'old code is not carried over');
    assert.deepStrictEqual(fs.readdirSync(parent).sort(), ['memB', 'other.incoming-1']);
});

test('movePreserved never overwrites an entry that already exists in the destination', () => {
    const parent = tmp();
    put(path.join(parent, 'a', '.env'), 'from');
    put(path.join(parent, 'a', 'logs', 'x.log'), 'log');
    put(path.join(parent, 'b', '.env'), 'kept');
    movePreserved(path.join(parent, 'a'), path.join(parent, 'b'));
    assert.equal(fs.readFileSync(path.join(parent, 'b', '.env'), 'utf8'), 'kept');
    assert.equal(fs.readFileSync(path.join(parent, 'b', 'logs', 'x.log'), 'utf8'), 'log');
    assert.ok(fs.existsSync(path.join(parent, 'a', '.env')), 'the source copy stays when the destination has one');
});
