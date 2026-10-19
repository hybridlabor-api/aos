// Resource efficiency: the on-demand agenttrail map exits once nobody uses it; a supervised one stays up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { spawnReaped } from './helpers/reap.mjs';

const BIN = join(import.meta.dirname, '..', 'skills', 'global_config', 'agenttrail', 'bin', 'agenttrail.mjs');
const freePort = () => new Promise((resolve) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

async function start(extraEnv, extraArgs = []) {
  const home = mkdtempSync(join(tmpdir(), 'trail-idle-'));
  const repo = mkdtempSync(join(tmpdir(), 'trail-repo-'));
  spawnSync('git', ['init', '-q', repo]);
  const port = await freePort();
  const env = { ...process.env, HOME: home, USERPROFILE: home, AOS_TEST_SANDBOX: '1', AOS_NO_OPEN: '1', ...extraEnv };
  const child = spawnReaped(process.execPath, [BIN, repo, '--port', String(port), '--no-open', ...extraArgs], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise((r) => child.once('exit', r));
  await new Promise((resolve, reject) => { child.once('error', reject); child.stdout.on('data', (d) => /http:\/\/localhost/.test(String(d)) && resolve()); child.once('exit', resolve); });
  return { child, exited };
}

test('idle map exits by itself', async () => {
  const { child, exited } = await start({ AOS_TRAIL_IDLE_MS: '1000' });
  const winner = await Promise.race([exited.then(() => 'exited'), new Promise((r) => setTimeout(() => r('alive'), 15000))]);
  assert.equal(winner, 'exited');
  assert.equal(child.exitCode, 0);
});

test('a supervised map never idle-exits', async () => {
  const { child, exited } = await start({ AOS_TRAIL_IDLE_MS: '500' }, ['--supervised']);
  const winner = await Promise.race([exited.then(() => 'exited'), new Promise((r) => setTimeout(() => r('alive'), 4000))]);
  assert.equal(winner, 'alive');
  child.kill();
});
