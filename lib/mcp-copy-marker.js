'use strict';
// Ownership record for an MCP server folder AOS copied: <folder>/.aos-copy.json lists every copied file with its
// sha256. aos-uninstall removes exactly those files (unchanged ones) and leaves anything else in the folder.
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

const MARKER = '.aos-copy.json';
const SKIP = new Set(['node_modules', '.git', '.venv', '__pycache__', 'dist', MARKER]);
const sha = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// srcDir = the shipped tree (limits the list to copied files); null = record every file now in dir.
function writeMarker(dir, srcDir, version) {
    const files = {};
    const walk = (cur, rel) => {
        for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
            if (SKIP.has(e.name)) continue;
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) { walk(path.join(cur, e.name), r); continue; }
            const copy = path.join(dir, ...r.split('/'));
            if (e.isFile() && fs.existsSync(copy)) files[r] = sha(copy);
        }
    };
    walk(srcDir || dir, '');
    fs.writeFileSync(path.join(dir, MARKER), JSON.stringify({ version: 1, aos: version || null, files }, null, 2) + '\n');
    return Object.keys(files).length;
}

// Install/update builds (npm install, tsc, codegen, uv) write files after the copy. Record the ones this run touched
// (mtime >= since) so uninstall treats them as AOS's; older unrecorded files are the user's and stay unrecorded.
function refreshMarker(dir, since, version) {
    const old = readMarker(dir);
    if (!old) return 0;
    const files = { ...old.files };
    const walk = (cur, rel) => {
        for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
            if (SKIP.has(e.name)) continue;
            const r = rel ? `${rel}/${e.name}` : e.name;
            const f = path.join(cur, e.name);
            if (e.isDirectory()) { walk(f, r); continue; }
            if (e.isFile() && fs.statSync(f).mtimeMs >= since) files[r] = sha(f);
        }
    };
    walk(dir, '');
    fs.writeFileSync(path.join(dir, MARKER), JSON.stringify({ ...old, aos: version || old.aos, files }, null, 2) + '\n');
    return Object.keys(files).length;
}

function readMarker(dir) {
    try { const j = JSON.parse(fs.readFileSync(path.join(dir, MARKER), 'utf8')); return j && j.files && typeof j.files === 'object' ? j : null; } catch { return null; }
}

module.exports = { MARKER, writeMarker, refreshMarker, readMarker, sha };
