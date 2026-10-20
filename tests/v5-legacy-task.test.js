'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { legacyTask } = require('../lib/v5/svc.js');

const mk = (exists) => {
    const calls = [];
    return { calls, ctx: { home: '/h', serviceRunner: (bin, args) => { calls.push([bin, ...args]); return { status: 0 }; }, taskExists: async (n) => { calls.push(['exists', n]); return exists; } } };
};

test('absent legacy task: only the query runs, schtasks /End and /Delete are never called', async () => {
    const { ctx, calls } = mk(false);
    assert.equal(await legacyTask(ctx, 'AOS_Hub', ['/End', '/TN', 'AOS_Hub']), null);
    assert.deepEqual(calls, [['exists', 'AOS_Hub']]);
});

test('present legacy task: the real command runs after the query', async () => {
    const { ctx, calls } = mk(true);
    assert.equal(await legacyTask(ctx, 'AOS_Hub', ['/Delete', '/TN', 'AOS_Hub', '/F']), null);
    assert.deepEqual(calls, [['exists', 'AOS_Hub'], ['schtasks', '/Delete', '/TN', 'AOS_Hub', '/F']]);
});

test('without a seam, a serviceRunner context keeps the plain call', async () => {
    const calls = [];
    const ctx = { home: '/h', serviceRunner: (bin, args) => { calls.push([bin, ...args]); return { status: 0 }; } };
    await legacyTask(ctx, 'T', ['/Delete', '/TN', 'T', '/F']);
    assert.deepEqual(calls, [['schtasks', '/Delete', '/TN', 'T', '/F']]);
});
