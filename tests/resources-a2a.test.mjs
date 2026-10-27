// Resource efficiency: a2a sidecars die with their parent and the newest sidecar of one harness process wins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnReaped, killAll } from './helpers/reap.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'a2a-res-'));
const env = { ...process.env, AOS_SESSIONS_DIR: join(tmp, 'sessions'), AOS_BUS_ROOT: join(tmp, 'bus'), AOS_A2A_INBOX: join(tmp, 'inbox'), AOS_A2A_BOOK: join(tmp, 'book.json') };
const BIN = join(import.meta.dirname, '..', 'bin', 'aos-a2a.mjs');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (fn, ms) => { for (const end = Date.now() + ms; Date.now() < end;) { if (fn()) return true; await new Promise((r) => setTimeout(r, 200)); } return fn(); };
const serve = (name, parent) => {
  const c = spawnReaped(process.execPath, [BIN, 'serve', '--name', name, '--harness', 'claude', '--mode', 'echo', '--parent-pid', String(parent)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => { c.once('error', reject); c.stdout.once('data', () => resolve(c)); c.once('exit', () => resolve(c)); });
};

test('serve exits when its parent dies', async () => {
  const parent = spawnReaped(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { stdio: 'ignore' });
  const sidecar = await serve('res-parent', parent.pid);
  assert.ok(alive(sidecar.pid));
  process.kill(parent.pid, 'SIGKILL');
  assert.ok(await until(() => !alive(sidecar.pid), 15000), 'sidecar must exit after its parent is gone');
});

test('a newer sidecar of the same parent retires the older one', async () => {
  const older = await serve('res-old', process.pid);
  const newer = await serve('res-new', process.pid);
  assert.ok(await until(() => !alive(older.pid), 10000), 'older sidecar must be retired');
  assert.ok(alive(newer.pid));
});

test('killAll reaps a whole process group (no orphan grandchildren)', async () => {
  const sh = spawnReaped('sh', ['-c', 'sleep 60 & echo $!; wait'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const grandchild = Number(await new Promise((r) => sh.stdout.once('data', (d) => r(String(d).trim()))));
  assert.ok(alive(grandchild));
  killAll();
  assert.ok(await until(() => !alive(grandchild), 3000));
});
