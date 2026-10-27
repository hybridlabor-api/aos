import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connectFailures, neverConnected, causeHint } from '../bin/aos-gateway.mjs';

const logOf = (lines) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-gwcause-'));
    fs.writeFileSync(path.join(dir, 'gateway.log'), lines.join('\n') + '\n');
    return dir;
};
const closed = (n) => `[ERROR] message="Failed to connect to ${n}: Connection closed"`;

test('status shows the upstream stderr root cause instead of only "Connection closed"', () => {
    const dir = logOf(['[github] aos-mcp-env: cannot start npx: ENOENT', closed('github'), '[INFO] unrelated']);
    const f = connectFailures(dir);
    assert.match(neverConnected('github', f), /cannot start npx: ENOENT.*Connection closed/);
});

test('the cause line is redacted', () => {
    const dir = logOf([`[github] auth failed token=ghp_${'a'.repeat(30)}`, closed('github')]);
    const msg = neverConnected('github', connectFailures(dir));
    assert.ok(!msg.includes('ghp_a'));
});

test('the codebase_memory_mcp ACL reason reaches the status line', () => {
    const dir = logOf(['[codebase_memory_mcp] exact executable identity could not be verified (cache-private): DACL entry grants mutation rights to untrusted identity', closed('codebase_memory_mcp')]);
    assert.match(neverConnected('codebase_memory_mcp', connectFailures(dir)), /DACL entry grants mutation rights/);
});

test('a half-written npx cache gets the exact path and a manual command, nothing is deleted', () => {
    const p = 'C:\\Users\\t\\AppData\\Local\\npm-cache\\_npx\\0123abcd4567ef89';
    const dir = logOf([`[chrome-devtools] npm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open '${p}\\package.json'`, closed('chrome-devtools')]);
    const msg = neverConnected('chrome-devtools', connectFailures(dir));
    assert.ok(msg.includes(`rmdir /s /q "${p}"`), msg);
    assert.equal(causeHint('no npx here'), '');
});

test('without a cause line the old wording stays', () => {
    assert.match(neverConnected('x', connectFailures(logOf([closed('x')]))), /Connection closed/);
});
