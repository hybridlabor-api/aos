import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HOME = mkdtempSync(join(os.tmpdir(), 'hub-inbox-watch-test-'));
const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

import { tickWatches, addWatch, readWatches, removeWatch } from '../lib/hub/inbox.mjs';

test('inbox watch persistence and add/remove', () => {
    const watch = addWatch(HOME, { upstream: 'test', readTool: 'read', cursorField: 'ts' });
    assert.ok(watch.id, 'Watch gets an ID');
    let watches = readWatches(HOME);
    assert.equal(watches.length, 1);
    assert.equal(watches[0].id, watch.id);

    removeWatch(HOME, watch.id);
    watches = readWatches(HOME);
    assert.equal(watches.length, 0);
});

test('tickWatches calls gateway, compares cursor, delivers items, and updates cursor', async () => {
    // Setup a mock bin/aos-gateway.mjs and bin/aos-a2a.mjs in a fake root
    const fakeRoot = join(HOME, 'fake-root');
    mkdirSync(join(fakeRoot, 'bin'), { recursive: true });

    // Fake gateway returns 2 items on first run, 1 new item on second
    const gwSrc = `
    import fs from 'node:fs';
    const calls = fs.existsSync('gw_calls.json') ? JSON.parse(fs.readFileSync('gw_calls.json', 'utf8')) : 0;
    fs.writeFileSync('gw_calls.json', JSON.stringify(calls + 1));
    if (calls === 0) {
        console.log(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify([{ ts: 1, msg: "A" }, { ts: 2, msg: "B" }]) }] }));
    } else {
        console.log(JSON.stringify([{ ts: 3, msg: "C" }, { ts: 1, msg: "old" }]));
    }
    `;
    writeFileSync(join(fakeRoot, 'bin', 'aos-gateway.mjs'), gwSrc);

    // Fake a2a says peer 'live_peer' is alive, and accepts sends
    const a2aSrc = `
    const args = process.argv.slice(2);
    import fs from 'node:fs';
    import path from 'node:path';
    const logPath = path.join('${fakeRoot}', 'a2a_sends.log');
    if (args[0] === 'list') {
       console.log(JSON.stringify([{ name: 'live_peer' }]));
    } else if (args[0] === 'send') {
       fs.appendFileSync(logPath, args.join(' ') + '\\n');
    }
    `;
    writeFileSync(join(fakeRoot, 'bin', 'aos-a2a.mjs'), a2aSrc);

    addWatch(HOME, { id: 'w1', upstream: 'test_mcp', readTool: 'get_msgs', cursorField: 'ts', deliverTo: 'live_peer' });

    // First tick
    const startCwd = process.cwd();
    process.chdir(fakeRoot); // To keep gw_calls.json there
    process.env.AOS_TEST_SANDBOX = '1';
    await tickWatches(HOME, fakeRoot);
    process.chdir(startCwd);

    let watches = readWatches(HOME);
    assert.equal(watches[0].cursor, 2, 'Cursor updated to 2');

    // Verify a2a got the sends
    let sends = "";
    try { sends = readFileSync(join(fakeRoot, 'a2a_sends.log'), 'utf8'); } catch (e) {}
    assert.ok(sends.includes('{"ts":1,"msg":"A"}'), 'send 1');
    assert.ok(sends.includes('{"ts":2,"msg":"B"}'), 'send 2');

    // Log file appended
    const inboxLog = readFileSync(join(HOME, '.aos', 'hub', 'inbox.log'), 'utf8');
    assert.ok(inboxLog.includes('length'), 'Inbox log was written');

    // Second tick
    const startCwd2 = process.cwd();
    process.chdir(fakeRoot);
    process.env.AOS_TEST_SANDBOX = '1';
    // simulate time passing to bypass interval
    const watchesBefore = readWatches(HOME);
    watchesBefore[0].lastTick = Date.now() - 300000;
    const { writeWatches } = await import('../lib/hub/inbox.mjs');
    writeWatches(HOME, watchesBefore);
    await tickWatches(HOME, fakeRoot);
    process.chdir(startCwd2);
    watches = readWatches(HOME);
    assert.equal(watches[0].cursor, 3, 'Cursor updated to 3');
});

test.after(() => {
    rmSync(HOME, { recursive: true, force: true });
});
