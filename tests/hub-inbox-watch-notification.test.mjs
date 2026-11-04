import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HOME = mkdtempSync(join(os.tmpdir(), 'hub-inbox-watch-notif-test-'));
const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

import { tickWatches, addWatch, readWatches } from '../lib/hub/inbox.mjs';

test('tickWatches calls desktop notification fallback when a2a is offline', async () => {
    const fakeRoot = join(HOME, 'fake-root');
    mkdirSync(join(fakeRoot, 'bin'), { recursive: true });

    // Gateway returns items
    const gwSrc = `
    console.log(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify([{ ts: 1, msg: "A" }]) }] }));
    `;
    writeFileSync(join(fakeRoot, 'bin', 'aos-gateway.mjs'), gwSrc);

    // Fake a2a says NO peers are alive
    const a2aSrc = `
    console.log(JSON.stringify([]));
    `;
    writeFileSync(join(fakeRoot, 'bin', 'aos-a2a.mjs'), a2aSrc);

    // Mock notify-send/osascript/powershell to check if it's called
    const fakeBin = join(HOME, 'fake-bin');
    mkdirSync(fakeBin, { recursive: true });
    const fakeNotif = `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
appendFileSync(join('${fakeRoot}', 'notif_calls.log'), process.argv.slice(2).join(' ') + '\\n');
`;
    writeFileSync(join(fakeBin, 'notify-send'), fakeNotif);
    chmodSync(join(fakeBin, 'notify-send'), 0o755);
    writeFileSync(join(fakeBin, 'osascript'), fakeNotif);
    chmodSync(join(fakeBin, 'osascript'), 0o755);
    writeFileSync(join(fakeBin, 'powershell'), fakeNotif);
    chmodSync(join(fakeBin, 'powershell'), 0o755);

    addWatch(HOME, { id: 'w1', upstream: 'test_mcp', readTool: 'get_msgs', cursorField: 'ts', deliverTo: 'offline_peer' });

    // First tick with modified PATH
    const startCwd = process.cwd();
    process.chdir(fakeRoot);
    const startPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${startPath}`;

    await tickWatches(HOME, fakeRoot);

    process.env.PATH = startPath;
    process.chdir(startCwd);

    let watches = readWatches(HOME);
    assert.equal(watches[0].cursor, 1, 'Cursor updated');

    // Verify notification tool got called
    const notifs = readFileSync(join(fakeRoot, 'notif_calls.log'), 'utf8');
    assert.ok(notifs.includes('New message via test_mcp'), 'Notification fallback called');
});

test.after(() => {
    rmSync(HOME, { recursive: true, force: true });
});
