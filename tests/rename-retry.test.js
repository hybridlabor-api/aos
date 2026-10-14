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
        (e) => e.locked && /locked by a running service; stop memB \(aos-memB stop or end its process\) and run the update again/.test(e.message),
    );
    assert.strictEqual(calls, 5);
    assert.match(takeLockedReason(), /stop memB/);
    assert.strictEqual(takeLockedReason(), null);
});

test('other errors are rethrown immediately', () => {
    let calls = 0;
    assert.throws(() => renameWithRetry('a', 'b', { rename: () => { calls++; throw fail('ENOENT'); }, sleep: () => {} }), { code: 'ENOENT' });
    assert.strictEqual(calls, 1);
});
