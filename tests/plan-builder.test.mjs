import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(root, 'skills/global_config/plan-canvas/scripts/plan-canvas.js');
const builderDir = path.join(root, 'skills/global_config/plan-canvas/scripts/lib/plan-builder');
const require = createRequire(import.meta.url);
const { renderPlanFolder, renderPlanSource, parseMdx } = require(path.join(builderDir, 'index.js'));

const FIXTURE_PLAN = `---
title: Fixture Plan
status: draft
---

# Checkout rewrite

## Context

Shipping <script>alert(1)</script> inline must not execute.

## Architecture

<Mermaid source={"flowchart LR\\n  A[Cart] --> B[Pay]"} label="flow" />

## Files

<FileTree entries={[{"path":"src/cart.ts","change":"modified","note":"totals"},{"path":"src/old.ts","change":"removed"}]} />

## Screen

<WireframeBlock>
<Screen surface="desktop" html={'<div class="wf-card">Total $42</div>'} />
</WireframeBlock>

## Escape hatch

<CustomHtml label="sketch" html={'<script>alert(2)</script><div>hi</div>'} />

## Unknown

<NotARealBlock foo="bar" />

### Detail

Trailing prose.
`;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function runCommand(args, env = {}, cwd = root) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
    proc.on('close', code => resolve({ code, stdout, stderr }));
    proc.on('error', reject);
  });
}

