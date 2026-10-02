import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = path.join(root, 'skills/global_config/plan-canvas/scripts/lib/plan-canvas');
const { cleanSrcLoc, cleanText, normalizeAnnotation, normalizeOrigin } = require(path.join(lib, 'annotation-schema.js'));
const { normalizeFeedbackItem } = require(path.join(lib, 'sessions.js'));

const APP = 'http://localhost:5173';
const base = () => ({ text: 'bigger', anchor: { selector: 'main > button', tag: 'button', snippet: 'Sign up' } });
const app = raw => normalizeAnnotation(raw, { origin: 'app', boundOrigin: APP });

describe('annotation schema', () => {
  test('old-shape annotation (no shapes, no target) stays valid', () => {
    const out = normalizeAnnotation(base());
    assert.equal(out.text, 'bigger');
    assert.deepEqual(out.target, { origin: 'canvas', url: null });
    assert.equal(out.shapes, undefined);
  });

  test('anchor caps, tag rule, class filter and unknown keys', () => {
    const out = normalizeAnnotation({
      text: 'x',
      evil: 1,
      anchor: {
        selector: 's'.repeat(900),
        tag: 'BUTTON<script>',
        snippet: 'n'.repeat(900),
        classes: ['ok', 'bad class', '<x>', ...Array.from({ length: 30 }, (_, i) => `c${i}`)],
        textRange: { text: 't'.repeat(3000), extra: 1 },
        extra: 1
      }
    });
    assert.equal(out.anchor.selector.length, 500);
    assert.equal(out.anchor.tag, '');
    assert.equal(out.anchor.snippet.length, 400);
    assert.equal(out.anchor.classes.length, 12);
    assert.ok(!out.anchor.classes.includes('bad class'));
    assert.equal(out.anchor.textRange.text.length, 1000);
    assert.equal(out.evil, undefined);
    assert.deepEqual(Object.keys(out.anchor.textRange), ['text']);
    assert.equal(normalizeAnnotation({ ...base(), anchor: { ...base().anchor, tag: 'text' } }).anchor.tag, 'text');
  });

  test('text is required, capped at 4000, controls and bidi stripped', () => {
    assert.equal(normalizeAnnotation({ ...base(), text: '' }), null);
    assert.equal(normalizeAnnotation({ ...base(), text: '\u0000‮​' }), null);
    assert.equal(normalizeAnnotation({ ...base(), text: 'a'.repeat(9000) }).text.length, 4000);
    assert.equal(cleanText('a\u0000b‮c​d\u0085e\u007ff'), 'abcdef');
    assert.equal(cleanText('line1\nline2\t3'), 'line1 line2 3');
    assert.equal(cleanText(42), '');
    assert.equal(normalizeAnnotation({ ...base(), anchor: null }), null);
    assert.equal(normalizeAnnotation({ ...base(), anchor: { selector: 5 } }), null);
    assert.equal(normalizeAnnotation('nope'), null);
  });

  test('target.origin comes from the endpoint, never from the body', () => {
    const forged = { ...base(), target: { origin: 'canvas', url: 'http://localhost:5173/x' } };
    assert.equal(app(forged).target.origin, 'app');
    const forgedApp = { ...base(), target: { origin: 'app', url: 'http://localhost:5173/x' } };
    assert.deepEqual(normalizeAnnotation(forgedApp).target, { origin: 'canvas', url: null });
  });

  test('app target.url: bound origin, pathname only, else fallback', () => {
    const url = u => app({ ...base(), target: { url: u } }).target.url;
    assert.equal(url('http://localhost:5173/signup?token=1#h'), 'http://localhost:5173/signup');
    assert.equal(url('http://user:pw@localhost:5173/a'), 'http://localhost:5173/a');
    for (const bad of ['javascript:alert(1)', 'https://localhost:5173/', 'http://localhost:5174/', 'http://evil.test:5173/', 'http://localhost/', 42, `http://localhost:5173/${'a'.repeat(400)}`]) {
      assert.equal(url(bad), APP, String(bad));
    }
    assert.equal(app({ ...base() }).target.url, APP);
  });

  test('srcLoc: valid kept, hostile dropped', () => {
    const src = s => app({ ...base(), target: { srcLoc: s } }).target.srcLoc;
    assert.equal(src('src/Signup.jsx:42'), 'src/Signup.jsx:42');
    for (const bad of ['../x.js:1', '/etc/passwd:1', '.env.js:1', 'node_modules/a/b.js:1', 'file:///x.js:1', 'src/a.js', 'a'.repeat(300) + '.js:1']) {
      assert.equal(src(bad), undefined, bad);
    }
  });

  test('srcLoc parity with bdb-visual-edit sanitize-element', async () => {
    const mod = await import(pathToFileURL(path.join(root, 'skills/global_config/bdb-visual-edit/scripts/sanitize-element.mjs')));
    const corpus = ['src/A.jsx:1', 'src/a/b-c.tsx:10:5', '../x.js:1', '/abs/x.js:1', '.git/config:1', 'node_modules/x/y.js:1', 'x.js:', 'a b.js:1', 'src/a.js:1\n', 'file:///x.js:1', 42, null];
    for (const c of corpus) assert.equal(cleanSrcLoc(c), mod.cleanSrcLoc(c), String(c));
  });

  test('shapes: every type, clamp, round, color enum', () => {
    const shapes = [
      { type: 'element' },
      { type: 'text', points: [[9, 9]] },
      { type: 'rect', points: [[0, 0], [1.123456, 99]], color: 'red' },
      { type: 'arrow', points: [[-0.5, -1.2], [0.5, 0.5]], color: 'magenta' },
      { type: 'freehand', points: [[0, 0], [0.1, 0.2], [0.3, -50]] },
      { type: 'blur', points: [[0, 0], [1, 1]] },
      { type: 'comment', points: [[0.5, 0.5]] }
    ];
    const out = normalizeAnnotation({ ...base(), shapes });
    assert.equal(out.shapes.length, 7);
    assert.equal(out.shapes[0].points, undefined);
    assert.equal(out.shapes[1].points, undefined);
    assert.deepEqual(out.shapes[2].points, [[0, 0], [1.1235, 5]]);
    assert.equal(out.shapes[2].color, 'red');
    assert.equal(out.shapes[3].color, undefined);
    assert.deepEqual(out.shapes[4].points[2], [0.3, -4]);
  });

  test('shapes: bad input rejects the whole item', () => {
    const bad = [
      [],
      'arrow',
      [{ type: 'laser', points: [[0, 0], [1, 1]] }],
      [{ type: 'arrow', points: [[0, 0]] }],
      [{ type: 'rect', points: [[0, 0], [1, 1], [2, 2]] }],
      [{ type: 'comment', points: [] }],
      [{ type: 'arrow', points: [[0, NaN], [1, 1]] }],
      [{ type: 'arrow', points: [[0, Infinity], [1, 1]] }],
      [{ type: 'arrow', points: [['0', 0], [1, 1]] }],
      [{ type: 'arrow', points: [[0, 0, 0], [1, 1]] }],
      [{ type: 'arrow', points: null }],
      [{ type: '__proto__', points: [[0, 0], [1, 1]] }],
      [{ type: 'constructor', points: [[0, 0], [1, 1]] }],
      Array.from({ length: 17 }, () => ({ type: 'element' })),
      [{ type: 'freehand', points: Array.from({ length: 513 }, () => [0, 0]) }],
      Array.from({ length: 5 }, () => ({ type: 'freehand', points: Array.from({ length: 500 }, () => [0, 0]) })),
      [null]
    ];
    bad.forEach((shapes, i) => assert.equal(normalizeAnnotation({ ...base(), shapes }), null, `case ${i}`));
    const maxed = Array.from({ length: 4 }, () => ({ type: 'freehand', points: Array.from({ length: 512 }, () => [0, 0]) }));
    assert.notEqual(normalizeAnnotation({ ...base(), shapes: maxed }), null, '2048 total points allowed');
  });

  test('prototype-pollution keys are inert', () => {
    const raw = JSON.parse(
      '{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}},"text":"x",' +
        '"anchor":{"selector":"a","__proto__":{"polluted":1}},"shapes":[{"type":"rect","points":[[0,0],[1,1]],"__proto__":{"polluted":1}}],' +
        '"target":{"__proto__":{"origin":"canvas"},"constructor":"x"},"viewport":{"__proto__":{"w":1}},"page":{"__proto__":{"x":1}}}'
    );
    const out = app(raw);
    assert.equal({}.polluted, undefined);
    assert.equal(out.polluted, undefined);
    assert.equal(Object.hasOwn(out, '__proto__'), false);
    assert.equal(out.viewport, undefined);
    assert.equal(out.page, undefined);
    assert.equal(out.target.origin, 'app');
    assert.deepEqual(Object.keys(out.shapes[0]).sort(), ['points', 'type']);
  });

  test('viewport and page: bounds, rounding, dropped when invalid', () => {
    const ok = normalizeAnnotation({ ...base(), viewport: { w: 1440.4, h: 900, dpr: 2 }, page: { x: -5, y: 1180.6, w: 240, h: 9e9 } });
    assert.deepEqual(ok.viewport, { w: 1440, h: 900, dpr: 2 });
    assert.deepEqual(ok.page, { x: 0, y: 1181, w: 240, h: 100000 });
    for (const viewport of [{ w: 0, h: 1, dpr: 1 }, { w: 1, h: 1, dpr: 9 }, { w: 1, h: 1, dpr: 0.1 }, { w: NaN, h: 1, dpr: 1 }, { w: '1', h: 1, dpr: 1 }, { w: 1, h: 1 }]) {
      assert.equal(normalizeAnnotation({ ...base(), viewport }).viewport, undefined);
    }
    assert.equal(normalizeAnnotation({ ...base(), page: { x: 1, y: 1, w: Infinity, h: 1 } }).page, undefined);
  });

  test('normalizeOrigin accepts only exact loopback http origins', () => {
    assert.equal(normalizeOrigin('http://localhost:5173'), 'http://localhost:5173');
    assert.equal(normalizeOrigin('http://LOCALHOST:5173'), 'http://localhost:5173');
    assert.equal(normalizeOrigin('http://127.0.0.1:1024'), 'http://127.0.0.1:1024');
    assert.equal(normalizeOrigin('http://[::1]:65535'), 'http://[::1]:65535');
    for (const bad of ['http://localhost:5173/', 'http://localhost:5173/x', 'https://localhost:5173', 'http://localhost', 'http://localhost:80', 'http://localhost:1023', 'http://localhost:65536', 'http://evil.test:5173', 'http://localhost.evil.test:5173', 'http://localhost:5173@evil.test', 'null', '*', '', null, undefined, 5173]) {
      assert.equal(normalizeOrigin(bad), null, String(bad));
    }
  });
});

