// Windows+Codex: the finisher must start outside Codex's kill-on-close job (WMI), and fall back to a plain spawn when WMI fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startOutsideJob } from '../.claude/hooks/a2a-session.mjs';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'hooks', 'a2a-session.mjs'), 'utf8');
const fake = (err, out) => { const calls = []; const impl = (file, args, opts, cb) => { calls.push({ file, args, opts }); cb(err, out); }; return { impl, calls }; };

test('startOutsideJob launches through Win32_Process.Create, hidden, with a time limit', async () => {
  const f = fake(null, 'ok\r\n');
  assert.equal(await startOutsideJob(['C:\\h.mjs', '--finish', '--input-b64', 'e30='], { cwd: "C:\\proj's", execFileImpl: f.impl }), true);
  const { args, opts } = f.calls[0];
  assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand']);
  const ps = Buffer.from(args[3], 'base64').toString('utf16le');
  assert.match(ps, /Win32_Process -MethodName Create/);
  assert.match(ps, /--finish/);
  assert.match(ps, /C:\\proj''s/);
  assert.equal(opts.windowsHide, true);
  assert.ok(opts.timeout > 0 && opts.timeout <= 8000);
});

test('startOutsideJob reports false on a PowerShell error or a non-zero WMI ReturnValue', async () => {
  assert.equal(await startOutsideJob(['x'], { execFileImpl: fake(new Error('boom'), '').impl }), false);
  assert.equal(await startOutsideJob(['x'], { execFileImpl: fake(null, '').impl }), false);
});

test('the WMI branch is Windows+codex only and falls back to the detached spawn', () => {
  assert.match(SRC, /process\.platform === "win32" && harness === "codex"[^\n]*\n?[^\n]*startOutsideJob/);
  assert.match(SRC, /if \(!viaWmi\) \{\s*const child = spawn\(/);
});

test('reply does not mkdir/chmod an existing per-peer dir (sandboxed Codex can only write the file)', async () => {
  const { mkdtempSync, mkdirSync, readFileSync, rmSync, chmodSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { reply } = await import('../lib/a2a-client.mjs');
  const root = mkdtempSync(join(tmpdir(), 'aos-reply-'));
  process.env.AOS_A2A_INBOX = root;
  try {
    const d = join(root, 'codex-abcd1234');
    mkdirSync(d, { mode: 0o755 });
    const { path } = reply({ name: 'codex-abcd1234', taskId: 't1', text: 'pong' });
    assert.equal(readFileSync(path, 'utf8'), 'pong');
    assert.equal(statSync(d).mode & 0o777, process.platform === 'win32' ? statSync(d).mode & 0o777 : 0o755);
  } finally { delete process.env.AOS_A2A_INBOX; rmSync(root, { recursive: true, force: true }); }
});

test('the Windows codex hook resolves the harness pid before the wrapper exits and hands that pid to the finisher', () => {
  assert.match(SRC, /const harnessPid = lib\.resolveHarnessPid \? lib\.resolveHarnessPid\(ppid, \{ harness, until: Date\.now\(\) \+ 2500 \}\) : ppid;/);
  assert.match(SRC, /"--hook-ppid", String\(harnessPid\)/);
  assert.match(SRC, /AOS_A2A_HOOK_PPID: String\(harnessPid\)/);
  assert.doesNotMatch(SRC, /"--hook-ppid", String\(ppid\)/);
  assert.ok(SRC.indexOf('lib.resolveHarnessPid(ppid') < SRC.indexOf('startOutsideJob([self'), 'resolution must precede the WMI start');
});
