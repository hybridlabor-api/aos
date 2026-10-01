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

  describe('board view', () => {
    const CANVAS = '<DesignBoard transitions={[{"from":"a","to":"b","label":"go <next>"}]}><Section title="Entry"><Artboard id="a" title="One"><Screen surface="mobile" html={\'<div>x</div>\'} /></Artboard><Artboard id="b" title="Two"><Screen surface="mobile" html={\'<div>y</div>\'} /></Artboard></Section></DesignBoard>';
    const VOID = new Set(['meta', 'br', 'hr', 'img', 'input', 'link', 'path', 'circle']);

    function balanced(html) {
      const stripped = html
        .replace(/<script[\s\S]*?<\/script>/g, '<script></script>')
        .replace(/<style[\s\S]*?<\/style>/g, '<style></style>')
        .replace(/<!DOCTYPE[^>]*>/i, '');
      const stack = [];
      for (const m of stripped.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
        const [, close, name, rest] = m;
        if (close) assert.equal(stack.pop(), name, `unbalanced </${name}>`);
        else if (!VOID.has(name) && !rest.endsWith('/')) stack.push(name);
      }
      assert.deepEqual(stack, []);
    }

    test('canvas plan gets a board, plain plan does not', () => {
      const withCanvas = renderPlanSource({ plan: '# T', canvas: CANVAS });
      assert.match(withCanvas.html, /<section class="board"/);
      assert.match(withCanvas.html, /<h3 class="btitle">1 · Entry<\/h3>/);
      const plain = renderPlanSource({ plan: FIXTURE_PLAN });
      assert.ok(!plain.html.includes('class="board"'));
      assert.ok(!plain.html.includes('board-client') && !plain.html.includes("classList.add('js')"), 'no board script on a plain plan');
    });

    test('arrows only when the plan states transitions', () => {
      const linked = renderPlanSource({ plan: '# T', canvas: CANVAS });
      assert.equal((linked.html.match(/class="edge"/g) || []).length, 1);
      assert.match(linked.html, /<marker id="bm-arrow-1"/);
      assert.match(linked.html, /marker-end="url\(#bm-arrow-1\)"/);
      assert.ok(linked.html.includes('go &lt;next&gt;'));
      assert.ok(!linked.html.includes('go <next>'));
      const bare = renderPlanSource({ plan: '# T', canvas: CANVAS.replace(/ transitions=\{.*?\}>/, '>') });
      assert.ok(bare.html.includes('class="board"'));
      assert.ok(!bare.html.includes('<svg'), 'no relation data, no arrows');
      const dangling = renderPlanSource({ plan: '# T', canvas: CANVAS.replace('"to":"b"', '"to":"zzz"') });
      assert.ok(!dangling.html.includes('class="edge"'));
      assert.ok(dangling.warnings.some(w => w.includes('unknown card')));
    });

    test('diagram nodes and edges become cards and arrows', () => {
      const plan = '## Flow {#board}\n\n<Diagram data={{"nodes":[{"id":"x","label":"Start"},{"id":"y","label":"End"}],"edges":[{"from":"x","to":"y","label":"then"}]}} />\n\n## After\n\nprose';
      const { html } = renderPlanSource({ plan });
      assert.match(html, /<section class="board"/);
      assert.equal((html.match(/class="edge"/g) || []).length, 1);
      assert.match(html, /<h2[^>]* class="sec" id="flow">Flow<\/h2>/, 'board marker stripped from the heading');
      assert.ok(html.indexOf('id="after"') > html.indexOf('</section>'), 'prose after the group stays in the document');
    });

    test('a block with the board prop is boarded', () => {
      const { html } = renderPlanSource({ plan: '<Mermaid board source="flowchart LR\\nA-->B" />' });
      assert.match(html, /<section class="board"/);
    });

    test('zoom controls, readout and labelled buttons are present', () => {
      const { html } = renderPlanSource({ plan: '# T', canvas: CANVAS });
      assert.match(html, /<output class="zoom-readout"[^>]*>100%<\/output>/);
      for (const mode of ['in', 'out', 'fit', 'reset']) {
        assert.match(html, new RegExp(`<button type="button" data-zoom="${mode}" aria-label="[^"]+"`));
      }
    });

    test('board script leaves clicks on cards to the annotation layer', () => {
      const { html } = renderPlanSource({ plan: '# T', canvas: CANVAS });
      const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
      const clicks = [...script.matchAll(/(\S+)\.addEventListener\('click'/g)].map(m => m[1]);
      assert.deepEqual(clicks, ['btn'], 'only the zoom buttons listen for click');
      assert.ok(!/bcard[^\n]*addEventListener/.test(script));
      for (const m of script.matchAll(/preventDefault/g)) {
        const before = script.slice(Math.max(0, m.index - 450), m.index);
        assert.match(before, /'wheel'|'keydown'/, 'preventDefault only for wheel zoom and Space');
      }
      assert.ok(!/alert|eval\(|fetch\(|XMLHttpRequest/.test(script));
    });

    test('board output stays escaped, sandboxed and well-formed', () => {
      const hostile = '<DesignBoard><Section title="<img src=x onerror=alert(1)>"><Artboard id="a" title="<b>t</b>"><Screen surface="mobile" html={\'<script>alert(3)</script>\'} /></Artboard></Section></DesignBoard>';
      const { html } = renderPlanSource({ plan: '# T', canvas: hostile });
      assert.ok(!html.includes('<img src=x'));
      assert.ok(!html.includes('<script>alert(3)</script>'));
      for (const frame of html.match(/<iframe[^>]*>/g) || []) assert.ok(!frame.includes('allow-scripts'));
      balanced(html);
      balanced(renderPlanSource({ plan: '# T', canvas: CANVAS }).html);
    });

    test('demo plan renders a 4-screen, 3-arrow, 2-section board', () => {
      const demo = path.join(builderDir, 'examples/demo-plan');
      const plan = fs.readFileSync(path.join(demo, 'plan.mdx'), 'utf8');
      const canvas = fs.readFileSync(path.join(demo, 'canvas.mdx'), 'utf8');
      const { html, warnings } = renderPlanSource({ plan, canvas });
      assert.deepEqual(warnings, []);
      assert.equal((html.match(/class="bcard[ "]/g) || []).length, 5);
      assert.equal((html.match(/<iframe/g) || []).length, 4);
      assert.equal((html.match(/class="edge"/g) || []).length, 3);
      assert.ok(html.includes('1 · Auth Entry') && html.includes('2 · Outcome'));
      assert.ok(html.includes('class="mermaid"'));
      balanced(html);
    });

    test('theme adds no blue, green or cyan accents', () => {
      const css = fs.readFileSync(path.join(builderDir, 'theme.css'), 'utf8');
      for (const hex of css.match(/#[0-9a-fA-F]{6}\b/g) || []) {
        const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max - min < 24) continue;
        const hue = max === r ? ((g - b) / (max - min) * 60 + 360) % 360
          : max === g ? (b - r) / (max - min) * 60 + 120
            : (r - g) / (max - min) * 60 + 240;
        assert.ok(hue < 70 || hue > 260, `${hex} (hue ${Math.round(hue)}) is a cool accent`);
      }
    });

    describe('wireframe kit', () => {
      const KIT = /&lt;(FrameScreen|Col|Row|Box|Lines|IconSquare|Divider|StatusBar|TaskRow|Text|Title|Skeleton|Main)\b/;
      const kitCanvas = (inner) => `<DesignBoard><Artboard id="a" label="A" surface="mobile"><Screen surface="mobile" caption="Cap &amp; note"><FrameScreen>${inner}</FrameScreen></Screen></Artboard></DesignBoard>`;

      test('kit tags become structure, never raw tag text', () => {
        const { html, warnings } = renderPlanSource({
          plan: '# T',
          canvas: kitCanvas('<StatusBar /><Col full><Box dashed><Row><IconSquare active /><IconSquare /></Row><Lines n={3} widths={[80, 50]} /></Box><Divider /><TaskRow title="Do it" done note="now" /><Title text="Hi" /><Text value="quiet" tone="muted" /><Skeleton lines={2} /></Col>')
        });
        assert.deepEqual(warnings, []);
        assert.ok(!KIT.test(html), 'raw kit tag text leaked into the page');
        assert.match(html, /<div class="k-col full">/);
        assert.match(html, /<div class="k-box dashed">/);
        assert.equal((html.match(/<i class="k-icon/g) || []).length, 2);
        assert.equal((html.match(/<i class="k-icon on">/g) || []).length, 1, 'only active uses the accent');
        assert.equal((html.match(/<i class="k-bar"/g) || []).length, 5);
        assert.ok(html.includes('width:80%') && html.includes('width:50%'));
        assert.match(html, /<hr class="k-div">/);
        assert.match(html, /class="k-task done"/);
        assert.ok(html.includes('Cap &amp;amp; note') || html.includes('Cap &amp; note'), 'caption rendered');
        assert.ok(!(html.match(/<iframe/g) || []).length, 'kit screens are markup, not frames');
        balanced(html);
      });

      test('an unknown kit tag is a labelled placeholder plus a warning', () => {
        const { html, warnings } = renderPlanSource({ plan: '# T', canvas: kitCanvas('<Sparkle glow />') });
        assert.match(html, /<div class="k-unknown">&lt;Sparkle&gt;<\/div>/);
        assert.ok(warnings.some((w) => w.includes('Sparkle')));
      });

      test('semantic Screen html still renders in the sandboxed frame', () => {
        const { html, warnings } = renderPlanSource({ plan: '# T\n\n<Screen surface="mobile" html={\'<p>plain</p>\'} />' });
        assert.deepEqual(warnings, []);
        assert.match(html, /<iframe[^>]*sandbox[^>]*>/);
        assert.ok(!html.includes('class="kit-screen"'));
      });

      test('hostile text and widths in kit tags stay inert', () => {
        const { html } = renderPlanSource({
          plan: '# T',
          canvas: kitCanvas('<Text value="<img src=x onerror=alert(1)>" /><Title text="<script>alert(9)</script>" /><Lines n={1} widths={["50%;background:url(x)"]} /><Btn label="a&quot;b" />')
        });
        assert.ok(!html.includes('<img src=x'));
        assert.ok(!html.includes('<script>alert(9)</script>'));
        assert.ok(!html.includes('url(x)'));
        assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
        balanced(html);
      });
    });

    describe('absolute board layout', () => {
      const ab = (id, extra) => `<Artboard id="${id}" label="Shot ${id}" surface="mobile" ${extra}><Screen surface="mobile" html={'<p>${id}</p>'} /></Artboard>`;
      const ABS = '<DesignBoard transitions={[{from:"a",to:"b",label:"next"}]}><Section title="Flow" subtitle="Two steps">' +
        ab('a', 'x={100} y={50} width={300} height={200} order={2}') +
        ab('b', 'x={600} y={50} width={300} height={200} order={1}') +
        '</Section><Annotation targetId="a" placement="bottom" title="Note">Mind the gap.</Annotation></DesignBoard>';

      test('positions come from x/y/width/height and the canvas is sized to the bounding box', () => {
        const { html, warnings } = renderPlanSource({ plan: '# T', canvas: ABS });
        assert.deepEqual(warnings, []);
        assert.match(html, /<section class="board board-abs"/);
        assert.match(html, /class="board-canvas abs" style="width:\d+px;min-height:\d+px"/);
        // minX=100, minY=50-28 (label headroom) minus the section label above the artboards.
        const lefts = [...html.matchAll(/class="bcard ab pos" id="[^"]+" style="left:(\d+)px;top:(\d+)px;width:300px;height:200px"/g)];
        assert.equal(lefts.length, 2);
        const [first, second] = lefts.map((m) => [Number(m[1]), Number(m[2])]);
        assert.equal(first[0], 72 + 500, 'order 1 (x=600) is rendered first');
        assert.equal(second[0], 72);
        assert.equal(first[1], second[1]);
        assert.equal((html.match(/class="edge"/g) || []).length, 1);
        balanced(html);
      });

      test('section labels, artboard labels above frames, annotation under its target', () => {
        const { html } = renderPlanSource({ plan: '# T', canvas: ABS });
        assert.match(html, /<div class="sec-title">1 · Flow<\/div><div class="sec-sub">Two steps<\/div>/);
        assert.match(html, /<div class="ab-label"><span class="ab-n">1<\/span>Shot b<\/div>/);
        const frameTop = Number(/id="bc-1-\d+" style="left:72px;top:(\d+)px;width:300px/.exec(html)[1]);
        const note = /class="bcard bnote pos" id="[^"]+" style="left:72px;top:(\d+)px;width:300px"/.exec(html);
        assert.ok(note, 'annotation is placed at its target x');
        assert.equal(Number(note[1]), frameTop + 200 + 16, 'annotation sits 16px under the frame');
        assert.match(html, /<span class="glyph" aria-hidden="true">&#8599;<\/span>Note/);
      });

      test('coordinate-free canvases keep the flow layout; unpositioned artboards go to a tray', () => {
        const flow = renderPlanSource({ plan: '# T', canvas: ABS.replace(/ x=\{\d+\} y=\{\d+\}/g, '') });
        assert.match(flow.html, /class="brow"/);
        assert.ok(!flow.html.includes('class="board-canvas abs"'));
        const mixed = renderPlanSource({ plan: '# T', canvas: ABS.replace('</Section>', ab('c', '') + '</Section>') });
        assert.match(mixed.html, /class="abs-tray"/);
        assert.match(mixed.html, /Shot c/);
        balanced(mixed.html);
      });

      test('unknown connector endpoints still warn and draw nothing', () => {
        const { html, warnings } = renderPlanSource({ plan: '# T', canvas: ABS.replace('"to":"b"', '"to":"zzz"').replace('to:"b"', 'to:"zzz"') });
        assert.ok(!html.includes('class="edge"'));
        assert.ok(warnings.some((w) => w.includes('unknown card')));
      });
    });

    describe('additional blocks', () => {
      test('JS-literal props parse without a warning', () => {
        const blocks = parseMdx("<Checklist items={[{ id: 'i1', label: 'a}', checked: true, },]} />");
        assert.deepEqual(blocks.warnings, []);
        assert.equal(blocks[0].props.items[0].label, 'a}');
      });

      test('Checklist reads the items prop and markdown children', () => {
        const { html, warnings } = renderPlanSource({ plan: '<Checklist title="Ship it" items={[{label:"a",checked:true},"b"]}>\n\n- [x] c\n- [ ] d\n\n</Checklist>' });
        assert.deepEqual(warnings, []);
        assert.equal((html.match(/<li class="done">/g) || []).length, 2);
        assert.equal((html.match(/<span class="cbox"/g) || []).length, 4);
        assert.ok(html.includes('Ship it'));
      });

      test('Table renders columns/rows and markdown children', () => {
        const byProp = renderPlanSource({ plan: '<Table columns={["Name","Kind"]} rows={[["a","<b>x</b>"],{Name:"c",Kind:"d"}]} />' });
        assert.deepEqual(byProp.warnings, []);
        assert.match(byProp.html, /<th>Name<\/th><th>Kind<\/th>/);
        assert.ok(byProp.html.includes('&lt;b&gt;x&lt;/b&gt;') && !byProp.html.includes('<b>x</b>'));
        assert.match(byProp.html, /<td>c<\/td><td>d<\/td>/);
        const byMarkdown = renderPlanSource({ plan: '<Table>\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n</Table>' });
        assert.match(byMarkdown.html, /<th[^>]*>a<\/th>/);
      });

      test('CodeTabs shows every tab with escaped code', () => {
        const { html, warnings } = renderPlanSource({ plan: '<CodeTabs tabs={[{label:"a.ts",language:"ts",code:"<script>1</script>"},{label:"b.ts",code:"x"}]} />' });
        assert.deepEqual(warnings, []);
        assert.ok(html.includes('a.ts') && html.includes('b.ts'));
        assert.ok(html.includes('&lt;script&gt;1&lt;/script&gt;') && !html.includes('<script>1</script>'));
      });

      test('Decision marks the recommended option and keeps hostile text inert', () => {
        const { html } = renderPlanSource({
          plan: '<Decision title="T" question="<img src=x onerror=alert(1)>?" options={[{id:"o1",label:"One",detail:"<b>d</b>"},{id:"o2",label:"Two",recommended:true}]}>\n\nBecause <script>alert(2)</script>.\n\n</Decision>'
        });
        assert.equal((html.match(/<li class="opt rec">/g) || []).length, 1);
        assert.match(html, /Two <span class="badge">recommended<\/span>/);
        assert.ok(html.includes('rationale'));
        assert.ok(!html.includes('<img src=x') && !html.includes('<script>alert(2)</script>') && !html.includes('<b>d</b>'));
      });

      test('HtmlBlock is sandboxed without allow-scripts', () => {
        const { html } = renderPlanSource({ plan: '<HtmlBlock title="Card" html={\'<script>alert(5)</script><b>hi</b>\'} />' });
        const frames = html.match(/<iframe[^>]*>/g) || [];
        assert.equal(frames.length, 1);
        assert.ok(!frames[0].includes('allow-scripts'));
        assert.ok(!html.includes('<script>alert(5)</script>'));
        assert.ok(html.includes('Card'));
      });

      test('ImplementationMap lists files with change badges', () => {
        const { html, warnings } = renderPlanSource({ plan: "<ImplementationMap files={[{ path: 'a/b.ts', change: 'added', note: 'n1', title: 'T1' }, 'plain.ts']} />" });
        assert.deepEqual(warnings, []);
        assert.match(html, /<span class="badge added">added<\/span><span class="path">a\/b\.ts<\/span>/);
        assert.ok(html.includes('T1') && html.includes('n1') && html.includes('plain.ts'));
      });

      test('a malformed ImplementationMap shows its raw text and warns', () => {
        const { html, warnings } = renderPlanSource({ plan: '<ImplementationMap files={[{path: <b>x</b>}]} />' });
        assert.ok(warnings.some((w) => w.includes('ImplementationMap')));
        assert.match(html, /class="card unsupported"/);
        assert.ok(html.includes('[{path: &lt;b&gt;x&lt;/b&gt;}]'), 'raw text visible and escaped');
        assert.ok(!html.includes('<b>x</b>'));
      });
    });

    describe('visual recap', () => {
      const RECAP = '---\ntitle: Recap <b>T</b>\nsubtitle: What changed\nkind: recap\npr: "#9"\nbranch: feat/x\nbase: main\nfiles: 3\nadditions: 12\ndeletions: 4\n---\n\n<Compare beforeLabel="Was" afterLabel="Now" before="old" after="new" />\n\n<Compare>\n<Before>\n\nleft prose\n\n</Before>\n<After>\n\nright prose\n\n</After>\n</Compare>\n\n<Compare>\n\nfirst\n\nsecond\n\n</Compare>';

      test('recap plans get the recap header with chips', () => {
        const { html, warnings } = renderPlanSource({ plan: RECAP });
        assert.deepEqual(warnings, []);
        assert.match(html, /<div class="recap-eyebrow">VISUAL RECAP<\/div>/);
        assert.match(html, /<h1 class="doc-title recap-title">Recap &lt;b&gt;T&lt;\/b&gt;<\/h1>/);
        assert.match(html, /<p class="recap-sub">What changed<\/p>/);
        for (const chip of ['#9', 'feat/x → main', '3 files', '+12', '−4']) assert.ok(html.includes(chip), `missing chip ${chip}`);
        assert.ok(!html.includes('<b>T</b>'));
        balanced(html);
      });

      test('state kind recap works too, and other plans keep the plain title', () => {
        const viaState = renderPlanSource({ plan: '# T', state: { kind: 'recap' }, title: 'From state' });
        assert.match(viaState.html, /recap-head/);
        assert.ok(!renderPlanSource({ plan: FIXTURE_PLAN }).html.includes('<header class="recap-head">'));
      });

      test('Compare renders Before and After columns from props, tags and paired blocks', () => {
        const { html } = renderPlanSource({ plan: RECAP });
        assert.equal((html.match(/<div[^>]* class="compare">/g) || []).length, 3);
        assert.equal((html.match(/cmp-side before/g) || []).length, 3);
        assert.equal((html.match(/cmp-side after/g) || []).length, 3);
        assert.ok(html.includes('>Was</div>') && html.includes('>Now</div>'));
        for (const probe of ['old', 'new', 'left prose', 'right prose', 'first', 'second']) assert.ok(html.includes(probe), probe);
      });
    });

    describe('examples', () => {
      const load = (name) => {
        const dir = path.join(builderDir, 'examples', name);
        const read = (file) => (fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), 'utf8') : undefined);
        return renderPlanSource({ plan: read('plan.mdx'), canvas: read('canvas.mdx') });
      };

      test('signup-storyboard: 6 positioned artboards, 2 sections, 5 arrows, 2 annotations', () => {
        const { html, warnings } = load('signup-storyboard');
        assert.deepEqual(warnings, []);
        assert.equal((html.match(/class="bcard ab pos"/g) || []).length, 6);
        assert.equal((html.match(/class="sec-title"/g) || []).length, 2);
        assert.equal((html.match(/class="edge"/g) || []).length, 5);
        assert.equal((html.match(/<div class="annot">/g) || []).length, 2);
        assert.ok(!/&lt;(FrameScreen|Col|Row|Box|Lines|Btn)\b/.test(html));
        assert.ok(!(html.match(/<iframe/g) || []).length);
        balanced(html);
      });

      test('recap-demo: recap header and before/after', () => {
        const { html, warnings } = load('recap-demo');
        assert.deepEqual(warnings, []);
        assert.match(html, /VISUAL RECAP/);
        assert.match(html, /class="cmp-side before"/);
        assert.match(html, /class="cmp-side after"/);
        balanced(html);
      });
    });
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

  test('await, typing and end accept the plan folder or plan.mdx, not only the built html', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-plan-builder-state-'));
    const port = await freePort();
    const env = { AOS_PLAN_CANVAS_STATE_DIR: stateDir, AOS_PLAN_CANVAS_PORT: String(port) };
    try {
      const opened = await runCommand(['open', dir, '--mode', 'bdb-plan-builder', '--no-open'], env, dir);
      assert.equal(opened.code, 0, opened.stdout + opened.stderr);
      for (const target of [dir, path.join(dir, 'plan.mdx')]) {
        const waiting = await runCommand(['await', target, '--timeout-ms', '200'], env, dir);
        assert.equal(waiting.code, 0, waiting.stdout + waiting.stderr);
        assert.equal(JSON.parse(waiting.stdout).status, 'waiting', `await ${target}`);
      }
      const ended = await runCommand(['end', dir], env, dir);
      assert.equal(ended.code, 0, ended.stdout + ended.stderr);
      assert.equal(JSON.parse(ended.stdout).status, 'ended');
      await runCommand(['stop'], env, dir);
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
  test('polish: sticky bars are opaque and compare columns share one row', () => {
    const css = fs.readFileSync(path.join(builderDir, 'theme.css'), 'utf8');
    const topbar = css.match(/^\.topbar \{[^}]*\}/m)[0];
    assert.match(topbar, /position: sticky/);
    assert.match(topbar, /background: var\(--paper\)/);
    assert.doesNotMatch(topbar, /rgba/);
    assert.match(css.match(/^\.sidenav \{[^}]*\}/m)[0], /background: var\(--paper\)/);
    assert.match(css, /\.flow > \.compare::before[^{]*\{ display: none; \}/);
    const { html } = renderPlanSource({ plan: '# T\n\n<Compare beforeLabel="Old" afterLabel="New">\n<Before>\nold\n</Before>\n<After>\nnew\n</After>\n</Compare>\n' });
    const compareAt = html.search(/<div[^>]* class="compare">/);
    const compare = html.slice(compareAt, compareAt + 800);
    assert.equal((compare.match(/class="cmp-side /g) || []).length, 2);
    assert.match(compare, /cmp-side before.*cmp-side after/s);
  });

  test('polish: mermaid theme sets label backgrounds to the card color', () => {
    const { html } = renderPlanSource({ plan: FIXTURE_PLAN });
    assert.match(html, /edgeLabelBackground: '#161616'/);
    assert.match(html, /labelBoxBkgColor: '#161616'/);
    assert.match(html, /useMaxWidth: true/);
    assert.match(html, /critBkgColor: '#6a2285'/);
  });

  test('polish: show-control network table has no empty detail cell', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-plan-builder-sc-'));
    try {
      fs.copyFileSync(path.join(builderDir, 'templates/show-control/plan.mdx'), path.join(out, 'plan.mdx'));
      const html = fs.readFileSync(renderPlanFolder(out).htmlPath || path.join(out, 'plan.builder.html'), 'utf8');
      const card = html.match(/Network layout.*?<\/table>/s)[0];
      const cells = [...card.matchAll(/<tr><td[^>]*>.*?<\/td><td[^>]*>(.*?)<\/td><\/tr>/gs)].map((m) => m[1].trim());
      assert.ok(cells.length >= 7);
      assert.ok(cells.every(Boolean), 'empty detail cell: ' + JSON.stringify(cells));
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});
describe('plan source anchors', () => {
  const SRC = '---\ntitle: T\n---\n\n# Top\n\nprose line\n\n## Two <img src=x onerror=1> "q"\n\n<Callout title="c">\nhi\n</Callout>\n\n<Code code="y" />\n';

  test('parser records the real 1-based source line of every block', () => {
    const blocks = parseMdx(SRC);
    assert.deepEqual(blocks.map((b) => [b.type, b.line]), [['heading', 5], ['prose', 7], ['heading', 9], ['tag', 11], ['tag', 15]]);
    assert.equal(blocks[3].children[0].line, 12);
  });

  test('rendered blocks carry unique valid ids and data-src with the matching line', () => {
    const { html } = renderPlanSource({ plan: SRC, canvas: '<Code code="c" />\n' });
    const ids = [...html.matchAll(/ id="(src-[^"]*)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, /^src-(plan|canvas)\.mdx-L\d{1,6}$/);
    for (const line of [7, 11, 15]) assert.ok(html.includes(`id="src-plan.mdx-L${line}" data-src="plan.mdx:${line}"`), `line ${line}`);
    assert.ok(html.includes('data-src="plan.mdx:5"'));
    assert.ok(html.includes('data-src="plan.mdx:9"'));
    assert.ok(html.includes('id="src-canvas.mdx-L1"'));
    for (const m of html.matchAll(/data-src="([^"]*)"/g)) assert.match(m[1], /^[A-Za-z0-9_.-]+\.mdx:\d{1,6}$/);
  });

  test('hostile heading text cannot reach an id or data-src', () => {
    const { html } = renderPlanSource({ plan: '## x" onmouseover="alert(1)\n\ntext\n' });
    assert.ok(!/data-src="[^"]*onmouseover/.test(html));
    assert.ok(!/ id="src-[^"]*onmouseover/.test(html));
    assert.ok(!html.includes('<h2 data-src="plan.mdx:1" class="sec" id="x" onmouseover'));
  });
});
