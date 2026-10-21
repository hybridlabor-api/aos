// 5.4 round 4: PowerShell head spellings, exec by indirection, sort/Format-* read-only holes,
// loopback-resolving names for the OpenCode self-post guard, never-grantable under off, log redaction.
// Offline; the gate only classifies these strings, nothing here executes them.
const { test, before } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
let g, gw;
before(async () => {
    g = await import(pathToFileURL(path.join(ROOT, '.claude', 'hooks', 'go-gate.mjs')).href);
    g.setGateContext({ cwd: process.cwd(), blockTs: 0 });
    gw = await import(pathToFileURL(path.join(ROOT, 'bin', 'aos-gateway.mjs')).href);
});

const GUARDED = [
    String.raw`.\powershell.exe -Command 'git push'`,
    String.raw`..\pwsh -Command "git push origin main"`,
    String.raw`'powershell.exe' -Command 'git push'`,
    String.raw`"C:\Windows\System32\WindowsPowerShell\v1.0\pwsh.exe" -Command "git push origin main"`,
    String.raw`& 'powershell.exe' -Command 'git push'`,
    String.raw`.\powershell.exe -EncodedCommand AAAA`,
    String.raw`& 'pwsh' -enc AAAA`,
    String.raw`Start-Process -FilePath git -ArgumentList push`,
    String.raw`Start-Process git -ArgumentList 'push','origin'`,
    'saps git push',
    'start git push',
    String.raw`Start-Process $x`,
    String.raw`[Diagnostics.Process]::Start('git','push')`,
    String.raw`[System.Diagnostics.Process]::Start("git", "push")`,
    'Invoke-Item .\\x.exe',
    String.raw`powershell -Command "Start-Process git -ArgumentList push"`,
];
const FREE = [
    'git status',
    'Get-ChildItem | Format-Table',
    'Get-ChildItem | Sort-Object Name',
    'Get-ChildItem | sort Name -Descending',
];

test('round 4: guarded strings stay guarded (Claude hook and OpenCode plugin share isGuardedCommand)', () => {
    for (const c of GUARDED) assert.ok(g.isGuardedCommand(c), c);
});

test('round 4: read-only strings stay free', () => {
    for (const c of FREE) assert.equal(g.isGuardedCommand(c), false, c);
});

test('round 4: Format-Volume, sort -o and sort --compress-program are never read-only PowerShell', () => {
    for (const c of ['Format-Volume -DriveLetter D', 'sort --compress-program=sh x', 'sort -o f x', 'Get-Date; sort -o f x', 'Get-Date; sort --output=f x', 'sort -bo f x']) {
        assert.equal(g.psReadOnly(c), false, c);
    }
    assert.equal(g.psReadOnly('Get-ChildItem | Format-Table'), true);
});

test('round 4: names that resolve to loopback count as the OpenCode port itself', () => {
    for (const host of ['localtest.me', 'a.localhost', '127.1', '0x7f000001', '[::1]', '0.0.0.0', '127.0.0.1.nip.io']) {
        assert.equal(g.opencodeSelfPost(`curl -X POST -d x http://${host}:4096/anything`), true, host);
    }
    assert.equal(g.opencodeSelfPost('curl -X POST -d x https://example.com:4096/anything'), false);
});

test('round 4: gogate off never lifts the never-grantable set on either harness', () => {
    for (const c of ['aos-gate grant push-main 2h', 'aos-gate work', 'aos-gate profile work --for 2h', '~/.local/bin/aos-gate profile soft']) {
        assert.equal(g.neverGrantable(c), true, c);
        assert.equal(g.opencodeRoute(c), true, c);
    }
    assert.equal(g.opencodeRoute('aos-gate profile strict'), false);
    assert.equal(g.opencodeRoute('git status'), false);
});

test('round 4: gateLog and the gateway log redact secrets', () => {
    assert.ok(!g.maskSecrets('curl -H "Authorization: Basic dXNlcjpwYXNzd29yZA==" https://x').includes('dXNlcjpwYXNz'));
    assert.ok(!g.maskSecrets('FOO_TOKEN=abc123 git status').includes('abc123'));
    const out = [];
    const feed = gw.lineRedactor((s) => out.push(s));
    feed('{"tok');
    feed('en":"abc123","apiKey": "k-9","secret":"s","password":"p w"}\nAuthorization: Basic dXNlcjpwYXNzd29yZA==\nplain line');
    feed.flush();
    const text = out.join('');
    for (const leak of ['abc123', 'k-9', 'dXNlcjpwYXNz', '"p w"']) assert.ok(!text.includes(leak), leak);
    assert.ok(text.includes('plain line') && text.endsWith('\n'));
    assert.equal(gw.redactLine('Bearer abc.def-ghi'), 'Bearer ***');
});
