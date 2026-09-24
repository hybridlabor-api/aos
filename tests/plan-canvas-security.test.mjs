import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createSessionStore } = require('../skills/global_config/plan-canvas/scripts/lib/plan-canvas/sessions.js');
const { createPlanCanvasServer } = require('../skills/global_config/plan-canvas/scripts/lib/plan-canvas/server.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let workspace;
let outside;
let store;
let server;
let base;

async function openSession(file) {
  const response = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file }),
    signal: AbortSignal.timeout(3000),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

describe('Plan-Canvas artifact confinement', () => {
  before(async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-root-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-outside-'));
    const insideFile = path.join(workspace, 'plan.md');
    const outsideFile = path.join(outside, 'secret.md');
    fs.writeFileSync(insideFile, '# inside');
    fs.writeFileSync(outsideFile, '# outside');
    fs.symlinkSync(outsideFile, path.join(workspace, 'linked.md'));
    store = createSessionStore({ stateDir: path.join(workspace, '.state') });
    server = createPlanCanvasServer({ store, workspaceRoot: workspace, idleTimeoutMs: 0 });
    const bound = await server.listen(0);
    base = `http://127.0.0.1:${bound.port}`;
  });

  after(async () => {
    if (server) await server.close().catch(() => {});
    if (workspace) fs.rmSync(workspace, { recursive: true, force: true });
    if (outside) fs.rmSync(outside, { recursive: true, force: true });
  });

  test('opens a file inside the workspace', async () => {
    const result = await openSession(path.join(workspace, 'plan.md'));
    assert.equal(result.status, 200);
  });

  test('rejects files outside the workspace and symlink escapes', async () => {
    const outsideResult = await openSession(path.join(outside, 'secret.md'));
    assert.equal(outsideResult.status, 403);
    const linkResult = await openSession(path.join(workspace, 'linked.md'));
    assert.equal(linkResult.status, 403);
  });
});
