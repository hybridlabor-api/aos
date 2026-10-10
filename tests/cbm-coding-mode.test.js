// Coding-mode preference ("Do you use AOS for coding?"): pure node:test, temp HOME, mocked
// runner and prompt, no network, no shell.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cbm = require('../lib/codebase-memory');
const profile = require('../lib/v5/profile');

const PINNED = 'npm install -g codebase-memory-mcp@0.11.0';

function harness({ stored, flag, interactive, answer = true, binary = false, runOk = true }) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cbm-coding-'));
    if (stored !== undefined) profile.writeSettings(home, { disabled: [], codingMode: stored });
    const calls = { ask: 0, run: [] };
    let present = binary;
    const go = () => cbm.applyCodingMode({
        settings: profile.readSettings(home),
        save: (s) => profile.writeSettings(home, s),
        flag, interactive,
        ask: async () => { calls.ask++; return answer; },
        run: (cmd) => { calls.run.push(cmd); if (runOk) present = true; return runOk; },
        status: () => ({ found: present }),
        step: (m) => { calls.steps = (calls.steps || []).concat(m); },
    });
    return { home, calls, go, stored: () => profile.readSettings(home).codingMode };
}

test('pinned install command constant', () => {
    assert.equal(cbm.CMB_INSTALL_CMD, PINNED);
});

test('parseCodingFlag', () => {
    assert.equal(cbm.parseCodingFlag(['node', 'i.js']), undefined);
    assert.equal(cbm.parseCodingFlag(['--coding']), true);
    assert.equal(cbm.parseCodingFlag(['--no-coding']), false);
});

test('undefined + non-interactive: no prompt, no install, stays undefined', async () => {
    const h = harness({ interactive: false });
    await h.go();
    assert.equal(h.calls.ask, 0);
    assert.deepEqual(h.calls.run, []);
    assert.equal(h.stored(), undefined);
});

test('flag on (non-interactive): runs the pinned install and stores true', async () => {
    const h = harness({ flag: true, interactive: false });
    await h.go();
    assert.deepEqual(h.calls.run, [PINNED]);
    assert.equal(h.calls.ask, 0);
    assert.equal(h.stored(), true);
});

test('stored true + binary present: no install, no prompt', async () => {
    const h = harness({ stored: true, binary: true, interactive: true });
    await h.go();
    assert.deepEqual(h.calls.run, []);
    assert.equal(h.calls.ask, 0);
});

test('stored false: no prompt on update, no install', async () => {
    const h = harness({ stored: false, interactive: true });
    await h.go();
    assert.equal(h.calls.ask, 0);
    assert.deepEqual(h.calls.run, []);
    assert.equal(h.stored(), false);
});

test('undefined + interactive: asks once, stores the answer; second run does not ask', async () => {
    const h = harness({ interactive: true, answer: true });
    await h.go();
    assert.equal(h.calls.ask, 1);
    assert.deepEqual(h.calls.run, [PINNED]);
    assert.equal(h.stored(), true);
    await h.go();
    assert.equal(h.calls.ask, 1);
});

test('interactive no: stored false, nothing installed', async () => {
    const h = harness({ interactive: true, answer: false });
    await h.go();
    assert.equal(h.stored(), false);
    assert.deepEqual(h.calls.run, []);
});

test('a cancelled prompt stores nothing, so the next run asks again', async () => {
    const h = harness({ interactive: true, answer: null }); // the installer maps a cancel to a non-boolean
    await h.go();
    assert.equal(h.stored(), undefined);
    assert.deepEqual(h.calls.run, []);
});

test('--no-coding overrides a stored true and stores false', async () => {
    const h = harness({ stored: true, flag: false, interactive: true });
    await h.go();
    assert.equal(h.stored(), false);
    assert.equal(h.calls.ask, 0);
});

test('the three cases Tim named: TTY asks, no TTY prints how to opt in, answered stays quiet', async () => {
    const tty = harness({ interactive: true, answer: true });
    await tty.go();
    assert.equal(tty.calls.ask, 1);
    const noTty = harness({ interactive: false });
    await noTty.go();
    assert.equal(noTty.calls.ask, 0);
    assert.ok((noTty.calls.steps || []).some((m) => m.includes('--coding')), 'no-TTY run must say how to enable it');
    const answered = harness({ stored: false, interactive: true });
    await answered.go();
    assert.equal(answered.calls.ask, 0);
    assert.ok(!(answered.calls.steps || []).some((m) => m.includes('--coding')));
});

test('install failure warns and does not throw', async () => {
    const h = harness({ flag: true, interactive: false, runOk: false });
    await assert.doesNotReject(h.go());
    assert.equal(h.stored(), true);
});
