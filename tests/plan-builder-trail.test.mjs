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
const require = createRequire(import.meta.url);
const { renderPlanSource, renderPlanFolder } = require(path.join(builderDir, 'index.js'));

// agenttrail.mjs starts a daemon on import, so lift its real parser out of the source.
const trailSrc = fs.readFileSync(path.join(root, 'skills/global_config/agenttrail/bin/agenttrail.mjs'), 'utf8');
const parserSrc = trailSrc.slice(trailSrc.indexOf('const NODE_RE'), trailSrc.indexOf('// ---------- live state'));
const parsePlan = new Function(`${parserSrc}; return parsePlan;`)();

const PLAN = `---
title: Checkout rewrite
needs-payments: cart
---

# Checkout rewrite

## Shopping cart {#cart}

<ImplementationMap files={[{"path":"src/cart.ts","change":"modified"},{"path":"src/cart-ui.tsx"}]} />

<Checklist items={["Totals are correct {#cart-totals}", {"label":"Empty state","checked":true}]} />

## Payments {#payments}

<ImplementationMap files={['src/pay/**']} />

<Checklist>
- [ ] Charge the card
- [ ] Refund path {#refunds}
</Checklist>

<Section id="receipts" title="Receipts" needs={["payments", "ghost"]}>
<Checklist items={["Send email"]} />
</Section>

## Plain prose heading

No id here.
`;

