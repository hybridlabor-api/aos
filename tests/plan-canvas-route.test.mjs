import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripts = path.join(root, 'skills/global_config/plan-canvas/scripts');
const { routeFor } = require(path.join(scripts, 'lib/plan-canvas/route.js'));
const { createSessionStore } = require(path.join(scripts, 'lib/plan-canvas/sessions.js'));
const { createPlanCanvasServer } = require(path.join(scripts, 'lib/plan-canvas/server.js'));

describe('routeFor truth table', () => {
  const app = { kind: 'annotation', target: { origin: 'app' } };
  const rows = [
    [app, false, 'visual-edit'],
    [app, true, 'visual-edit'],
    [{ kind: 'annotation', target: { origin: 'canvas' } }, true, 'artifact'],
    [{ kind: 'annotation' }, false, 'artifact'],
    [{ kind: 'verdict', verdict: 'approve' }, true, 'build'],
    [{ kind: 'verdict', verdict: 'approve' }, false, 'artifact'],
    [{ kind: 'verdict', verdict: 'request-changes' }, true, 'artifact'],
    [{ kind: 'chat', text: 'hi' }, true, 'artifact'],
    [{ kind: 'chat', target: { origin: 'app' } }, true, 'artifact'],
    [{ kind: 'verdict', verdict: 'approve', target: { origin: 'app' } }, true, 'build'],
    [null, false, 'artifact'],
    [undefined, true, 'artifact'],
    ['x', true, 'artifact'],
  ];
  for (const [item, planHasComponents, expected] of rows) {
    test(`${JSON.stringify(item)} components=${planHasComponents} -> ${expected}`, () => {
      assert.equal(routeFor(item, { planHasComponents }), expected);
    });
  }
  test('options are optional', () => assert.equal(routeFor({ kind: 'chat' }), 'artifact'));
});

describe('await adds route', () => {
  let tmp;
  let stateDir;
  let store;
  let server;
  let port;
  let n = 0;
  const env = () => ({ PATH: '/opt/homebrew/bin:/usr/bin:/bin', HOME: tmp, AOS_PLAN_CANVAS_PORT: String(port), AOS_PLAN_CANVAS_STATE_DIR: stateDir });

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-route-'));
    stateDir = path.join(tmp, 'state');
    process.env.AOS_PLAN_CANVAS_STATE_DIR = stateDir;
    store = createSessionStore({ stateDir });
    server = createPlanCanvasServer({ store, workspaceRoot: tmp, idleTimeoutMs: 0, version: 'test' });
    port = (await server.listen(0)).port;
  });
  after(async () => {
    if (server) await server.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function session(content) {
    n += 1;
    const file = path.join(tmp, `plan-${n}.md`);
    fs.writeFileSync(file, content);
    return { file, key: store.open(file).session.key };
  }
  const awaitCli = (file) =>
    new Promise((resolve, reject) =>
      execFile(process.execPath, [path.join(scripts, 'plan-canvas.js'), 'await', file, '--timeout-ms', '2000'], { env: env(), encoding: 'utf8' }, (err, stdout) =>
        err ? reject(err) : resolve(JSON.parse(stdout))));

  test('app annotation routes to visual-edit, chat and canvas annotation to artifact; old keys intact', async () => {
    const { file, key } = session('# plan\n');
    const anchor = { selector: 'main > button', tag: 'button', snippet: 'Sign up' };
    store.queueFeedback(key, [{ kind: 'annotation', text: 'bigger', anchor }], { origin: 'app', boundOrigin: 'http://localhost:5173' });
    store.queueFeedback(key, [{ kind: 'chat', text: 'hello' }, { kind: 'annotation', text: 'here', anchor }]);
    const out = await awaitCli(file);
    assert.equal(out.status, 'feedback');
    assert.deepEqual(out.items.map((i) => i.route), ['visual-edit', 'artifact', 'artifact']);
    assert.deepEqual(out.items.map((i) => i.kind), ['annotation', 'chat', 'annotation']);
    assert.ok(out.items.every((i) => i.id && i.at));
    assert.match(out.next_step, /bdb-visual-edit/);
    assert.match(out.next_step, /Address the feedback/);
  });

  test('approve routes to build only when the plan has components', async () => {
    const withC = session('# Plan\n\n## Backend {#backend}\n');
    const without = session('# Plan\n\n## Backend\n');
    for (const s of [withC, without]) store.queueFeedback(s.key, [{ kind: 'verdict', verdict: 'approve' }]);
    const a = await awaitCli(withC.file);
    const b = await awaitCli(without.file);
    assert.equal(a.items[0].route, 'build');
    assert.match(a.next_step, /continue with the build pipeline/);
    assert.equal(b.items[0].route, 'artifact');
    assert.doesNotMatch(b.next_step, /build pipeline/);
  });

  test('request-changes stays artifact and next_step is unchanged', async () => {
    const { file, key } = session('# Plan\n\n## A {#a}\n');
    store.queueFeedback(key, [{ kind: 'verdict', verdict: 'request-changes' }]);
    const out = await awaitCli(file);
    assert.equal(out.items[0].route, 'artifact');
    assert.doesNotMatch(out.next_step, /bdb-visual-edit|build pipeline/);
  });
});
