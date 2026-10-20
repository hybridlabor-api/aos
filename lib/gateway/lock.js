'use strict';
// One O_EXCL lockfile per gateway dir around every read-modify-write of migration.json, adopted.json and the harness
// files AOS rewrites, so two aos-gateway processes (update + adopt, two terminals) cannot lose each other's update.
// A lock older than staleMs is taken over (its owner crashed). Harness processes cannot be locked: writeAtomic
// re-reads the target right before the rename and aborts that file when it changed.
const fs = require('fs');
const path = require('path');

const LOCK = '.rmw.lock';
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function withLock(dir, fn, { staleMs = 60000, waitMs = 20000 } = {}) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, LOCK);
    const deadline = Date.now() + waitMs;
    for (;;) {
        try {
            const fd = fs.openSync(file, 'wx', 0o600);
            try { fs.writeSync(fd, String(process.pid)); } finally { fs.closeSync(fd); }
            break;
        } catch (e) {
            if (e.code !== 'EEXIST') throw e;
            try { if (Date.now() - fs.statSync(file).mtimeMs > staleMs) { fs.unlinkSync(file); continue; } } catch { continue; }
            if (Date.now() > deadline) throw new Error(`${file} is held by another aos-gateway process; nothing was changed, retry in a moment`);
            sleep(100);
        }
    }
    try { return fn(); } finally { try { fs.unlinkSync(file); } catch { /* already gone */ } }
}

module.exports = { withLock, LOCK };
