import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HOME = mkdtempSync(join(os.tmpdir(), 'hub-inbox-watch-test-'));
const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

import { tickWatches, addWatch, readWatches } from '../lib/hub/inbox.mjs';

test('tickWatches works with string cursors', async () => {
    const fakeRoot = join(HOME, 'fake-root');
    mkdirSync(join(fakeRoot, 'bin'), { recursive: true });

    // Gateway returns string timestamps
    const gwSrc = `
    import fs from 'node:fs';
    const calls = fs.existsSync('gw_calls.json') ? JSON.parse(fs.readFileSync('gw_calls.json', 'utf8')) : 0;
    fs.writeFileSync('gw_calls.json', JSON.stringify(calls + 1));
    if (calls === 0) {
        console.log(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify([{ ts: "2024-01-01", msg: "A" }, { ts: "2024-01-02", msg: "B" }]) }] }));
    } else {
        console.log(JSON.stringify([{ ts: "2024-01-03", msg: "C" }, { ts: "2024-01-01", msg: "old" }]));
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
    process.chdir(fakeRoot);
    process.env.AOS_TEST_SANDBOX = '1';
    await tickWatches(HOME, fakeRoot);
    process.chdir(startCwd);

    let watches = readWatches(HOME);
    assert.equal(watches[0].cursor, "2024-01-02", 'Cursor updated correctly with string');

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
    assert.equal(watches[0].cursor, "2024-01-03", 'Cursor updated correctly with string to higher value');
});

test.after(() => {
    rmSync(HOME, { recursive: true, force: true });
});
