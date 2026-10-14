const { test } = require('node:test');
const assert = require('node:assert');
const { renameWithRetry, takeLockedReason } = require('../lib/rename-retry.js');

const fail = (code) => Object.assign(new Error(code), { code });

test('retries EBUSY twice with doubling backoff, then succeeds', () => {
    let calls = 0; const sleeps = [];
    const rename = () => { if (++calls <= 2) throw fail('EBUSY'); };
    renameWithRetry('a', 'b', { module: 'synapse', rename, sleep: (ms) => sleeps.push(ms) });
    assert.strictEqual(calls, 3);
    assert.deepStrictEqual(sleeps, [200, 400]);
});

test('persistent EPERM yields the clear locked-module message', () => {
    let calls = 0;
    assert.throws(
        () => renameWithRetry('a', 'b', { module: 'memB', rename: () => { calls++; throw fail('EPERM'); }, sleep: () => {} }),
        (e) => e.locked && /locked by a running service; stop the memB service or end its process and run the update again/.test(e.message),
    );
    assert.strictEqual(calls, 5);
    assert.match(takeLockedReason(), /stop the memB service/);
    assert.strictEqual(takeLockedReason(), null);
});

test('other errors are rethrown immediately', () => {
    let calls = 0;
    assert.throws(() => renameWithRetry('a', 'b', { rename: () => { calls++; throw fail('ENOENT'); }, sleep: () => {} }), { code: 'ENOENT' });
    assert.strictEqual(calls, 1);
});

test('a swallowed lock failure does not leak into the next call', () => {
    assert.throws(() => renameWithRetry('a', 'b', { module: 'x', rename: () => { throw fail('EBUSY'); }, sleep: () => {} }));
    renameWithRetry('a', 'b', { module: 'x', rename: () => {}, sleep: () => {} });
    assert.strictEqual(takeLockedReason(), null);
});

test('release runs once after the backoff and a truthy result gives the rename a fresh backoff', () => {
    let calls = 0, released = 0, locked = true;
    const rename = () => { calls++; if (locked) throw fail('EPERM'); };
    renameWithRetry('a', 'b', { module: 'memB', rename, sleep: () => {}, release: () => { released++; locked = false; return true; } });
    assert.strictEqual(released, 1);
    assert.strictEqual(calls, 6);
});

test('release that frees nothing still ends in the locked message, after one call', () => {
    let calls = 0, released = 0;
    assert.throws(
        () => renameWithRetry('a', 'b', { module: 'memB', rename: () => { calls++; throw fail('EBUSY'); }, sleep: () => {}, release: () => { released++; return false; } }),
        (e) => e.locked && /stop the memB service/.test(e.message),
    );
    assert.strictEqual(released, 1);
    assert.strictEqual(calls, 5);
    takeLockedReason();
});

test('release that frees the directory only once cannot loop forever', () => {
    let calls = 0, released = 0;
    assert.throws(
        () => renameWithRetry('a', 'b', { module: 'memB', rename: () => { calls++; throw fail('EPERM'); }, sleep: () => {}, release: () => { released++; return true; } }),
        (e) => e.locked,
    );
    assert.strictEqual(released, 1);
    assert.strictEqual(calls, 10);
    takeLockedReason();
});

test('persistent EACCES is retried but reported as a permission error', () => {
    let calls = 0;
    assert.throws(
        () => renameWithRetry('a', '/mods/memB', { module: 'memB', rename: () => { calls++; throw fail('EACCES'); }, sleep: () => {} }),
        (e) => e.locked && /permission denied while replacing the module directory \/mods\/memB; close programs using it or check permissions/.test(e.message) && !/running service/.test(e.message),
    );
    assert.strictEqual(calls, 5);
    takeLockedReason();
});