describe('normalizeFeedbackItem with origin context', () => {
  test('app origin accepts annotations only', () => {
    const ctx = { origin: 'app', boundOrigin: APP };
    assert.equal(normalizeFeedbackItem({ kind: 'chat', text: 'hi' }, 1, ctx), null);
    assert.equal(normalizeFeedbackItem({ kind: 'verdict', verdict: 'approve' }, 1, ctx), null);
    assert.equal(normalizeFeedbackItem({ kind: 'bogus', text: 'x' }, 1, ctx), null);
    const item = normalizeFeedbackItem({ kind: 'annotation', ...base() }, 7, ctx);
    assert.equal(item.id, 'fb-7');
    assert.equal(item.kind, 'annotation');
    assert.equal(item.target.origin, 'app');
    assert.match(item.at, /^\d{4}-\d\d-\d\dT/);
  });

  test('canvas origin keeps chat and verdict behaviour', () => {
    assert.equal(normalizeFeedbackItem({ kind: 'chat', text: 'hi' }, 1).text, 'hi');
    assert.equal(normalizeFeedbackItem({ kind: 'verdict', verdict: 'approve' }, 2).verdict, 'approve');
    assert.equal(normalizeFeedbackItem({ kind: 'verdict', verdict: 'nope' }, 3), null);
    assert.equal(normalizeFeedbackItem({ kind: 'annotation', ...base() }, 4).target.origin, 'canvas');
  });
});
