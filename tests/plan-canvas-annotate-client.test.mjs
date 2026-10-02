import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = path.join(root, 'skills/global_config/plan-canvas/scripts/lib/plan-canvas');
const geo = require(path.join(lib, 'annotate-client/geometry.js'));
const model = require(path.join(lib, 'annotate-client/model.js'));
const toolbar = require(path.join(lib, 'annotate-client/toolbar.js'));
const { annotateClientJs } = require(path.join(lib, 'annotate-client/index.js'));
const { artifactSdkJs } = require(path.join(lib, 'sdk.js'));

const box = { left: 100, top: 200, width: 300, height: 50 };
const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

describe('geometry', () => {
  test('anchor units round-trip and are scroll independent', () => {
    for (const pt of [[100, 200], [250, 225], [400, 250], [-50, 900], [1200, 40]]) {
      const back = geo.fromAnchorUnits(geo.toAnchorUnits(pt, box), box);
      if (Math.abs(geo.rawUnits(pt, box)[0]) <= 4 && Math.abs(geo.rawUnits(pt, box)[1]) <= 4) {
        near(back[0], pt[0], 0.02);
        near(back[1], pt[1], 0.01);
      }
    }
    assert.deepEqual(geo.toAnchorUnits([250, 225], box), [0.5, 0.5]);
  });

  test('clamp to [-4, 5], round to 4 decimals, zero-size box and NaN are safe', () => {
    assert.deepEqual(geo.clampPoint([-99, 99]), [-4, 5]);
    assert.deepEqual(geo.clampPoint([NaN, Infinity]), [0, 0]);
    assert.deepEqual(geo.roundPoint([1 / 3, 2 / 3]), [0.3333, 0.6667]);
    assert.deepEqual(geo.toAnchorUnits([5, 5], { left: 0, top: 0, width: 0, height: 0 }), [5, 5]);
  });

  test('fitsAnchor detects points beyond the clamp range', () => {
    assert.equal(geo.fitsAnchor([[250, 225]], box), true);
    assert.equal(geo.fitsAnchor([[100 + 301 * 5, 225]], box), false);
  });

  test('simplify keeps endpoints, removes collinear points and caps at 512', () => {
    const line = Array.from({ length: 100 }, (_, i) => [i / 100, i / 100]);
    const out = geo.simplify(line);
    assert.deepEqual(out, [line[0], line[99]]);
    const noisy = Array.from({ length: 5000 }, (_, i) => [i / 5000, Math.sin(i) * 0.5]);
    const capped = geo.simplify(noisy);
    assert.ok(capped.length <= 512 && capped.length >= 2);
    assert.deepEqual(capped[0], noisy[0]);
    assert.deepEqual(capped.at(-1), noisy.at(-1));
    assert.deepEqual(geo.simplify([[0, 0], [1, 1]]), [[0, 0], [1, 1]]);
    assert.deepEqual(geo.simplify([]), []);
  });
});

