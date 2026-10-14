'use strict';
// Rename with backoff for Windows, where a running service holds the directory (EPERM/EBUSY/EACCES).
const fs = require('fs');

const LOCK_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
let lastLockedReason = null;

function renameWithRetry(from, to, { module, rename = fs.renameSync, sleep = sleepSync, tries = 5, delayMs = 200 } = {}) {
    lastLockedReason = null;
    for (let attempt = 1; ; attempt++) {
        try { return rename(from, to); } catch (e) {
            if (!LOCK_CODES.has(e.code)) throw e;
            if (attempt >= tries) {
                lastLockedReason = e.code === 'EACCES'
                    ? `permission denied while replacing the module directory ${to}; close programs using it or check permissions`
                    : `module directory is locked by a running service; stop the ${module} service or end its process and run the update again`;
                const err = new Error(lastLockedReason);
                err.code = e.code;
                err.locked = true;
                throw err;
            }
            sleep(delayMs * 2 ** (attempt - 1));
        }
    }
}

// Reason of the last locked-module failure, once: lets a step report it instead of a generic message.
const takeLockedReason = () => { const r = lastLockedReason; lastLockedReason = null; return r; };

module.exports = { renameWithRetry, takeLockedReason };
