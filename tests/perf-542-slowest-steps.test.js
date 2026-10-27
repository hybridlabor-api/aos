'use strict';
// Tests for slowest steps timing and summary formatting
const test = require('node:test');
const assert = require('node:assert');
const { resetStepTimings, getStepTimings, formatSlowestSteps } = require('../lib/v5/run');

test('slowest steps: format top 3', async (t) => {
    resetStepTimings();

    // Simulate timing collection (normally done by step())
    const timings = [
        { label: 'Skill sync', ms: 41200 },
        { label: 'Gateway npm install', ms: 20100 },
        { label: 'Harnesses', ms: 9800 },
        { label: 'Kernel', ms: 5000 },
        { label: 'Hub', ms: 1200 },
    ];

    // Format should show top 3 sorted by duration
    const formatted = formatSlowestSteps(timings, 3);
    assert.ok(formatted.includes('Skill sync 41.2s'), 'should include top step');
    assert.ok(formatted.includes('Gateway npm install 20.1s'), 'should include 2nd step');
    assert.ok(formatted.includes('Harnesses 9.8s'), 'should include 3rd step');
    assert.ok(!formatted.includes('Kernel'), 'should not include 4th step');
});

test('slowest steps: format with fewer than max steps', async (t) => {
    const timings = [
        { label: 'Step 1', ms: 5000 },
        { label: 'Step 2', ms: 2000 },
    ];

    // Request 5 steps but only 2 available
    const formatted = formatSlowestSteps(timings, 5);
    assert.ok(formatted.includes('Step 1 5.0s'), 'should include step 1');
    assert.ok(formatted.includes('Step 2 2.0s'), 'should include step 2');
});

test('slowest steps: sort by duration descending', async (t) => {
    const timings = [
        { label: 'Fast', ms: 100 },
        { label: 'Slow', ms: 10000 },
        { label: 'Medium', ms: 5000 },
    ];

    const formatted = formatSlowestSteps(timings, 3);
    // Should appear in order: Slow > Medium > Fast
    const slowIdx = formatted.indexOf('Slow');
    const medIdx = formatted.indexOf('Medium');
    const fastIdx = formatted.indexOf('Fast');
    assert.ok(slowIdx < medIdx && medIdx < fastIdx, 'steps should be sorted by duration desc');
});

test('slowest steps: empty list', async (t) => {
    const timings = [];
    const formatted = formatSlowestSteps(timings, 3);
    assert.strictEqual(formatted, '', 'empty list should return empty string');
});

test('slowest steps: single step', async (t) => {
    const timings = [{ label: 'Only Step', ms: 12345 }];
    const formatted = formatSlowestSteps(timings, 1);
    assert.strictEqual(formatted, 'Only Step 12.3s', 'single step should format correctly');
});
