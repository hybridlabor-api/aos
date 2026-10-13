'use strict';

const fs = require('fs');
const path = require('path');

// One .bak per file per process: several writers touch the same file in one install run, and a
// backup per writer piled up thousands of .bak files. The first backup holds the pre-run state.
const done = new Map();

const backupOf = (file) => done.get(path.resolve(file)) || null;

// copyFn makes the backup and returns its path; a throw leaves the file unmarked so the caller's
// "backup failed -> do not write" path still applies. Returns the new backup path, or null when this
// process already holds one for the file (a backup that has since vanished is made again).
function backupOnce(file, copyFn) {
    const key = path.resolve(file);
    const prev = done.get(key);
    if (prev && fs.existsSync(prev)) return null;
    const out = copyFn();
    done.set(key, out);
    return out;
}

module.exports = { backupOnce, backupOf };
