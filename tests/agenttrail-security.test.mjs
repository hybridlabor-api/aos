import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = path.join(root, 'skills', 'global_config', 'agenttrail', 'bin', 'agenttrail.mjs');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let repoDir;
let outsideDir;
let daemon;
let base;
let stdout = '';
let stderr = '';
let childPort;

async function freePort(start, floor) {
  for (let port = start; port >= floor; port -= 1) {
    const candidate = net.createServer();
    const available = await new Promise((resolve) => {
      candidate.once('error', () => resolve(false));
      candidate.listen(port, '127.0.0.1', () => candidate.close(() => resolve(true)));
    });
    if (available) return port;
  }
  return start;
}

async function waitReady() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (daemon.exitCode !== null) throw new Error(`daemon exited: ${stderr}`);
    const match = stdout.match(/http:\/\/localhost:(\d+)/);
    if (match) {
      base = `http://127.0.0.1:${match[1]}`;
      const response = await fetch(`${base}/whoami`, { signal: AbortSignal.timeout(1000) }).catch(() => null);
      if (response && (await response.json()).repoPath === repoDir) return;
    }
    await sleep(100);
  }
  throw new Error(`daemon did not start: ${stdout}${stderr}`);
}

async function post(pathname, value) {
  try {
    const response = await fetch(`${base}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
      signal: AbortSignal.timeout(3000),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  } catch {
    return { status: 0, body: {} };
  }
}

function stopSpawnedTargets() {
  const listing = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8', shell: false });
  for (const line of String(listing.stdout || '').split('\n')) {
    if (!line.includes(binary) || !line.includes(outsideDir)) continue;
    const pid = Number(line.trim().split(/\s+/)[0]);
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
      try { process.kill(pid, 'SIGTERM'); } catch {}
    }
  }
}

describe('AgentTrail bounded mutating routes', () => {
  before(async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenttrail-security-repo-'));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenttrail-security-outside-'));
    fs.writeFileSync(path.join(repoDir, 'PLAN.md'), '# Security\n');
    childPort = await freePort(6499, 6480);
    const port = await freePort(6399, 6380);
    daemon = spawn(process.execPath, [binary, repoDir, '--port', String(port), '--no-open'], {
      cwd: root,
      env: { ...process.env, AGENTTRAIL_PORT: String(childPort) },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    daemon.stdout.on('data', (chunk) => { stdout += chunk; });
    daemon.stderr.on('data', (chunk) => { stderr += chunk; });
    await waitReady();
  });

  after(() => {
    stopSpawnedTargets();
    if (daemon && daemon.exitCode === null) {
      try { daemon.kill('SIGTERM'); } catch {}
    }
    for (const directory of [repoDir, outsideDir]) {
      if (!directory) continue;
      try {
        const hash = crypto.createHash('sha1').update(directory).digest('hex').slice(0, 12);
        fs.rmSync(path.join(os.homedir(), '.agenttrail', `${hash}.json`), { force: true });
      } catch {}
      try { fs.rmSync(directory, { recursive: true, force: true }); } catch {}
    }
  });

  test('rejects an oversized hook body', async () => {
    const result = await post('/hook', {
      cwd: repoDir,
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: path.join(repoDir, 'file.txt') },
      padding: 'x'.repeat(8192),
    });
    assert.equal(result.status, 413);
  });

  test('rejects an oversized spawn body', async () => {
    const result = await post('/spawn', { path: '/path/that/does/not/exist', padding: 'x'.repeat(8192) });
    assert.equal(result.status, 413);
  });

  test('rejects an oversized setup-board body', async () => {
    const result = await post('/setup-board', { port: -1, padding: 'x'.repeat(8192) });
    assert.equal(result.status, 413);
  });

  test('accepts the active workspace and rejects an arbitrary local directory', async () => {
    const accepted = await post('/spawn', { path: repoDir });
    assert.equal(accepted.body.ok, true);
    const rejected = await post('/spawn', { path: outsideDir });
    assert.equal(rejected.body.ok, false);
  });
});
