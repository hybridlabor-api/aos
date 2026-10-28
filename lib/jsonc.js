'use strict';
// JSONC helpers shared by the installer, the doctor and the uninstaller.

// Comment and trailing-comma stripper that respects string literals and escapes, so
// "file:///x.js" and "http://host" survive. A BOM is dropped. Returns text JSON.parse can read (or reject).
function stripJsonc(text) {
    const src = String(text).replace(/^﻿/, '');
    let out = '';
    for (let i = 0; i < src.length;) {
        const c = src[i];
        if (c === '"') {
            let j = i + 1;
            while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
            out += src.slice(i, j + 1);
            i = j + 1;
        } else if (c === '/' && src[i + 1] === '/') {
            while (i < src.length && src[i] !== '\n' && src[i] !== '\r') i++;
        } else if (c === '/' && src[i + 1] === '*') {
            const end = src.indexOf('*/', i + 2);
            i = end < 0 ? src.length : end + 2;
            out += ' ';
        } else { out += c; i++; }
    }
    let res = '';
    for (let i = 0; i < out.length;) {
        const c = out[i];
        if (c === '"') {
            let j = i + 1;
            while (j < out.length && out[j] !== '"') j += out[j] === '\\' ? 2 : 1;
            res += out.slice(i, j + 1);
            i = j + 1;
        } else if (c === ',') {
            let k = i + 1;
            while (k < out.length && /\s/.test(out[k])) k++;
            if (out[k] !== '}' && out[k] !== ']') res += c;
            i++;
        } else { res += c; i++; }
    }
    return res;
}

// Parsed value, or null when the text is not valid JSON(C).
function parseJsonc(text) {
    try { return JSON.parse(stripJsonc(text)); } catch { return null; }
}

// Tokens (strings, punctuation, bare words) with offsets; whitespace and comments are skipped.
function tokenize(src) {
    const toks = [];
    for (let i = 0; i < src.length;) {
        const c = src[i];
        if (/\s/.test(c) || c === '﻿') i++;
        else if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; }
        else if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; }
        else if (c === '"') {
            let j = i + 1;
            while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
            toks.push({ t: 's', s: i, e: j + 1 });
            i = j + 1;
        } else if ('{}[],:'.includes(c)) { toks.push({ t: c, s: i, e: i + 1 }); i++; }
        else { let j = i; while (j < src.length && !/[\s{}\[\],:"\/]/.test(src[j])) j++; toks.push({ t: 'w', s: i, e: Math.max(j, i + 1) }); i = Math.max(j, i + 1); }
    }
    return toks;
}

// Removes the entries of the top-level array `key` for which `shouldRemove(value)` is true, as a textual
// edit: comments, formatting and every other byte stay. Returns the new text, or null when the edit
// could not be done safely (the caller then falls back to a rewrite). The result is re-parsed and checked.
function removeJsoncArrayEntries(src, key, shouldRemove) {
    const toks = tokenize(src);
    let depth = 0;
    let open = -1;
    for (let i = 0; i < toks.length; i++) {
        const k = toks[i];
        if (k.t === '{' || k.t === '[') depth++;
        else if (k.t === '}' || k.t === ']') depth--;
        else if (depth === 1 && k.t === 's' && toks[i + 1] && toks[i + 1].t === ':' && toks[i + 2] && toks[i + 2].t === '[') {
            let v; try { v = JSON.parse(src.slice(k.s, k.e)); } catch { return null; }
            if (v === key) { open = i + 2; break; }
        }
    }
    if (open < 0) return null;
    const elems = []; // { first, last, comma } token indexes
    let d = 0;
    let cur = null;
    let close = -1;
    for (let i = open + 1; i < toks.length; i++) {
        const k = toks[i];
        if (d === 0 && k.t === ']') { close = i; break; }
        if (d === 0 && k.t === ',') { if (cur) { cur.comma = i; elems.push(cur); cur = null; } continue; }
        if (!cur) cur = { first: i, last: i, comma: -1 };
        cur.last = i;
        if (k.t === '{' || k.t === '[') d++;
        else if (k.t === '}' || k.t === ']') d--;
    }
    if (close < 0) return null;
    if (cur) elems.push(cur);
    const ranges = [];
    elems.forEach((el, idx) => {
        let v; try { v = JSON.parse(stripJsonc(src.slice(toks[el.first].s, toks[el.last].e))); } catch { return; }
        if (!shouldRemove(v)) return;
        let s = toks[el.first].s;
        let e = toks[el.last].e;
        if (el.comma >= 0) e = toks[el.comma].e;
        else if (idx > 0 && elems[idx - 1].comma >= 0) s = toks[elems[idx - 1].comma].s;
        const lineStart = src.lastIndexOf('\n', s - 1) + 1;
        const nl = src.indexOf('\n', e);
        const lineEnd = nl < 0 ? src.length : nl + 1;
        if (/^[ \t]*$/.test(src.slice(lineStart, s)) && /^[ \t]*\r?\n?$/.test(src.slice(e, lineEnd))) { s = lineStart; e = lineEnd; }
        ranges.push([s, e]);
    });
    if (!ranges.length) return src;
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of ranges) {
        const last = merged[merged.length - 1];
        if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]);
    }
    let out = src;
    for (const [s, e] of merged.reverse()) out = out.slice(0, s) + out.slice(e);
    const before = parseJsonc(src);
    const after = parseJsonc(out);
    if (!before || !after || !Array.isArray(after[key])) return null;
    const expect = before[key].filter((v) => !shouldRemove(v));
    return JSON.stringify(after[key]) === JSON.stringify(expect) ? out : null;
}

