import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(root, 'skills/global_config/plan-canvas/scripts/plan-canvas.js');
const builderDir = path.join(root, 'skills/global_config/plan-canvas/scripts/lib/plan-builder');
const showcase = path.join(builderDir, 'examples/showcase');
const require = createRequire(import.meta.url);
const { renderPlanFolder } = require(path.join(builderDir, 'index.js'));

const KIT = /<(?:FrameScreen|Col|Row|Box|Lines|IconSquare|StatusBar|TaskRow|Btn|Chips|SectionLabel|Skeleton|Artboard|Section|DesignBoard)[\s/>]/;

describe('Harbor Notes showcase', () => {
  for (const name of ['builder', 'recap']) {
    test(`${name} renders with zero warnings and no raw tags`, () => {
      const r = renderPlanFolder(path.join(showcase, name), { write: false });
      assert.equal(r.error, undefined);
      assert.deepEqual(r.warnings, []);
      assert.ok(!KIT.test(r.html), 'raw kit tag leaked into the output');
    });
  }

  test('builder canvas has 8 artboards, 10 transitions, 4 annotations and a semantic Screen', () => {
    const { html } = renderPlanFolder(path.join(showcase, 'builder'), { write: false });
    assert.equal((html.match(/class="[^"]*\bab-frame\b[^"]*"/g) || []).length, 8);
    const canvas = fs.readFileSync(path.join(showcase, 'builder/canvas.mdx'), 'utf8');
    assert.equal((canvas.match(/\bfrom: "/g) || []).length, 10);
    assert.equal((canvas.match(/<Annotation /g) || []).length, 4);
    assert.equal((canvas.match(/<Section /g) || []).length, 3);
    assert.match(canvas, /<Screen surface="web" label="[^"]*" caption="[^"]*" html=/);
  });

  test('Archify block renders the delivered diagram without warning', () => {
    assert.ok(fs.existsSync(path.join(showcase, 'builder/00_architecture.html')));
    const { html, warnings } = renderPlanFolder(path.join(showcase, 'builder'), { write: false });
    assert.deepEqual(warnings.filter((w) => /archify/i.test(w)), []);
    assert.match(html, /<iframe[^>]*sandbox="allow-scripts"/);
    const arch = JSON.parse(fs.readFileSync(path.join(showcase, 'architecture.json'), 'utf8'));
    assert.ok(arch.components.length <= 11);
  });

  test('generated plan.builder.html is not tracked', () => {
    const r = spawnSync('git', ['ls-files', '--', 'skills/global_config/plan-canvas/scripts/lib/plan-builder/examples/showcase'], { cwd: root, encoding: 'utf8' });
    if (r.status === 0) assert.ok(!/plan\.builder\.html/.test(r.stdout));
    const ig = spawnSync('git', ['check-ignore', path.join(showcase, 'builder/plan.builder.html')], { cwd: root, encoding: 'utf8' });
    if (ig.status !== null && ig.status !== 128) assert.equal(ig.status, 0);
  });

  describe('trail', () => {
    let ws;
    before(() => {
      ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aos-showcase-')));
      fs.cpSync(path.join(showcase, 'builder'), path.join(ws, 'builder'), { recursive: true });
    });
    after(() => fs.rmSync(ws, { recursive: true, force: true }));

    test('builder folder yields >= 6 components, each with needs, tasks or files', () => {
      const r = spawnSync(process.execPath, [scriptPath, 'trail', 'builder', '--out', 'production_artifacts/00_execution_plan.md'], { cwd: ws, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      const out = JSON.parse(r.stdout);
      assert.ok(out.components >= 6, `components ${out.components}`);
      assert.ok(out.tasks >= 15, `tasks ${out.tasks}`);
      assert.deepEqual(out.warnings || [], []);
      const text = fs.readFileSync(path.join(ws, out.out), 'utf8');
      const blocks = text.split(/^## /m).slice(1);
      assert.equal(blocks.length, out.components);
      for (const b of blocks) assert.match(b, /^(needs|files): |^- \[[ x]\] /m, b.split('\n')[0]);
    });
  });
});
