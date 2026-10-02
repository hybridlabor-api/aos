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

module.exports = { stripJsonc, parseJsonc, removeJsoncArrayEntries };
