import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeHealth } from '../bin/aos-hub.mjs';

// Double start: a hub already answering on the port (the OS service, or an
// earlier `aos hub`) must be detected by a second manual start, which must
// not spawn a child or write hub.json. Only a local identity server is used;
// no service manager (launchd/systemd/Task Scheduler) is touched. Temp dirs
// are never deleted (rules forbid recursive deletes).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'bin', 'aos-hub.mjs');

const listen = (handler) => new Promise((resolve) => {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
});
const close = (server) => new Promise((resolve) => server.close(resolve));

const hubHealth = (req, res) => {
  if (req.url === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'aos-hub', version: 'test' }));
    return;
  }
  res.writeHead(404); res.end();
};

const foreignHealth = (req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
};

test('a second manual start detects the running hub and does not bind again', async () => {
  const home = mkdtempSync(join(tmpdir(), 'aos-hub-guard-'));
  const { server, port } = await listen(hubHealth);
  try {
    assert.equal(await probeHealth(port), true);
    const { stdout, code } = await new Promise((resolve) => {
      execFile(process.execPath, [CLI, 'start', '--port', String(port), '--no-open'], {
        env: { ...process.env, HOME: home, USERPROFILE: home, AOS_HUB_HOME: home, AOS_NO_OPEN: '1' },
        timeout: 20000,
      }, (err, out) => resolve({ stdout: String(out), code: err ? err.code ?? 1 : 0 }));
    });
    assert.equal(code, 0);
    assert.match(stdout, /already running/);
    assert.doesNotMatch(stdout, /starting/);
    assert.equal(existsSync(join(home, '.aos', 'hub', 'hub.json')), false, 'no second hub may write hub.json');
  } finally {
    await close(server);
  }
});

test('a foreign listener on the port is not treated as a running hub', async () => {
  const { server, port } = await listen(foreignHealth);
  try {
    assert.equal(await probeHealth(port), false);
  } finally {
    await close(server);
  }
});
