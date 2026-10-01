import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'skills/global_config/plan-canvas/scripts/plan-canvas.js');
const builderDir = path.join(root, 'skills/global_config/plan-canvas/scripts/lib/plan-builder');
const tplDir = path.join(builderDir, 'templates');
const { renderPlanFolder } = createRequire(import.meta.url)(path.join(builderDir, 'index.js'));

const ids = fs.existsSync(tplDir)
  ? fs.readdirSync(tplDir).filter((d) => fs.existsSync(path.join(tplDir, d, 'meta.json'))).sort()
  : [];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-tpl-'));
const env = { ...process.env, AOS_PLAN_CANVAS_STATE_DIR: path.join(tmp, 'state') };
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env });

test('templates CLI lists every template with meta.json', () => {
  const r = run('templates');
  assert.equal(r.status, 0);
  const list = JSON.parse(r.stdout);
  assert.deepEqual(list.map((t) => t.id), ids);
});

test('new: unknown id exits 2 and lists valid ids', () => {
  const r = run('new', 'no-such-template', path.join(tmp, 'x'));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Unknown template/);
});

for (const id of ids) {
  const dir = path.join(tplDir, id);
  test(`template ${id}`, () => {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    for (const k of ['id', 'label', 'description', 'useWhen']) assert.ok(typeof meta[k] === 'string' && meta[k].trim(), `meta.${k}`);
    assert.equal(meta.id, id);
    assert.equal(typeof meta.hasBoard, 'boolean');
    assert.equal(fs.existsSync(path.join(dir, 'canvas.mdx')), meta.hasBoard);

    const std = fs.readFileSync(path.join(dir, 'standard.md'), 'utf8');
    assert.ok(/```mermaid/.test(std) || /^\|.*\|\s*$/m.test(std), 'standard.md has a mermaid fence or table');

    const r = renderPlanFolder(dir);
    assert.deepEqual(r.warnings, []);
    fs.rmSync(path.join(dir, 'plan.builder.html'), { force: true });

    const b = path.join(tmp, `${id}-builder`);
    const nb = run('new', id, b);
    assert.equal(nb.status, 0, nb.stderr);
    assert.ok(fs.existsSync(path.join(b, 'plan.mdx')));
    assert.equal(fs.existsSync(path.join(b, 'canvas.mdx')), meta.hasBoard);
    assert.equal(fs.existsSync(path.join(b, 'meta.json')), false);
    assert.equal(run('new', id, b).status, 2);

    const s = path.join(tmp, `${id}-std`);
    const ns = run('new', id, s, '--mode', 'standard');
    assert.equal(ns.status, 0, ns.stderr);
    assert.equal(fs.readFileSync(path.join(s, 'plan.md'), 'utf8'), std);
    assert.equal(run('new', id, s, '--mode', 'standard').status, 2);
  });
}

test('cleanup', () => fs.rmSync(tmp, { recursive: true, force: true }));
