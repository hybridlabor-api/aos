'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ensureWritableRoot: ensure, removeWritableRoot: remove, replyRoot } = require('../lib/codex-writable-root.js');

const DIR = '/home/u/.aos/a2a-inbox';

test('reply root is the a2a-inbox dir, never the whole .aos dir', () => {
    assert.match(replyRoot('/home/u').replace(/\\/g, '/'), /\/home\/u\/\.aos\/a2a-inbox$/);
});

test('no table: appended, idempotent, removal restores the original text', () => {
    const base = '[features]\nhooks = true\n';
    const a = ensure(base, DIR);
    assert.ok(a.changed);
    assert.match(a.text, /\[sandbox_workspace_write\]\nwritable_roots = \["\/home\/u\/\.aos\/a2a-inbox"\]\n$/);
    assert.equal(ensure(a.text, DIR).changed, false);
    assert.equal(remove(a.text, DIR).text.trimEnd(), base.trimEnd());
});

test('existing writable_roots: entry appended, foreign entries survive removal', () => {
    const base = '[sandbox_workspace_write]\nnetwork_access = true\nwritable_roots = ["/data", \'/x\'] # mine\n[other]\na = 1\n';
    const a = ensure(base, DIR);
    assert.match(a.text, /writable_roots = \["\/data", '\/x', "\/home\/u\/\.aos\/a2a-inbox"\] # mine/);
    assert.equal(remove(a.text, DIR).text, base);
});

test('table without writable_roots: key inserted, removal drops only that key', () => {
    const base = '[sandbox_workspace_write]\nnetwork_access = true\n';
    const a = ensure(base, DIR);
    assert.match(a.text, /\[sandbox_workspace_write\]\nwritable_roots = /);
    assert.equal(remove(a.text, DIR).text, base);
});

test('Windows path is escaped and matched case/separator-insensitively', () => {
    const win = 'C:\\Users\\Me\\.aos\\a2a-inbox';
    const a = ensure('', win);
    assert.ok(a.text.includes('"C:\\\\Users\\\\Me\\\\.aos\\\\a2a-inbox"'));
    assert.equal(ensure(a.text, 'c:/users/me/.aos/a2a-inbox').changed, false);
});

test('forms the editor cannot parse are left alone', () => {
    for (const base of ['sandbox_workspace_write = { network_access = true }\n', '[sandbox_workspace_write]\nwritable_roots = [\n  "/a",\n]\n', '[sandbox_workspace_write]\nwritable_roots = ["/a", $x]\n']) {
        const r = ensure(base, DIR);
        assert.equal(r.changed, false);
        assert.equal(r.text, base);
        assert.equal(remove(base, DIR).changed, false);
    }
});

test('the whole .aos dir is never added', () => {
    assert.ok(!ensure('', DIR).text.includes('"/home/u/.aos"'));
});

test('CRLF files keep CRLF', () => {
    const a = ensure('[features]\r\nhooks = true\r\n', DIR);
    assert.ok(!/[^\r]\n/.test(a.text));
});

test('spaced and quoted header forms are edited in place, never duplicated', () => {
    for (const header of ['[ sandbox_workspace_write ]', '["sandbox_workspace_write"]', "['sandbox_workspace_write']"]) {
        const base = `${header}\nnetwork_access = true\n`;
        const a = ensure(base, DIR);
        assert.ok(a.changed, header);
        assert.equal((a.text.match(/sandbox_workspace_write/g) || []).length, 1, `${header}: no second table`);
        assert.equal(remove(a.text, DIR).text, base);
    }
});

test('a second mention of the table (dotted key next to a header) is refused', () => {
    const base = '[sandbox_workspace_write]\nnetwork_access = true\n[other]\nx = 1\nsandbox_workspace_write.writable_roots = ["/a"]\n';
    const r = ensure(base, DIR);
    assert.equal(r.changed, false);
    assert.ok(r.note);
});

test('removal keeps user comment lines in the table', () => {
    const base = '[sandbox_workspace_write]\n# my note\n';
    const a = ensure(base, DIR);
    const back = remove(a.text, DIR).text;
    assert.ok(back.includes('# my note') && back.includes('[sandbox_workspace_write]'));
});