describe('shapes and draft', () => {
  test('makeShape enforces type, point counts, finite numbers and colour enum', () => {
    assert.deepEqual(model.makeShape('arrow', [[0, 0], [1, 1]], 'red'), { type: 'arrow', points: [[0, 0], [1, 1]], color: 'red' });
    assert.equal(model.makeShape('arrow', [[0, 0]], 'red'), null);
    assert.equal(model.makeShape('comment', [[0, 0], [1, 1]]), null);
    assert.equal(model.makeShape('rect', [[0, 0], [1, NaN]]), null);
    assert.equal(model.makeShape('rect', [['0', 0], [1, 1]]), null);
    assert.equal(model.makeShape('__proto__', [[0, 0], [1, 1]]), null);
    assert.equal(model.makeShape('constructor', [[0, 0], [1, 1]]), null);
    assert.equal(model.makeShape('element', []), null);
    assert.equal('color' in model.makeShape('rect', [[0, 0], [1, 1]], 'purple'), false);
    assert.deepEqual(model.makeShape('comment', [[9, -9]]).points, [[5, -4]]);
  });

  test('freehand is simplified to at most 512 points', () => {
    const pts = Array.from({ length: 4000 }, (_, i) => [i / 1000, Math.sin(i / 3)]);
    const s = model.makeShape('freehand', pts, 'blue');
    assert.ok(s.points.length >= 2 && s.points.length <= 512);
  });

  test('draft caps: 16 shapes and 2048 points in total', () => {
    const d = model.createDraft();
    for (let i = 0; i < 16; i++) assert.equal(model.draftAdd(d, model.makeShape('rect', [[0, 0], [1, 1]])), '');
    assert.equal(model.draftAdd(d, model.makeShape('rect', [[0, 0], [1, 1]])), 'max-shapes');
    const p = model.createDraft();
    const wiggle = n => Array.from({ length: n }, (_, i) => [i % 2, i / n]);
    for (let i = 0; i < 4; i++) assert.equal(model.draftAdd(p, { type: 'freehand', points: wiggle(512) }), '');
    assert.equal(model.draftAdd(p, { type: 'freehand', points: wiggle(2) }), 'max-points');
    assert.equal(model.draftAdd(p, null), 'invalid');
  });

  test('undo, redo and clear; a new shape drops the redo stack', () => {
    const d = model.createDraft();
    const a = model.makeShape('rect', [[0, 0], [1, 1]]);
    const b = model.makeShape('arrow', [[0, 0], [1, 1]]);
    model.draftAdd(d, a);
    model.draftAdd(d, b);
    assert.equal(model.draftUndo(d), true);
    assert.deepEqual(d.shapes, [a]);
    assert.equal(model.draftRedo(d), true);
    assert.deepEqual(d.shapes, [a, b]);
    model.draftUndo(d);
    model.draftAdd(d, model.makeShape('blur', [[0, 0], [1, 1]]));
    assert.equal(model.draftRedo(d), false);
    model.draftClear(d);
    assert.equal(d.shapes.length + d.redo.length, 0);
    assert.equal(model.draftUndo(d), false);
    assert.equal(model.shapeSummary([a, b]), 'rect, arrow');
  });
});