// Members of the object whose '{' is token `open`: { members: [{ name, key, valFirst, last, comma }], close }, or null.
function objectMembers(src, toks, open) {
    if (!toks[open] || toks[open].t !== '{') return null;
    const members = [];
    let d = 0;
    let cur = null;
    let close = -1;
    for (let i = open + 1; i < toks.length; i++) {
        const k = toks[i];
        if (d === 0 && k.t === '}') { close = i; break; }
        if (d === 0 && k.t === ',') { if (cur) { cur.comma = i; members.push(cur); cur = null; } continue; }
        if (!cur) cur = { key: i, last: i, comma: -1 };
        cur.last = i;
        if (k.t === '{' || k.t === '[') d++;
        else if (k.t === '}' || k.t === ']') d--;
    }
    if (close < 0) return null;
    if (cur) members.push(cur);
    for (const m of members) {
        if (toks[m.key].t !== 's' || !toks[m.key + 1] || toks[m.key + 1].t !== ':' || m.last < m.key + 2) return null;
        try { m.name = JSON.parse(src.slice(toks[m.key].s, toks[m.key].e)); } catch { return null; }
        m.valFirst = m.key + 2;
    }
    return { members, close };
}

const lineIndent = (src, pos) => /^[ \t]*/.exec(src.slice(src.lastIndexOf('\n', pos - 1) + 1))[0];
const jsonAt = (v, indent, eol) => JSON.stringify(v, null, 2).split('\n').join(eol + indent);

// Edits the members of the top-level object `rootKey` as a text patch: comments, formatting and every other
// member stay. changes = { name: value } sets (replaces or appends), { name: undefined } removes. Returns the new
// text (same text when nothing changes), or null when the edit is not safe (the result is re-parsed and compared).
function patchJsoncMap(src, rootKey, changes) {
    const before = parseJsonc(src);
    if (!before || typeof before !== 'object' || Array.isArray(before)) return null;
    const cur = before[rootKey];
    if (cur !== undefined && (!cur || typeof cur !== 'object' || Array.isArray(cur))) return null;
    const have = cur || {};
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const del = Object.keys(changes).filter((n) => changes[n] === undefined && n in have);
    const rep = Object.keys(changes).filter((n) => changes[n] !== undefined && n in have && !same(have[n], changes[n]));
    const add = Object.keys(changes).filter((n) => changes[n] !== undefined && !(n in have));
    if (!del.length && !rep.length && !add.length) return src;
    const eol = src.includes('\r\n') ? '\r\n' : '\n';
    let out = src;
    if (del.length || rep.length) out = editMembers(out, rootKey, del, rep.map((n) => [n, changes[n]]));
    if (out !== null && add.length) out = addMembers(out, rootKey, add.map((n) => [n, changes[n]]), eol);
    if (out === null) return null;
    const after = parseJsonc(out);
    if (!after) return null;
    const want = {};
    for (const [n, v] of Object.entries(have)) if (!del.includes(n)) want[n] = rep.includes(n) ? changes[n] : v;
    for (const n of add) want[n] = changes[n];
    const { [rootKey]: gotMap, ...gotRest } = after;
    const { [rootKey]: _old, ...wantRest } = before;
    return same(gotRest, wantRest) && same(gotMap || {}, want) && (Object.keys(want).length || cur === undefined || gotMap !== undefined) ? out : null;
}

