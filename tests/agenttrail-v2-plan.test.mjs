import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parsePlan, lintPlan } from '../skills/global_config/agenttrail/lib/plan.mjs';

const PLAN = `# Checkout rewrite

## Shopping cart {#cart}
kind: component
url: https://example.invalid/cart
needs: []
links: [checkout]
files: [src/cart.ts, src/cart-ui.tsx]

tech: React 19 + the existing store

- [ ] Scaffold the cart store {#cart-store}
  tech: plain redux
- [~] Wire the cart page {#cart-page}
  by: opus
- [x] Add the cart reducer {#cart-reducer}
  tech: test in tests/cart.test.ts
- [!] Fix the totals rounding {#cart-totals}

## Checkout {#checkout}
needs: [cart]
files: [src/checkout/**]

- [ ] Start checkout {#checkout-start}
  from: roadmap

## Decisions

- keep the old store
`;

const parsed = parsePlan(PLAN);
const comps = () => parsed.nodes.filter((n) => n.level === 'component');
const tasks = () => parsed.nodes.filter((n) => n.level === 'task');
const byId = (id) => parsed.nodes.find((n) => n.id === id);

describe('parsePlan: components', () => {
  test('title comes from the first h1', () => {
    assert.equal(parsed.title, 'Checkout rewrite');
  });

  test('components keep order, level and parent', () => {
    assert.deepEqual(comps().map((c) => c.id), ['cart', 'checkout']);
    assert.equal(comps()[0].level, 'component');
    assert.equal(comps()[0].parent, null);
  });

  test('tasks attach to the current component', () => {
    assert.equal(byId('cart-store').parent, 'cart');
    assert.equal(byId('cart-store').level, 'task');
  });

  test('needs, links and files parse as id lists', () => {
    assert.deepEqual(byId('cart').files, ['src/cart.ts', 'src/cart-ui.tsx']);
    assert.deepEqual(byId('cart').links, ['checkout']);
    assert.deepEqual(byId('checkout').needs, ['cart']);
    assert.deepEqual(byId('cart').needs, []);
  });

  test('url and kind land on the component', () => {
    assert.equal(byId('cart').url, 'https://example.invalid/cart');
    assert.equal(byId('cart').kind, 'component');
  });

  test('a decisions section is collected and closes components', () => {
    assert.deepEqual(parsed.decisions, ['keep the old store']);
    assert.equal(parsed.nodes.find((n) => n.id === 'Decision'), undefined);
  });
});

describe('parsePlan: task statuses', () => {
  test('all four markers map to statuses', () => {
    assert.equal(byId('cart-store').status, 'pending');
    assert.equal(byId('cart-page').status, 'active');
    assert.equal(byId('cart-reducer').status, 'done');
    assert.equal(byId('cart-totals').status, 'blocked');
  });

  test('a blocked task makes its component blocked', () => {
    assert.equal(byId('cart').status, 'blocked');
  });

  test('an all-done component is done', () => {
    const p = parsePlan('# P\n\n## A {#a}\nfiles: [a]\n\n- [x] one {#t1}\n- [x] two {#t2}\n\n## B {#b}\nfiles: [b]\n\n- [ ] three {#t3}\n');
    assert.equal(p.nodes.find((n) => n.id === 'a').status, 'done');
    assert.equal(p.nodes.find((n) => n.id === 'b').status, 'pending');
  });

  test('by:, tech: and from: attach to the most recent node', () => {
    assert.equal(byId('cart-page').by, 'opus');
    assert.equal(byId('cart-store').tech, 'plain redux');
    assert.equal(byId('checkout-start').src, 'roadmap');
  });
});

describe('lintPlan', () => {
  test('a well-formed plan lints clean', () => {
    assert.deepEqual(lintPlan(parsed, PLAN), []);
  });

  test('a trivial plan is not linted at all', () => {
    const tiny = '# T\n\n## One {#one}\n\n- [ ] do {#do}\n';
    assert.deepEqual(lintPlan(parsePlan(tiny), tiny), []);
    assert.deepEqual(lintPlan(parsePlan(''), ''), []);
  });

  test('duplicate ids are reported', () => {
    const text = '# P\n\n## A {#a}\nfiles: [x]\n\n- [ ] one {#dup}\n\n## B {#b}\nfiles: [y]\n\n- [ ] two {#dup}\n';
    const out = lintPlan(parsePlan(text), text);
    assert.ok(out.some((l) => l.includes('duplicate id {#dup}')), out.join(' | '));
  });

  test('an edge to an unknown component is reported', () => {
    const text = '# P\n\n## A {#a}\nneeds: [nope]\nfiles: [x]\n\n- [ ] one {#t1}\n\n## B {#b}\nfiles: [y]\n\n- [ ] two {#t2}\n';
    const out = lintPlan(parsePlan(text), text);
    assert.ok(out.some((l) => l.includes('edge to unknown component "nope"')), out.join(' | '));
  });

  test('a component without files: globs is reported', () => {
    const text = '# P\n\n## A {#a}\n\n- [ ] one {#t1}\n\n## B {#b}\nfiles: [y]\n\n- [ ] two {#t2}\n';
    const out = lintPlan(parsePlan(text), text);
    assert.ok(out.some((l) => l.includes('a: no files: globs')), out.join(' | '));
  });

  test('a done task without a tech: line is reported', () => {
    const text = '# P\n\n## A {#a}\nfiles: [x]\n\n- [x] one {#t1}\n\n## B {#b}\nfiles: [y]\n\n- [ ] two {#t2}\n';
    const out = lintPlan(parsePlan(text), text);
    assert.ok(out.some((l) => l.includes('cites no evidence')), out.join(' | '));
  });

  test('more than nine components is reported', () => {
    const comps = Array.from({ length: 10 }, (_, i) => `## C${i} {#c${i}}\nfiles: [f${i}]\n\n- [ ] t {#t${i}}`).join('\n\n');
    const text = `# P\n\n${comps}\n`;
    const out = lintPlan(parsePlan(text), text);
    assert.ok(out.some((l) => l.includes('10 components')), out.join(' | '));
  });

  test('lints are capped at twelve', () => {
    const comps = Array.from({ length: 30 }, (_, i) => `## C${i} {#c${i}}\n\n- [ ] t {#t${i}}`).join('\n\n');
    const text = `# P\n\n${comps}\n`;
    assert.equal(lintPlan(parsePlan(text), text).length, 12);
  });
});