function run(args, cwd) {
  const r = spawnSync(process.execPath, [scriptPath, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('plan-canvas trail', () => {
  let ws;
  let plan;

  before(() => {
    ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aos-trail-')));
    plan = path.join(ws, 'plans', 'checkout');
    fs.mkdirSync(plan, { recursive: true });
    fs.writeFileSync(path.join(plan, 'plan.mdx'), PLAN);
  });
  after(() => fs.rmSync(ws, { recursive: true, force: true }));

  test('default output parses back with the agenttrail parser', () => {
    const r = run(['trail', 'plans/checkout'], ws);
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.out, 'production_artifacts/00_execution_plan.md');
    assert.equal(out.components, 3);
    assert.equal(out.tasks, 5);
    assert.equal(out.next_step, 'aos-trail . --plan production_artifacts/00_execution_plan.md --no-open');

    const text = fs.readFileSync(path.join(ws, out.out), 'utf8');
    const { nodes, title } = parsePlan(text);
    assert.equal(title, 'Checkout rewrite');
    const comps = nodes.filter((n) => n.level === 'component');
    assert.deepEqual(comps.map((c) => c.id), ['cart', 'payments', 'receipts']);
    assert.deepEqual(comps[0].files, ['src/cart.ts', 'src/cart-ui.tsx']);
    assert.deepEqual(comps[1].needs, ['cart']);
    assert.deepEqual(comps[1].files, ['src/pay/**']);
    assert.deepEqual(comps[2].needs, ['payments']);
    const tasks = nodes.filter((n) => n.level === 'task');
    assert.deepEqual(tasks.map((t) => [t.id, t.parent, t.status]), [
      ['cart-totals', 'cart', 'pending'],
      ['cart-empty-state', 'cart', 'done'],
      ['payments-charge-the-card', 'payments', 'pending'],
      ['refunds', 'payments', 'pending'],
      ['receipts-send-email', 'receipts', 'pending']
    ]);
    assert.equal(tasks[0].title, 'Totals are correct');
    assert.ok(text.includes('## Shopping cart {#cart}\nfiles: [src/cart.ts, src/cart-ui.tsx]\n- [ ] Totals are correct {#cart-totals}'));
  });

  test('a Checklist or ImplementationMap outside any component is reported, not silently dropped', () => {
    const orphan = path.join(ws, 'plans', 'orphan');
    fs.mkdirSync(orphan, { recursive: true });
    fs.writeFileSync(path.join(orphan, 'plan.mdx'), [
      '## Real component {#real}', '',
      '<Checklist items={["task a"]} />', '',
      '## Acceptance', '',
      '<Checklist items={["lost task"]} />', '',
      '<ImplementationMap files={[{ path: "lost/file.ts" }]} />', ''
    ].join('\n'));
    const r = run(['trail', 'plans/orphan', '--out', 'out/orphan-plan.md'], ws);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.ok((out.warnings || []).some((w) => /Checklist is not under a component/.test(w)), r.stdout);
    assert.ok((out.warnings || []).some((w) => /ImplementationMap is not under a component/.test(w)), r.stdout);
    const file = fs.readFileSync(path.join(ws, 'out', 'orphan-plan.md'), 'utf8');
    assert.ok(file.includes('task a'));
    assert.ok(!file.includes('lost task'));
  });

  test('refuses to overwrite without --force, then overwrites with it', () => {
    const again = run(['trail', 'plans/checkout'], ws);
    assert.equal(again.code, 2);
    assert.match(again.stderr, /already exists.*--force/);
    assert.equal(run(['trail', 'plans/checkout', '--force'], ws).code, 0);
  });

  test('--out must resolve inside the workspace root', () => {
    for (const out of ['../escape.md', path.join(os.tmpdir(), 'aos-trail-escape.md'), 'production_artifacts/../../x.md']) {
      const r = run(['trail', 'plans/checkout', '--out', out], ws);
      assert.equal(r.code, 2, out);
      assert.match(r.stderr, /inside the workspace root/);
    }
    assert.ok(!fs.existsSync(path.join(path.dirname(ws), 'escape.md')));
  });

  test('--out through a symlink that leaves the workspace is refused', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-trail-out-'));
    try {
      fs.symlinkSync(outside, path.join(ws, 'link'));
      const r = run(['trail', 'plans/checkout', '--out', 'link/plan.md'], ws);
      assert.equal(r.code, 2);
      assert.deepEqual(fs.readdirSync(outside), []);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('custom --out inside the workspace works', () => {
    const r = run(['trail', 'plans/checkout/plan.mdx', '--out', 'docs/trail.md'], ws);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).next_step, 'aos-trail . --plan docs/trail.md --no-open');
  });

  test('empty, missing and unknown input exit 2', () => {
    const empty = path.join(ws, 'plans', 'empty');
    fs.mkdirSync(empty, { recursive: true });
    fs.writeFileSync(path.join(empty, 'plan.mdx'), '# Nothing\n\n## No id here\n');
    const r1 = run(['trail', 'plans/empty', '--out', 'e.md'], ws);
    assert.equal(r1.code, 2);
    assert.match(r1.stderr, /no components found/);
    assert.ok(!fs.existsSync(path.join(ws, 'e.md')));
    assert.equal(run(['trail', 'plans/nope'], ws).code, 2);
    assert.equal(run(['trail'], ws).code, 2);
  });

  test('hostile titles and tasks stay on one line and parse', () => {
    const dir = path.join(ws, 'plans', 'hostile');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dir + '/plan.mdx', [
      '## Evil <script>alert(1)</script> {#evil}',
      '',
      '<Checklist items={["line one\\n## Injected {#inj}\\n- [ ] sneaky {#sneak}"]} />',
      '<ImplementationMap files={["ok.js", "a, b", "x]"]} />'
    ].join('\n'));
    const r = run(['trail', 'plans/hostile', '--out', 'h.md'], ws);
    assert.equal(r.code, 0, r.stderr);
    const { nodes } = parsePlan(fs.readFileSync(path.join(ws, 'h.md'), 'utf8'));
    assert.deepEqual(nodes.filter((n) => n.level === 'component').map((c) => c.id), ['evil']);
    assert.equal(nodes.filter((n) => n.level === 'task').length, 1);
    assert.deepEqual(nodes[0].files, ['ok.js']);
  });
});

describe('prototype hint', () => {
  const board = (surface, fm = '') => `${fm}# P\n\n<Artboard id="a" label="Login page"><Screen surface="${surface}" html={'<p>x</p>'} /></Artboard>\n`;
  const count = (html) => (html.match(/Suggested next step/g) || []).length;

  test('appears once for web and desktop screens and names them', () => {
    for (const surface of ['web', 'desktop']) {
      const { html } = renderPlanSource({ plan: board(surface) });
      assert.equal(count(html), 1, surface);
      assert.match(html, /Login page/);
      assert.match(html, /<code>prototype<\/code> skill/);
    }
  });

  test('absent for mobile-only plans and for prototype: skip', () => {
    assert.equal(count(renderPlanSource({ plan: board('mobile') }).html), 0);
    assert.equal(count(renderPlanSource({ plan: board('web', '---\nprototype: skip\n---\n') }).html), 0);
  });

  test('prototype: suggest forces it; names are escaped', () => {
    assert.equal(count(renderPlanSource({ plan: board('mobile', '---\nprototype: suggest\n---\n') }).html), 1);
    const plan = '# P\n\n<Screen surface="web" label="<img src=x onerror=alert(1)>" html={"x"} />\n';
    const { html } = renderPlanSource({ plan });
    assert.equal(count(html), 1);
    assert.ok(!html.includes('<img src=x onerror'));
  });
});

describe('Archify block', () => {
  let dir;
  const build = (mdx) => {
    fs.writeFileSync(path.join(dir, 'plan.mdx'), `# A\n\n${mdx}\n`);
    return renderPlanFolder(dir);
  };

  before(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aos-archify-')));
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'arch.html'), '<!doctype html><svg><title>DIAGRAM-MARK</title></svg><script>1</script>');
    fs.writeFileSync(path.join(dir, 'big.html'), 'x'.repeat(5 * 1024 * 1024 + 1));
    fs.writeFileSync(path.join(path.dirname(dir), `${path.basename(dir)}-secret.html`), 'SECRET');
    fs.symlinkSync(path.join(path.dirname(dir), `${path.basename(dir)}-secret.html`), path.join(dir, 'sub', 'leak.html'));
  });
  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(path.join(path.dirname(dir), `${path.basename(dir)}-secret.html`), { force: true });
  });

  test('happy path: sandbox allow-scripts only, caption and link row', () => {
    const r = build('<Archify src="arch.html" label="System map" height={500} />');
    assert.deepEqual(r.warnings, []);
    const frame = r.html.match(/<iframe[^>]*class="archify-frame"[^>]*>/)[0];
    assert.match(frame, /sandbox="allow-scripts"/);
    assert.match(frame, /allow="fullscreen"/);
    assert.match(r.html, /btn-present/, 'fullscreen bridge rides in the escaped srcdoc');
    for (const bad of ['allow-same-origin', 'allow-forms', 'allow-popups', 'allow-top-navigation']) assert.ok(!frame.includes(bad), bad);
    assert.match(frame, /style="height:500px"/);
    assert.ok(!r.html.includes('card archify'), 'the diagram is not wrapped in a card');
    assert.match(r.html, /<figure class="archify-block">/);
    assert.match(r.html, /\.archify-frame \{[^}]*calc\(100vh/);
    assert.match(r.html, /DIAGRAM-MARK/);
        assert.match(r.html, /<a href="arch\.html" target="_blank" rel="noopener noreferrer">open standalone/);
    assert.ok(!r.html.includes('<svg><title>DIAGRAM-MARK'), 'file content rides escaped in srcdoc');
  });

  test('rejects traversal, absolute paths, URLs and symlink escapes', () => {
    for (const src of ['../x.html', 'sub/../../x.html', '/etc/hosts.html', 'C:\\\\x.html', 'https://evil.test/a.html', 'sub/leak.html']) {
      const r = build(`<Archify src="${src}" />`);
      assert.match(r.html, /error-card/, src);
      assert.ok(!r.html.includes('SECRET'), src);
      assert.ok(!r.html.includes('<iframe class="archify-frame" sandbox="allow-scripts"'), src);
      assert.ok(r.warnings.some((w) => w.includes('<Archify')), src);
    }
  });

  test('missing file and wrong extension give a visible card plus a warning', () => {
    const r = build('<Archify src="nope.html" />');
    assert.match(r.html, /file not found/);
    assert.ok(r.warnings.some((w) => /file not found/.test(w)));
    assert.match(build('<Archify src="plan.mdx" />').html, /must be an \.html file/);
    assert.match(build('<Archify />').html, /src is required/);
  });

  test('files over 5 MB are refused', () => {
    const r = build('<Archify src="big.html" />');
    assert.match(r.html, /error-card/);
    assert.match(r.html, /the limit is 5242880/);
    assert.ok(r.warnings.length);
  });

  test('label and src are escaped', () => {
    const r = build(`<Archify src="arch.html" label={"<script>alert(1)</script>"} />`);
    assert.ok(!r.html.includes('<script>alert(1)</script>'));
    assert.match(r.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    const bad = build('<Archify src={"<b>x</b>.html"} />');
    assert.ok(!bad.html.includes('<b>x</b>'));
  });

  test('renderPlanSource without a folder shows an error card', () => {
    const { html, warnings } = renderPlanSource({ plan: '<Archify src="arch.html" />' });
    assert.match(html, /error-card/);
    assert.equal(warnings.length, 1);
  });
});