describe('item serialisation', () => {
  const anchor = { selector: 'main > button:nth-of-type(1)', tag: 'button', snippet: 'Sign up', classes: ['btn', 'btn-primary'] };

  test('builds a section-1 item and drops unknown or hostile input', () => {
    const shapes = [model.makeShape('arrow', [[-0.5, -1.2], [0.5, 0.5]], 'red')];
    shapes[0].s = 7;
    const item = model.buildItem({
      text: '  make this bigger ', anchor, shapes, box,
      viewport: { w: 1440.4, h: 900, dpr: 2 },
      target: { url: 'http://localhost:5173/signup', srcLoc: 'src/Signup.jsx:42' }
    });
    assert.deepEqual(Object.keys(item).sort(), ['anchor', 'kind', 'page', 'shapes', 'target', 'text', 'viewport']);
    assert.equal(item.text, 'make this bigger');
    assert.deepEqual(item.viewport, { w: 1440, h: 900, dpr: 2 });
    assert.deepEqual(item.shapes, [{ type: 'arrow', points: [[-0.5, -1.2], [0.5, 0.5]], color: 'red' }]);
    assert.deepEqual(item.target, { url: 'http://localhost:5173/signup', srcLoc: 'src/Signup.jsx:42' });
    assert.ok(Number.isInteger(item.page.x) && item.page.w > 0);
    assert.equal(model.buildItem({ text: ' ', anchor }), null);
    assert.equal(model.buildItem({ text: 'x', anchor: null }), null);
  });

  test('element item has no shapes key; page is the element box', () => {
    const item = model.buildItem({ text: 'x', anchor, shapes: [], box });
    assert.equal('shapes' in item, false);
    assert.deepEqual(item.page, { x: 100, y: 200, w: 300, h: 50 });
    assert.equal('target' in item, false);
  });

  test('caps and sanitising: control and bidi chars stripped, lengths cut, classes filtered', () => {
    const dirty = 'a\u0000b‮c​d\u0085e';
    assert.equal(model.cleanText(dirty, 100), 'abcde');
    assert.equal(model.cleanText(123, 10), '');
    const item = model.buildItem({
      text: 'x'.repeat(5000),
      anchor: {
        selector: 's'.repeat(900), tag: 'Bad Tag', snippet: 'n'.repeat(900),
        classes: ['ok', 'bad class', '<img>', ...Array.from({ length: 30 }, (_, i) => 'c' + i)],
        textRange: { text: 't'.repeat(3000) }
      },
      shapes: []
    });
    assert.equal(item.text.length, 4000);
    assert.equal(item.anchor.selector.length, 500);
    assert.equal(item.anchor.snippet.length, 200);
    assert.equal(item.anchor.textRange.text.length, 1000);
    assert.equal(item.anchor.tag, 'div');
    assert.equal(item.anchor.classes.length, 12);
    assert.ok(item.anchor.classes.every(c => /^[A-Za-z0-9_-]+$/.test(c)));
  });

  test('viewport and page clamps', () => {
    const item = model.buildItem({
      text: 'x', anchor, shapes: [{ type: 'rect', points: [[5, 5], [-4, -4]] }],
      box: { left: 500000, top: -9, width: 10, height: 10 },
      viewport: { w: 999999, h: 0, dpr: 99 }
    });
    assert.deepEqual(item.viewport, { w: 100000, h: 1, dpr: 8 });
    assert.ok(item.page.x <= 100000 && item.page.y >= 0);
  });

  test('blur: snippet and textRange are never captured', () => {
    const item = model.buildItem({
      text: 'x', anchor: { ...anchor, textRange: { text: 'secret' } },
      shapes: [model.makeShape('blur', [[0, 0], [1, 1]]), model.makeShape('rect', [[0, 0], [1, 1]])], box
    });
    assert.equal(item.anchor.snippet, '');
    assert.equal('textRange' in item.anchor, false);
  });

  test('item shape budget: at most 2048 points and 16 shapes survive', () => {
    const many = Array.from({ length: 40 }, () => ({ type: 'rect', points: [[0, 0], [1, 1]] }));
    assert.equal(model.buildItem({ text: 'x', anchor, shapes: many, box }).shapes.length, 16);
    const big = Array.from({ length: 5 }, () => ({ type: 'freehand', points: Array.from({ length: 512 }, (_, i) => [i, 0]) }));
    assert.equal(model.buildItem({ text: 'x', anchor, shapes: big, box }).shapes.length, 4);
  });

  test('srcLoc follows cleanSrcLoc rules; unsafe values are omitted', () => {
    for (const ok of ['src/App.jsx:42', 'src/a-b/C.tsx:1:7']) assert.equal(model.cleanSrcLoc(ok), ok);
    for (const bad of ['../x.js:1', '/etc/passwd:1', 'src/.env.js:1', 'node_modules/x/y.js:1', 'src/App.jsx', 'javascript:alert(1)', 'a'.repeat(300) + '.js:1', 42, null]) {
      assert.equal(model.cleanSrcLoc(bad), null, String(bad));
    }
    const item = model.buildItem({ text: 'x', anchor, shapes: [], target: { url: 'http://localhost:1/', srcLoc: '../x.js:1' } });
    assert.equal('srcLoc' in item.target, false);
  });

  test('XSS strings stay inert data: no markup is ever produced by the model', () => {
    const evil = '<img src=x onerror=alert(1)></script><script>alert(1)</script>javascript:alert(1)';
    const item = model.buildItem({ text: evil, anchor: { selector: evil, tag: 'button', snippet: evil, classes: [evil] }, shapes: [] });
    assert.equal(item.text, evil);
    assert.equal(item.anchor.snippet, evil.slice(0, 200));
    assert.deepEqual(item.anchor.classes, undefined);
    assert.equal(typeof JSON.stringify(item), 'string');
  });

  test('chunkItems respects 20 items and the byte budget', () => {
    const items = Array.from({ length: 45 }, (_, i) => ({ text: String(i) }));
    assert.deepEqual(model.chunkItems(items).map(c => c.length), [20, 20, 5]);
    const fat = Array.from({ length: 5 }, () => ({ text: 'z'.repeat(90000) }));
    assert.deepEqual(model.chunkItems(fat).map(c => c.length), [2, 2, 1]);
    assert.deepEqual(model.chunkItems([]), []);
  });
});

