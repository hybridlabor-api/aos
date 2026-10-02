// cli-spawn: resolver and cmd.exe quoting with injected platform/env/fs; no Windows needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const cs = require('../lib/cli-spawn');

// Case-insensitive like NTFS, so PATHEXT casing does not matter.
const fakeFs = (files) => {
  const lower = new Set([...files].map((f) => f.toLowerCase()));
  return {
    statSync: (f) => { if (!lower.has(f.toLowerCase())) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return { isFile: () => true }; },
    accessSync: (f) => { if (!lower.has(f.toLowerCase())) throw new Error('EACCES'); },
  };
};

test('Windows: resolves npm shims through PATH and PATHEXT (case-insensitive env keys)', () => {
  const files = new Set(['C:\\Users\\A B\\AppData\\Roaming\\npm\\codex.cmd', 'C:\\bin\\agy.exe']);
  const env = { Path: 'C:\\Windows;"C:\\Users\\A B\\AppData\\Roaming\\npm";C:\\bin', pathext: '.EXE;.CMD' };
  const o = { platform: 'win32', env, fs: fakeFs(files) };
  assert.equal(cs.resolveCommand('codex', o).toLowerCase(), 'c:\\users\\a b\\appdata\\roaming\\npm\\codex.cmd');
  assert.equal(cs.resolveCommand('agy', o).toLowerCase(), 'c:\\bin\\agy.exe');
  assert.equal(cs.resolveCommand('claude', o), null);
  assert.equal(cs.onPath('codex', o), true);
  assert.equal(cs.onPath('nope', o), false);
});

test('Windows: explicit extension and absolute path are honoured', () => {
  const files = new Set(['C:\\t\\x.bat']);
  const o = { platform: 'win32', env: { PATH: '' }, fs: fakeFs(files) };
  assert.equal(cs.resolveCommand('C:\\t\\x.bat', o), 'C:\\t\\x.bat');
  assert.equal(cs.resolveCommand('C:\\t\\x', o).toLowerCase(), 'c:\\t\\x.bat');
});

test('POSIX: first executable on PATH wins, args stay an array', () => {
  const files = new Set(['/b/codex']);
  const o = { platform: 'linux', env: { PATH: '/a:/b' }, fs: fakeFs(files) };
  assert.equal(cs.resolveCommand('codex', o), '/b/codex');
  const inv = cs.buildInvocation('/b/codex', ['plugin', 'add', 'x & y'], o);
  assert.deepEqual(inv, { file: '/b/codex', args: ['plugin', 'add', 'x & y'], options: {} });
});

test('quoteCmdArg: spaces, ampersands, quotes, trailing backslash, percent', () => {
  assert.equal(cs.quoteCmdArg('plain', false), '^"plain^"');
  assert.equal(cs.quoteCmdArg('C:\\Users\\A B\\Temp', false), '^"C:\\Users\\A^ B\\Temp^"');
  assert.equal(cs.quoteCmdArg('a&b', false), '^"a^&b^"');
  assert.equal(cs.quoteCmdArg('say "hi"', false), '^"say^ \\^"hi\\^"^"');
  assert.equal(cs.quoteCmdArg('dir\\', false), '^"dir\\\\^"');
  assert.equal(cs.quoteCmdArg('%TEMP%', false), '^"^%TEMP^%^"');
  // shims re-parse %*: carets are doubled
  assert.equal(cs.quoteCmdArg('a&b'), '^^^"a^^^&b^^^"');
});

test('Windows shim goes through cmd.exe /d /s /c with one verbatim command line', () => {
  const inv = cs.buildInvocation('C:\\Users\\A B\\npm\\codex.cmd', ['plugin', 'marketplace', 'add', 'C:\\Temp\\x & y'], { platform: 'win32', env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' } });
  assert.equal(inv.file, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(inv.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(inv.args.length, 4);
  assert.deepEqual(inv.options, { windowsVerbatimArguments: true });
  const line = inv.args[3];
  assert.ok(line.startsWith('"C:\\Users\\A^ B\\npm\\codex.cmd '));
  assert.ok(line.endsWith('^^^""'));
  assert.ok(line.includes('x^^^ ^^^&^^^ y'));
  // no bare metacharacter survives outside the carets
  assert.equal(/(^|[^^])[&|<>]/.test(line), false);
});

test('Windows .exe is spawned directly, not through cmd', () => {
  const inv = cs.buildInvocation('C:\\bin\\agy.exe', ['plugin', 'install', 'C:\\Temp\\A B'], { platform: 'win32', env: {} });
  assert.deepEqual(inv, { file: 'C:\\bin\\agy.exe', args: ['plugin', 'install', 'C:\\Temp\\A B'], options: {} });
});

test('run: missing command, spawn result mapping, timeout flag', () => {
  const o = { platform: 'linux', env: { PATH: '/b' }, fs: fakeFs(new Set(['/b/t'])) };
  const miss = cs.run('nope', [], o);
  assert.equal(miss.missing, true);
  assert.equal(miss.status, null);
  const seen = [];
  const ok = cs.run('t', ['a'], { ...o, timeout: 5, spawn: (f, a, opts) => { seen.push([f, a, opts.timeout, opts.shell]); return { status: 0, stdout: 'out', stderr: '' }; } });
  assert.deepEqual(seen, [['/b/t', ['a'], 5, false]]);
  assert.equal(ok.status, 0);
  const to = cs.run('t', [], { ...o, spawn: () => ({ status: null, error: Object.assign(new Error('x'), { code: 'ETIMEDOUT' }) }) });
  assert.equal(to.timedOut, true);
  assert.equal(to.status, null);
  const thrown = cs.run('t', [], { ...o, spawn: () => { throw new Error('boom'); } });
  assert.equal(thrown.status, null);
});

test('F3: CR/LF arguments are rejected with a clear error, never spawned', () => {
  assert.throws(() => cs.buildInvocation('/b/codex', ['a\nb'], { platform: 'linux', env: {} }), /argument 1 contains a CR or LF/);
  let spawned = false;
  const r = cs.run('codex', ['ok', 'x\r\ny'], { platform: 'linux', env: { PATH: '/b' }, fs: fakeFs(new Set(['/b/codex'])), spawn: () => { spawned = true; return {}; } });
  assert.equal(spawned, false);
  assert.match(r.stderr, /CR or LF/);
});

test('F3: without ComSpec the shim runs through %SystemRoot%\\System32\\cmd.exe, never bare cmd.exe', () => {
  const o = { platform: 'win32', env: { SYSTEMROOT: 'D:\\Win' } };
  assert.equal(cs.buildInvocation('C:\\n\\x.cmd', ['a'], o).file, 'D:\\Win\\System32\\cmd.exe');
  assert.equal(cs.buildInvocation('C:\\n\\x.cmd', ['a'], { platform: 'win32', env: {} }).file, 'C:\\Windows\\System32\\cmd.exe');
});

test('F3: carets are doubled only for a batch file that forwards %*', () => {
  const fsOf = (text) => ({ readFileSync: () => text });
  const o = (text) => ({ platform: 'win32', env: { ComSpec: 'cmd.exe' }, fs: fsOf(text) });
  const line = (text) => cs.buildInvocation('C:\\n\\x.cmd', ['a&b'], o(text)).args[3];
  assert.match(line('@echo off\r\nnode x.js %*\r\n'), /\^\^\^&/);
  assert.doesNotMatch(line('@echo off\r\necho hi\r\n'), /\^\^\^&/);
  assert.match(line('@echo off\r\necho hi\r\n'), /\^&/);
});