describe('AgentTrail block', () => {
  let dir;
  const PLAN_MDX = [
    '## Base {#base}', '', '<Checklist items={[{"label":"a","checked":true},"b"]} />', '',
    '## Api {#api}', '', '<Checklist items={["c"]} />', '',
    '## Ui {#ui}', '', '<Checklist items={[{"label":"d","checked":true}]} />', '',
    '## Solo {#solo}', ''
  ].join('\n');
  const FM = '---\nneeds-api: base\nneeds-ui: api, base\n---\n\n';
  const mk = (name, files) => {
    const d = path.join(dir, name);
    fs.mkdirSync(d, { recursive: true });
    for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(d, f), c);
    return d;
  };
  const render = (name, trail, extra = {}) => {
    const d = mk(name, { 'plan.mdx': `${FM}${PLAN_MDX}\n\n${trail}\n`, ...extra });
    return renderPlanFolder(d);
  };
  const nodes = (html) => [...html.matchAll(/<details class="trail-node" data-id="([^"]+)" style="left:([\d.]+)%/g)].map((m) => [m[1], Number(m[2])]);

  before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-agenttrail-')); });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('one card per component and one edge per stated need, none invented', () => {
    const { html } = render('graph', '<AgentTrail />');
    assert.deepEqual(nodes(html).map((n) => n[0]), ['base', 'api', 'ui', 'solo']);
    const edges = [...html.matchAll(/data-from="([^"]+)" data-to="([^"]+)"/g)].map((m) => `${m[1]}>${m[2]}`).sort();
    assert.deepEqual(edges, ['api>ui', 'base>api', 'base>ui']);
  });

  test('columns follow dependency depth', () => {
    const { html } = render('depth', '<AgentTrail />');
    const x = Object.fromEntries(nodes(html));
    assert.ok(x.base === x.solo && x.base < x.api && x.api < x.ui, JSON.stringify(x));
  });

  test('progress counts come from checkbox state', () => {
    const { html } = render('progress', '<AgentTrail />');
    assert.match(html, /data-id="base"[\s\S]*?1 of 2 tasks[\s\S]*?width:50%/);
    assert.match(html, /data-id="ui"[\s\S]*?1 of 1 tasks[\s\S]*?width:100%/);
    assert.match(html, /data-id="solo"[\s\S]*?0 of 0 tasks/);
  });

  test('non-localhost live URL warns and renders no link or iframe', () => {
    for (const live of ['https://evil.example/trail', 'javascript:alert(1)', 'http://localhost.evil.com:5330']) {
      const { html, warnings } = render('badlive', `<AgentTrail live="${live}" embed />`);
      assert.ok(warnings.some((w) => /AgentTrail/.test(w) && /localhost/.test(w)), live);
      assert.ok(!html.includes('Open live agent trail') && !html.includes('class="trail-frame"'), live);
    }
  });

  test('embed adds a sandboxed iframe only for localhost; live alone is link only', () => {
    const linked = render('live', '<AgentTrail live="http://localhost:5331" />').html;
    assert.match(linked, /<a href="http:\/\/localhost:5331\/" target="_blank" rel="noopener">Open live agent trail/);
    assert.ok(!linked.includes('class="trail-frame"'));
    const framed = render('embed', '<AgentTrail live="http://127.0.0.1:5331" embed />').html;
    assert.match(framed, /<iframe class="trail-frame" sandbox="allow-scripts allow-same-origin" loading="lazy"[^>]*src="http:\/\/127\.0\.0\.1:5331\/"/);
  });

  test('plan-derived strings are escaped', () => {
    const d = mk('xss', { 'plan.mdx': '## Evil <script>alert(1)</script> {#evil}\n\n<AgentTrail />\n' });
    const { html } = renderPlanFolder(d);
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.match(html, /Evil &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  test('no components gives a visible card and a warning', () => {
    const d = mk('none', { 'plan.mdx': '# Nothing\n\n<AgentTrail />\n' });
    const { html, warnings } = renderPlanFolder(d);
    assert.match(html, /AgentTrail: no components found - add \{#id\} headings and needs: lines/);
    assert.ok(warnings.some((w) => /AgentTrail.*no components/.test(w)));
  });

  test('renders inside a web Artboard', () => {
    const canvas = '<DesignBoard title="B">\n<Artboard id="t" label="Trail" surface="web" x={0} y={0} width={900} height={400}>\n<AgentTrail />\n</Artboard>\n</DesignBoard>\n';
    const d = mk('board', { 'plan.mdx': `${FM}${PLAN_MDX}\n`, 'canvas.mdx': canvas });
    const { html, warnings } = renderPlanFolder(d);
    assert.match(html, /class="ab-frame">[\s\S]*class="card trail"/);
    assert.deepEqual(nodes(html).map((n) => n[0]), ['base', 'api', 'ui', 'solo']);
    assert.ok(!warnings.some((w) => /AgentTrail|unsupported/.test(w)), warnings.join('|'));
  });
});
