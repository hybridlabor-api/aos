'use strict';
// Go links the `go version -m` text between these two 16-byte markers, so the
// revision of a binary can be read from its bytes: no Go toolchain needed, and
// the binary (possibly the live daemon) is never executed.
const fs = require('fs');

const GO_BUILDINFO_START = Buffer.from('3077af0c9274080241e1c107e6d618e6', 'hex');
const GO_BUILDINFO_END = Buffer.from('f932433186182072008242104116d8f2', 'hex');

function readGoBuildInfo(binPath) {
    let buf;
    try { buf = fs.readFileSync(binPath); } catch { return null; }
    const start = buf.indexOf(GO_BUILDINFO_START);
    const end = start < 0 ? -1 : buf.indexOf(GO_BUILDINFO_END, start);
    return end < 0 ? null : parseGoBuildInfo(buf.subarray(start + GO_BUILDINFO_START.length, end).toString('utf8'));
}

// Accepts the embedded text or `go version -m` output (same lines, tab-indented).
function parseGoBuildInfo(text) {
    const get = (key) => (String(text).match(new RegExp(`^\\s*build\\s+${key}=(\\S*)`, 'm')) || [])[1];
    const revision = get('vcs\\.revision');
    if (!revision) return null;
    return { revision, time: get('vcs\\.time') || null, modified: get('vcs\\.modified') === 'true' };
}

module.exports = { GO_BUILDINFO_START, GO_BUILDINFO_END, readGoBuildInfo, parseGoBuildInfo };