describe('toolbar markup', () => {
  test('static, labelled, focusable controls and no data interpolation', () => {
    const html = toolbar.toolbarHtml();
    assert.match(html, /role="toolbar"/);
    for (const [id, key] of toolbar.TOOLS) assert.match(html, new RegExp(`data-tool="${id}"[^>]*aria-keyshortcuts="${key}"`));
    assert.ok(!html.includes('${'));
  });

  test('palette: black, white and purple, no mint or cyan; reduced motion; light scheme', () => {
    const css = toolbar.toolbarCss();
    assert.match(css, /#0a0a0a/);
    assert.match(css, /#9b30c4/);
    assert.match(css, /prefers-reduced-motion/);
    assert.match(css, /prefers-color-scheme:light/);
    assert.ok(!/#4acbbe|#0d9488|mint|cyan|teal/i.test(css));
  });
});

describe('bundle', () => {
  const bundles = { postMessage: annotateClientJs({ transport: 'postMessage', version: '1.1.0' }), fetch: annotateClientJs({ transport: 'fetch', version: '1.1.0' }) };

  for (const [transport, code] of Object.entries(bundles)) {
    test(`${transport}: parses and has no banned constructs`, () => {
      assert.doesNotThrow(() => new vm.Script(code));
      assert.ok(!/\beval\s*\(|new\s+Function|\bFunction\s*\(/.test(code), 'eval/Function');
      assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code), 'html sinks');
      assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(code), 'storage');
      assert.ok(!/XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts/.test(code), 'other network');
      assert.ok(!/<\/script/i.test(code));
      const values = [...code.matchAll(/([\w$.]+)\.value\b/g)].map(m => m[1]);
      assert.ok(values.length > 0 && values.every(v => v === 'noteEl'), `only the layer's own textarea may be read: ${values}`);
      assert.match(code, /\.textContent\s*=/);
    });
  }

  test('fetch: exactly one network call, to the token-bound endpoint, without credentials', () => {
    const calls = [...bundles.fetch.matchAll(/\bfetch\s*\(/g)];
    assert.equal(calls.length, 1);
    assert.match(bundles.fetch, /fetch\(endpoint,\s*\{[^}]*credentials: 'omit'/);
    assert.match(bundles.fetch, /endpoint = base \+ '\/api\/annotate\/' \+ key/);
    assert.match(bundles.fetch, /x-aos-annotate-token/);
    assert.ok(!/localStorage|document\.cookie|location\.search|location\.hash/.test(bundles.fetch));
  });

  test('postMessage: keeps the iframe guard; fetch: no postMessage chrome bridge listener', () => {
    assert.match(bundles.postMessage, /window\.parent === window\) return/);
    assert.match(bundles.postMessage, /e\.source !== window\.parent/);
    assert.ok(!/postMessage\(msg/.test(bundles.fetch.replace(/const post = [^\n]*\n/, '')));
  });

  test('artifactSdkJs is the postMessage bundle; unknown transport throws', () => {
    assert.equal(artifactSdkJs(), annotateClientJs({ transport: 'postMessage' }));
    assert.throws(() => annotateClientJs({ transport: 'ws' }));
  });

  test('ui.js renders queue pills with textContent only', () => {
    const ui = fs.readFileSync(path.join(lib, 'ui.js'), 'utf8');
    assert.match(ui, /tags\.textContent = '\[' \+ kinds/);
    assert.match(ui, /msg\.item\.kind === 'annotation'/);
    assert.ok(!/innerHTML\s*=\s*[^'"\s]/.test(ui.slice(ui.indexOf('function renderQueue'), ui.indexOf('renderQueue();'))));
  });
});

function runBundle(transport, extra = {}) {
  const posts = [];
  const listeners = {};
  const generic = () => {
    const store = {};
    const target = function stub() {};
    const handler = {
      get(_t, k) {
        if (Object.hasOwn(store, k)) return store[k];
        if (k === Symbol.iterator) return function* () {};
        if (k === Symbol.toPrimitive) return () => '';
        if (k === 'then') return undefined;
        if (k === 'addEventListener') return () => {};
        if (k === 'matches' || k === 'closest' || k === 'contains') return () => false;
        if (k === 'classList' || k === 'dataset' || k === 'style') return (store[k] ||= generic());
        return (store[k] = generic());
      },
      set(_t, k, v) { store[k] = v; return true; },
      apply() { return generic(); },
      construct() { return generic(); }
    };
    return new Proxy(target, handler);
  };
  const document = generic();
  document.currentScript = extra.currentScript || null;
  document.body = generic();
  document.documentElement = generic();
  document.createElement = () => generic();
  document.createElementNS = () => generic();
  document.createTextNode = () => generic();
  document.elementsFromPoint = () => [];
  document.addEventListener = (type, fn) => { (listeners[`doc:${type}`] ||= []).push(fn); };
  const win = {
    document, innerWidth: 1000, innerHeight: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 2,
    addEventListener: (type, fn) => { (listeners[`win:${type}`] ||= []).push(fn); },
    getSelection: () => null, scrollTo() {}, setTimeout, clearTimeout,
    requestAnimationFrame: fn => { fn(); return 1; },
    DOMParser: class { parseFromString() { return { body: { childNodes: [] } }; } },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    location: { origin: 'http://localhost:5173', pathname: '/x' },
    URL, CSS: { escape: s => s }, Math, Number, String, Array, Object, JSON, Promise, Boolean, Symbol, console,
    fetch: async () => { throw new Error('no network in tests'); }
  };
  win.window = win;
  win.parent = transport === 'postMessage' ? { postMessage: (msg, target) => posts.push([msg, target]) } : win;
  vm.runInNewContext(extra.code, win);
  return { win, posts, listeners };
}

describe('bundle smoke run against a generic DOM stub (logic only, not a browser)', () => {
  test('postMessage: announces ready and ignores unknown types, foreign sources and hostile tools', () => {
    const { win, posts, listeners } = runBundle('postMessage', { code: annotateClientJs({ transport: 'postMessage', version: '1.1.0' }) });
    assert.deepEqual(JSON.parse(JSON.stringify(posts.map(p => p[0]))), [{ type: 'pc:ready' }]);
    const [onMessage] = listeners['win:message'];
    for (const data of [null, 'str', 5, { type: 'unknown' }, { type: 'pc:set-tool', tool: '__proto__' }, { type: 'pc:set-tool', tool: 'rect' }, { type: 'pc:set-mode', annotate: false }, { type: 'pc:set-mode', annotate: 1 }]) {
      assert.doesNotThrow(() => onMessage({ source: win.parent, data }));
    }
    assert.doesNotThrow(() => onMessage({ source: {}, data: { type: 'pc:set-mode', annotate: false } }));
    assert.equal(posts.length, 1, 'chrome-originated set-tool must not echo pc:tool');
    const onKey = listeners['doc:keydown'][0];
    onKey({ key: 'i', metaKey: true, composedPath: () => [win], preventDefault() {} });
    assert.deepEqual(JSON.parse(JSON.stringify(posts.at(-1)[0])), { type: 'pc:toggle-mode' });
  });

  test('fetch: starts off, toggles with Alt+Shift+A, never posts to a parent', () => {
    const script = { getAttribute: k => ({ 'data-session': 'abcdef012345', 'data-token': 'tok' }[k]), src: 'http://127.0.0.1:4519/annotate.js?v=1' };
    const { win, posts, listeners } = runBundle('fetch', { code: annotateClientJs({ transport: 'fetch', version: '1.1.0' }), currentScript: script });
    const onKey = listeners['doc:keydown'][0];
    assert.doesNotThrow(() => onKey({ key: 'A', code: 'KeyA', altKey: true, shiftKey: true, composedPath: () => [win], preventDefault() {}, stopPropagation() {} }));
    for (const key of ['r', 'a', 'Escape', 'z']) {
      assert.doesNotThrow(() => onKey({ key, metaKey: key === 'z', composedPath: () => [win], preventDefault() {}, stopPropagation() {} }));
    }
    assert.equal(posts.length, 0);
    assert.equal(listeners['win:message'], undefined);
  });

  test('a second injection is a no-op', () => {
    const code = annotateClientJs({ transport: 'postMessage' });
    const { win, posts } = runBundle('postMessage', { code });
    vm.runInNewContext(code, win);
    assert.equal(posts.length, 1);
  });
});