function rootMap(src, rootKey) {
    const toks = tokenize(src);
    const root = objectMembers(src, toks, 0);
    if (!root) return null;
    const m = root.members.find((x) => x.name === rootKey);
    return { toks, root, map: m ? objectMembers(src, toks, m.valFirst) : null, member: m };
}

function editMembers(src, rootKey, del, reps) {
    const r = rootMap(src, rootKey);
    if (!r || !r.map) return null;
    const { toks, map } = r;
    const edits = [];
    const delRanges = [];
    map.members.forEach((m, idx) => {
        const rep = reps.find(([n]) => n === m.name);
        if (rep) { edits.push([toks[m.valFirst].s, toks[m.last].e, jsonAt(rep[1], lineIndent(src, toks[m.key].s), src.includes('\r\n') ? '\r\n' : '\n')]); return; }
        if (!del.includes(m.name)) return;
        let s = toks[m.key].s;
        let e = toks[m.last].e;
        if (m.comma >= 0) e = toks[m.comma].e;
        else if (idx > 0 && map.members[idx - 1].comma >= 0) s = toks[map.members[idx - 1].comma].s;
        const lineStart = src.lastIndexOf('\n', s - 1) + 1;
        const nl = src.indexOf('\n', e);
        const lineEnd = nl < 0 ? src.length : nl + 1;
        if (/^[ \t]*$/.test(src.slice(lineStart, s)) && /^[ \t]*\r?\n?$/.test(src.slice(e, lineEnd))) { s = lineStart; e = lineEnd; }
        delRanges.push([s, e, '']);
    });
    delRanges.sort((a, b) => a[0] - b[0]);
    for (const x of delRanges) {
        const last = edits.length && edits[edits.length - 1];
        if (last && last[2] === '' && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]); else edits.push(x);
    }
    edits.sort((a, b) => a[0] - b[0]);
    let out = src;
    for (const [s, e, t] of edits.reverse()) out = out.slice(0, s) + t + out.slice(e);
    return out;
}

// Appends [name, value] pairs as the last members of `rootKey` (created at the end of the top-level object when absent).
function addMembers(src, rootKey, pairs, eol) {
    const r = rootMap(src, rootKey);
    if (!r) return null;
    const { toks } = r;
    const target = r.map || r.root;
    const open = r.map ? r.member.valFirst : 0;
    const objIndent = r.map ? lineIndent(src, toks[r.member.key].s) : '';
    const list = target.members;
    const lastM = list[list.length - 1];
    const ind = lastM && /^[ \t]*$/.test(src.slice(src.lastIndexOf('\n', toks[lastM.key].s - 1) + 1, toks[lastM.key].s)) ? lineIndent(src, toks[lastM.key].s) : objIndent + '  ';
    const fmt = (items) => items.map(([n, v]) => `${JSON.stringify(n)}: ${jsonAt(v, ind, eol)}`);
    const wrapped = r.map ? pairs : [[rootKey, Object.fromEntries(pairs)]];
    const lines = fmt(wrapped);
    if (!lastM) {
        const at = toks[open].e;
        const text = lines.map((l) => eol + ind + l).join(',') + eol + objIndent;
        const close = toks[target.close];
        if (src.slice(at, close.s).trim() === '' ) return src.slice(0, at) + text + src.slice(close.s);
        return src.slice(0, at) + text + src.slice(at);
    }
    // New lines go after a trailing comment on the last member's line, so that comment stays with its entry.
    const after = lastM.comma >= 0 ? toks[lastM.comma].e : toks[lastM.last].e;
    let lineEnd = src.indexOf('\n', after);
    if (lineEnd < 0) lineEnd = src.length;
    else if (src[lineEnd - 1] === '\r') lineEnd--;
    if (!/^[ \t]*(\/\/.*|\/\*.*\*\/[ \t]*)?$/.test(src.slice(after, lineEnd))) lineEnd = after;
    const body = lastM.comma >= 0 ? lines.map((l) => eol + ind + l + ',').join('') : lines.map((l, i) => eol + ind + l + (i < lines.length - 1 ? ',' : '')).join('');
    if (lastM.comma >= 0) return src.slice(0, lineEnd) + body + src.slice(lineEnd);
    return src.slice(0, after) + ',' + src.slice(after, lineEnd) + body + src.slice(lineEnd);
}

module.exports = { stripJsonc, parseJsonc, removeJsoncArrayEntries, patchJsoncMap };