describe('BDB Plan Builder', () => {
  let dir;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-plan-builder-'));
    fs.writeFileSync(path.join(dir, 'plan.mdx'), FIXTURE_PLAN);
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('renders one self-contained HTML document', () => {
    const { html } = renderPlanSource({ plan: FIXTURE_PLAN });
    assert.equal((html.match(/<!DOCTYPE html>/g) || []).length, 1);
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.trimEnd().endsWith('</html>'));
    assert.ok(html.includes('<style>'));
    assert.ok(!html.includes('<link '), 'no external stylesheet');
  });

  test('headings produce side navigation entries', () => {
    const { html } = renderPlanSource({ plan: FIXTURE_PLAN });
    const nav = html.slice(html.indexOf('class="sidenav"'), html.indexOf('</nav>'));
    assert.match(nav, /on this page/);
    for (const heading of ['Context', 'Architecture', 'Files', 'Screen', 'Detail']) {
      assert.ok(nav.includes(`>${heading}</a>`), `nav is missing ${heading}`);
    }
  });

  test('script in prose is escaped, not executable', () => {
    const { html } = renderPlanSource({ plan: FIXTURE_PLAN });
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  });

  test('custom-html and wireframe html are sandboxed without allow-scripts', () => {
    const { html } = renderPlanSource({ plan: FIXTURE_PLAN });
    const frames = html.match(/<iframe[^>]*>/g) || [];
    assert.ok(frames.length >= 2, 'expected a frame for the wireframe and one for custom-html');
    for (const frame of frames) {
      assert.match(frame, /sandbox/);
      assert.ok(!frame.includes('allow-scripts'), `frame must not allow scripts: ${frame}`);
      assert.match(frame, /srcdoc=/);
    }
    // The custom-html payload rides inside its own srcdoc, escaped.
    assert.match(html, /sketch/);
    assert.ok(!html.includes('<script>alert(2)</script>'));
  });

  test('unknown tag renders a visible unsupported card and a warning', () => {
    const result = renderPlanSource({ plan: FIXTURE_PLAN });
    assert.ok(result.warnings.some(w => w.includes('NotARealBlock')), 'no warning for the unknown tag');
    assert.match(result.html, /unsupported block/);
    assert.match(result.html, /&lt;NotARealBlock foo=&quot;bar&quot; \/&gt;/);
  });

  test('mermaid block uses the pinned canvas renderer', () => {
    const { html } = renderPlanSource({ plan: FIXTURE_PLAN });
    assert.ok(html.includes('class="mermaid"'));
    assert.ok(html.includes('mermaid@11.4.1'));
    assert.ok(html.includes('mermaid-unrendered'), 'offline fallback missing');
  });

  test('file tree and screen blocks render', () => {
    const { html } = renderPlanSource({ plan: FIXTURE_PLAN });
    assert.match(html, /src\/cart\.ts/);
    assert.match(html, /class="badge modified"/);
    assert.match(html, /class="badge removed"/);
    assert.ok(html.includes('Total $42'), 'wireframe html not carried into its frame');
  });

  test('theme is BDB CI: near-black, white, single purple accent', () => {
    const css = fs.readFileSync(path.join(builderDir, 'theme.css'), 'utf8');
    assert.ok(css.includes('#0a0a0a'));
    assert.ok(css.includes('#9b30c4'));
    assert.ok(!css.includes('mint'));
    assert.ok(!css.includes('cyan'));
    const { html } = renderPlanSource({ plan: FIXTURE_PLAN });
    assert.ok(html.includes('#0a0a0a'));
    assert.ok(html.includes('#9b30c4'));
  });

  test('malformed input does not throw', () => {
    assert.doesNotThrow(() => renderPlanSource({ plan: '<Code code={not json} ' }));
    const { html, warnings } = renderPlanSource({ plan: '# T\n\n<RichText>never closed' });
    assert.ok(warnings.length > 0);
    assert.match(html, /could not render|unsupported/);
  });

  test('parseMdx reads frontmatter, headings, tags', () => {
    const blocks = parseMdx(FIXTURE_PLAN);
    assert.equal(blocks.frontmatter.title, 'Fixture Plan');
    assert.equal(blocks.frontmatter.status, 'draft');
    assert.ok(blocks.some(b => b.type === 'heading' && b.text === 'Architecture'));
    const tag = blocks.find(b => b.type === 'tag' && b.name === 'Mermaid');
    assert.ok(tag);
    assert.equal(tag.props.label, 'flow');
    assert.match(tag.props.source, /^flowchart LR/);
  });

  test('structured blocks carry their content through', () => {
    const plan = [
      '<Columns columns={[{"label":"Before","blocks":[{"type":"prose","text":"old thing"}]},{"label":"After","blocks":[{"type":"prose","text":"new thing"}]}]} />',
      '<TabsBlock tabs={[{"label":"a.ts","blocks":[{"type":"prose","text":"const x = 1"}]}]} />',
      '<Endpoint method="POST" path="/v1/pay" params={[{"name":"amount","type":"integer","required":true}]}>Charges the card.</Endpoint>',
      '<DataModel entities={[{"name":"cart","fields":[{"name":"total","type":"int","change":"modified","was":"string"}]}]} />',
      '<QuestionForm title="Open Questions" questions={[{"title":"Which queue?","mode":"single","options":[{"label":"redis","recommended":true}]}]} />',
      '<Diff mode="unified" filename="src/x.ts" before="a" after="b" summary="rename thing" />'
    ].join('\n\n');
    const { html, warnings } = renderPlanSource({ plan });
    assert.deepEqual(warnings, []);
    for (const probe of ['Before', 'After', 'a.ts', '/v1/pay', 'amount', 'cart', 'Which queue?', 'redis', 'recommended', 'src/x.ts', 'rename thing']) {
      assert.ok(html.includes(probe), `missing ${probe}`);
    }
  });

  test('canvas.mdx artboards render instead of collapsing to unsupported', () => {
    const { html, warnings } = renderPlanSource({
      plan: '# T',
      canvas: '<DesignBoard><Artboard title="Step 1"><Screen surface="mobile" html={\'<div>hi</div>\'} /></Artboard><Annotation>Check the empty state.</Annotation></DesignBoard>'
    });
    assert.deepEqual(warnings, []);
    assert.ok(html.includes('Check the empty state.'));
    assert.ok(html.includes('<div class="label">Step 1</div>'));
    assert.match(html, /<iframe[^>]*sandbox[^>]*>/);
  });

  test('renderPlanFolder writes plan.builder.html next to the plan', () => {
    const result = renderPlanFolder(dir);
    assert.equal(result.outFile, path.join(dir, 'plan.builder.html'));
    assert.ok(fs.existsSync(result.outFile));
    assert.ok(fs.readFileSync(result.outFile, 'utf8').startsWith('<!DOCTYPE html>'));
  });

  test('renderPlanFolder on a missing plan.mdx reports an error without throwing', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-plan-builder-empty-'));
    try {
      let result;
      assert.doesNotThrow(() => { result = renderPlanFolder(empty); });
      assert.match(result.error, /no plan\.mdx/);
      assert.equal(result.outFile, undefined);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  test('modes lists bdb-plan-builder as available', async () => {
    const result = await runCommand(['modes']);
    assert.equal(result.code, 0);
    const output = JSON.parse(result.stdout);
    const builder = output.modes.find(m => m.id === 'bdb-plan-builder');
    assert.ok(builder);
    assert.strictEqual(builder.available, true);
    assert.strictEqual(builder.reason, null);
  });

  test('open --mode bdb-plan-builder builds the artifact and returns status open', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-plan-builder-state-'));
    const port = await freePort();
    const outFile = path.join(dir, 'plan.builder.html');
    fs.rmSync(outFile, { force: true });
    try {
      const result = await runCommand(
        ['open', dir, '--mode', 'bdb-plan-builder', '--no-open'],
        { AOS_PLAN_CANVAS_STATE_DIR: stateDir, AOS_PLAN_CANVAS_PORT: String(port) },
        dir
      );
      assert.equal(result.code, 0, result.stdout + result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.status, 'open');
      assert.equal(output.mode, 'bdb-plan-builder');
      assert.equal(output.artifact, outFile);
      assert.equal(output.browser, 'not opened');
      assert.ok(fs.existsSync(outFile));
      const stop = await runCommand(['stop'], { AOS_PLAN_CANVAS_STATE_DIR: stateDir, AOS_PLAN_CANVAS_PORT: String(port) }, dir);
      assert.equal(stop.code, 0);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test('open --mode bdb-plan-builder without plan.mdx exits 2', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-plan-builder-noplan-'));
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-plan-builder-state-'));
    const port = await freePort();
    try {
      const result = await runCommand(
        ['open', empty, '--mode', 'bdb-plan-builder', '--no-open'],
        { AOS_PLAN_CANVAS_STATE_DIR: stateDir, AOS_PLAN_CANVAS_PORT: String(port) },
        empty
      );
      assert.equal(result.code, 2);
      const output = JSON.parse(result.stdout);
      assert.match(output.error, /no plan\.mdx/);
      assert.match(result.stderr, /plan\.mdx/);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});