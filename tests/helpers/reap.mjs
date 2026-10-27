// Test-server teardown: children spawned through spawnReaped() are killed (whole process group on POSIX) when the
// importing test file ends, pass or fail, so no test leaves a daemon with ppid 1 behind.
import { after } from 'node:test';
import { spawn } from 'node:child_process';

const live = new Set();

export function spawnReaped(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { ...opts, detached: process.platform !== 'win32' });
  live.add(child);
  child.once('exit', () => live.delete(child));
  return child;
}

export function killAll() {
  for (const c of live) {
    try { if (process.platform === 'win32') c.kill(); else process.kill(-c.pid, 'SIGKILL'); } catch { try { c.kill('SIGKILL'); } catch { /* gone */ } }
    c.stdout?.destroy();
    c.stderr?.destroy();
    c.unref();
  }
  live.clear();
}

after(killAll);
