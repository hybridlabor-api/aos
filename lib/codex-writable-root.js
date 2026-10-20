'use strict';
// Codex's workspace-write sandbox cannot write the A2A reply file (#174). Only the reply directory
// (<home>/.aos/a2a-inbox, where `aos-a2a reply` writes) is added to [sandbox_workspace_write].writable_roots;
// never ~/.aos itself (go-gate grants and secrets live there). Pure text in, text out: the caller backs up and writes.
const path = require('path');

const replyRoot = (home) => path.join(home, '.aos', 'a2a-inbox');
const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const tomlStr = (p) => JSON.stringify(p);
const TOKEN = /"(?:[^"\\]|\\.)*"|'[^']*'/g;
const unquote = (t) => (t[0] === '"' ? JSON.parse(t) : t.slice(1, -1));
const HEADER = /^\s*\[sandbox_workspace_write\]\s*(#.*)?$/;
const ARRAY = /^(\s*writable_roots\s*=\s*)\[(.*)\](\s*(#.*)?)$/;

function locate(lines) {
    const start = lines.findIndex((l) => HEADER.test(l));
    if (start < 0) return null;
    let end = lines.findIndex((l, i) => i > start && /^\s*\[/.test(l));
    if (end < 0) end = lines.length;
    return { start, end, key: lines.findIndex((l, i) => i > start && i < end && /^\s*writable_roots\s*=/.test(l)) };
}

// Single-line arrays of plain strings only: anything else is the user's and is left untouched.
function parseArray(line) {
    const m = ARRAY.exec(line);
    if (!m) return null;
    const tokens = m[2].match(TOKEN) || [];
    if (m[2].replace(TOKEN, '').replace(/[\s,]/g, '')) return null;
    try { return { pre: m[1], post: m[3], tokens, values: tokens.map(unquote) }; } catch { return null; }
}

function ensureWritableRoot(text, dir) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const loc = locate(lines);
    if (!loc) {
        if (/^\s*(sandbox_workspace_write\s*[.=]|\[sandbox_workspace_write\.)/m.test(text)) return { text, changed: false, note: 'sandbox_workspace_write is declared in a form this installer does not edit' };
        const body = text.replace(/\s+$/, '');
        return { text: `${body}${body ? eol + eol : ''}[sandbox_workspace_write]${eol}writable_roots = [${tomlStr(dir)}]${eol}`, changed: true };
    }
    if (loc.key < 0) {
        lines.splice(loc.start + 1, 0, `writable_roots = [${tomlStr(dir)}]`);
        return { text: lines.join(eol), changed: true };
    }
    const arr = parseArray(lines[loc.key]);
    if (!arr) return { text, changed: false, note: 'writable_roots has a form this installer does not edit' };
    if (arr.values.some((v) => norm(v) === norm(dir))) return { text, changed: false };
    lines[loc.key] = `${arr.pre}[${[...arr.tokens, tomlStr(dir)].join(', ')}]${arr.post}`;
    return { text: lines.join(eol), changed: true };
}

function removeWritableRoot(text, dir) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const loc = locate(lines);
    if (!loc || loc.key < 0) return { text, changed: false };
    const arr = parseArray(lines[loc.key]);
    if (!arr || !arr.values.some((v) => norm(v) === norm(dir))) return { text, changed: false };
    const left = arr.tokens.filter((t, i) => norm(arr.values[i]) !== norm(dir));
    if (left.length) lines[loc.key] = `${arr.pre}[${left.join(', ')}]${arr.post}`;
    else lines.splice(loc.key, 1);
    const end = loc.end - (left.length ? 0 : 1);
    const empty = !left.length && lines.slice(loc.start + 1, end).every((l) => /^\s*(#.*)?$/.test(l));
    if (empty) lines.splice(loc.start, end - loc.start);
    return { text: lines.join(eol), changed: true };
}

module.exports = { replyRoot, ensureWritableRoot, removeWritableRoot };
