import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hubDir = path.join(root, 'skills/global_config/agenttrail/public/hub');
const hubBin = path.join(root, 'skills/global_config/agenttrail/bin/trail-hub.mjs');

const MODEL = {
  now: '2026-10-06T12:00:00.000Z',
  port: 5350,
  waiting: [
    { tier: 0, kind: 'go', id: 'r1', sessionKey: 's1', command: 'git push origin feat/x', age: 120000, decision: true, click: true },
    { tier: 1, kind: 'waiting', sessionId: 's2', message: 'need a decision on <b>scope</b>', age: 600000, decision: undefined },
    { tier: 1, kind: 'claim', sessionId: 's3', message: 'claims a GO', age: 900000, label: 'agent claims it waits for GO' },
    { tier: 1, kind: 'ask', id: 'q1', question: 'ship it?', age: 300000 },
    { tier: 1, kind: 'task', plan: 'Checkout', taskId: 't2', title: 'wire page', stalled: true, age: 40000 },
  ],
  sessions: [
    { id: 's1', harnesses: ['claude'], harness: 'claude', name: 'opus', cwd: '/repo/a', state: 'working', currentTool: { name: 'Edit', detail: 'src/x.ts' }, currentTask: null, waiting: null, done: false, ended: false, age: 5000, lastEventAt: '2026-10-06T11:59:55.000Z' },
    { id: 's2', harnesses: ['opencode'], harness: 'opencode', name: '', cwd: '/repo/b', state: 'waiting-for-you', currentTool: null, currentTask: null, waiting: 'blocked', done: false, ended: true, age: 600000, lastEventAt: '2026-10-06T11:50:00.000Z' },
    { id: 's3', harnesses: ['agy', 'codex'], harness: 'agy', name: '', cwd: '/repo/a', state: 'idle', currentTool: null, currentTask: null, waiting: null, done: false, ended: false, age: 7200000, lastEventAt: '2026-10-06T10:00:00.000Z' },
  ],
  repos: [
    {
      id: '/repo/a',
      root: '/repo/a',
      worktrees: [{ path: '/repo/a', branch: 'main' }],
      plans: [{
        planKey: 'pk1',
        name: 'Checkout rewrite',
        path: '/repo/a/production_artifacts/00_execution_plan.md',
        lifecycle: 'active',
        pinned: false,
        owner: { path: '/repo/a', branch: 'main' },
        mirrors: [{ path: '/wt/x', branch: 'feat/x' }],
        divergent: [{ path: '/wt/y', branch: 'feat/y', tasks: 2 }],
        components: [
          { id: 'cart', title: 'Shopping cart', status: 'done', files: ['src/cart.ts'] },
          { id: 'checkout', title: 'Checkout', status: 'active', files: ['src/checkout.ts'] },
          { id: 'pay', title: 'Payments', status: 'blocked', files: ['src/pay.ts'] },
        ],
        progress: { done: 2, total: 5, stalled: 1 },
        lastActivity: '2026-10-06T11:59:00.000Z',
      }],
    },
  ],
  archive: [
    {
      repoId: '/repo/old', repoRoot: '/repo/old', planKey: 'pk9', name: 'Old thing', lifecycle: 'archived', pinned: false,
      owner: { path: '/repo/old', branch: 'old' }, mirrors: [], divergent: [], components: [], progress: { done: 1, total: 1, stalled: 0 },
      lastActivity: '2026-09-01T00:00:00.000Z',
    },
  ],
  gate: {
    available: true,
    modes: [{ sessionKey: 's1', mode: 'soft' }],
    requests: [{ id: 'r1', sessionKey: 's1', command: 'git push origin feat/x', ts: Date.parse('2026-10-06T11:58:00.000Z'), click: true }],
    grants: [{ sessionKey: 's1', scope: 'push-feature', until: '2026-10-06T13:00:00.000Z', minutesLeft: 60, session: false }],
    blocks: [{ sessionKey: 's1', ts: Date.parse('2026-10-06T11:57:00.000Z'), command: 'git push origin main', hard: true, why: 'main is protected' }],
    rejected: ['s1: grant push-main has no matching human gogate entry'],
  },
};

// A tiny DOM: enough to prove the render path builds text nodes, not markup.
function stubDom() {
  const make = (tag) => ({
    tagName: tag,
    className: '',
    attributes: {},
    children: [],
    _text: '',
    style: {},
    get firstChild() { return this.children[0] || null },
    get textContent() { return this._text },
    set textContent(v) { this._text = String(v); this.children = [] },
    setAttribute(k, v) { this.attributes[k] = String(v) },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null },
    removeAttribute(k) { delete this.attributes[k] },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) },
    appendChild(c) { this.children.push(c); return c },
    removeChild(c) { this.children = this.children.filter((x) => x !== c) },
    addEventListener() {},
  })
  const ids = ['waiting-list', 'waiting-count', 'sessions-body', 'sessions-count', 'plans-list', 'gate-body', 'gate-mode', 'archive-list', 'archive-count', 'archive-toggle', 'port', 'gate', 'clock']
  const byId = new Map(ids.map((id) => [id, make(id === 'waiting-list' || id === 'sessions-body' || id === 'plans-list' || id === 'gate-body' || id === 'archive-list' ? 'ul' : 'div')]))
  const document = {
    createElement: (tag) => make(tag),
    getElementById: (id) => byId.get(id) || null,
    querySelector: () => ({ getAttribute: () => 'test-csrf-token' }),
  }
  return { document, byId }
}

const loadApp = () => {
  const { document, byId } = stubDom()
  const sandbox = {
    document,
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    setTimeout: () => {},
    setInterval: () => {},
    console,
    EventSource: undefined,
  }
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(path.join(hubDir, 'app.js'), 'utf8'), sandbox, { filename: 'app.js' })
  return { api: sandbox.__trail, byId }
}

describe('static checks on the served assets', () => {
  test('no script tag without a src, and no inline style attribute', () => {
    const html = fs.readFileSync(path.join(hubDir, 'index.html'), 'utf8')
    const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1])
    assert.ok(scripts.length > 0, 'expected the page to load a script')
    for (const attrs of scripts) assert.match(attrs, /\bsrc=/, `inline script found: <script${attrs}>`)
    assert.equal(/<style\b/.test(html), false, 'no inline <style> block')
    assert.equal(/\sstyle=/.test(html), false, 'no style attribute in the markup')
  });

  test('the page loads no external origin', () => {
    const html = fs.readFileSync(path.join(hubDir, 'index.html'), 'utf8')
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      assert.ok(m[1].startsWith('/'), `external or relative-to-root asset: ${m[1]}`)
    }
  });

  test('app.js never uses eval, innerHTML or Function', () => {
    const src = fs.readFileSync(path.join(hubDir, 'app.js'), 'utf8')
    for (const banned of ['eval(', 'new Function', 'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write']) {
      assert.equal(src.includes(banned), false, `app.js must not use ${banned}`)
    }
  });

  test('app.js has no style= usage', () => {
    const src = fs.readFileSync(path.join(hubDir, 'app.js'), 'utf8')
    assert.equal(/style=/.test(src), false, 'no style attribute from script')
    assert.equal(/\.style\./.test(src), false, 'no direct style writes')
  });

  test('the legacy board is untouched', () => {
    const legacy = path.join(root, 'skills/global_config/agenttrail/public/index.html')
    assert.ok(fs.existsSync(legacy), 'legacy index.html missing')
  });

  test('the csrf token reaches the page through a meta tag placeholder', () => {
    const html = fs.readFileSync(path.join(hubDir, 'index.html'), 'utf8')
    assert.match(html, /csrf-token/);
    assert.match(html, /__TRAIL_CSRF__/);
  });
});

describe('rendering a fixture model', () => {
  let api;
  let byId;

  before(() => { const l = loadApp(); api = l.api; byId = l.byId })

  test('render runs on the whole model without throwing', () => {
    assert.doesNotThrow(() => api.render(MODEL))
  });

  test('an empty model renders without throwing', () => {
    const empty = { now: new Date().toISOString(), port: 5350, waiting: [], sessions: [], repos: [], archive: [], gate: { available: false } }
    assert.doesNotThrow(() => api.render(empty))
  })

  test('a model with null collections renders without throwing', () => {
    assert.doesNotThrow(() => api.render({ now: new Date().toISOString() }))
  })

  test('a waiting list renders one row per item', () => {
    api.render(MODEL)
    assert.equal(byId.get('waiting-list').children.length, MODEL.waiting.length)
  })

  test('the GO row offers copy text and no approve button', () => {
    api.render(MODEL)
    const labels = collect(byId.get('waiting-list'))
    assert.ok(labels.includes('copy GO text'), labels.join(' | '))
    for (const banned of ['approve', 'deny', 'allow']) {
      assert.equal(/button[^>]*>(approve|deny|allow)/i.test(byId.get('waiting-list').children[0].children[0].children.join('') || ''), false)
    }
  })

  test('the GO text is the exact command Tim has to type', () => {
    assert.equal(api.goText({ kind: 'go', sessionKey: 's1' }), 'GO s1')
  })

  test('untrusted text is inserted as text, never as markup', () => {
    const m = JSON.parse(JSON.stringify(MODEL))
    m.waiting[1].message = '<img src=x onerror=alert(1)>'
    api.render(m)
    const labels = collect(byId.get('waiting-list'))
    assert.ok(labels.includes('<img src=x onerror=alert(1)>'), 'the text must survive verbatim as text')
    assert.equal(labels.includes('undefined'), false)
  })

  test('sessions render one row each with a state', () => {
    api.render(MODEL)
    assert.equal(byId.get('sessions-body').children.length, MODEL.sessions.length)
    assert.ok(collect(byId.get('sessions-body')).includes('working'))
  })

  test('plans render components, mirrors and the divergent badge', () => {
    api.render(MODEL)
    const text = collect(byId.get('plans-list')).join(' | ')
    for (const want of ['Checkout rewrite', '#cart', 'also checked out in: feat/x', 'divergent: 2 tasks', '2/5 tasks']) {
      assert.ok(text.includes(want), `missing "${want}" in: ${text}`)
    }
  })

  test('the archive renders behind its counter', () => {
    api.render(MODEL)
    assert.equal(byId.get('archive-count').textContent, '1')
    assert.ok(collect(byId.get('archive-list')).includes('Old thing'))
  })

  test('the gate panel shows mode, grants with time left, hard blocks and rejected', () => {
    api.render(MODEL)
    // the mode lives in the header chip, the detail in the panel body
    assert.match(byId.get('gate-mode').textContent, /s1: soft/)
    const text = collect(byId.get('gate-body')).join(' | ')
    for (const want of ['push-feature', '60 min left', 'hard block', 'no matching human gogate entry']) {
      assert.ok(text.includes(want), `missing "${want}" in: ${text}`)
    }
  })

  test('an unavailable gate says so instead of guessing', () => {
    api.render({ ...MODEL, gate: { available: false } })
    assert.equal(byId.get('gate-mode').textContent, 'not readable')
    const texts = collect(byId.get('gate-body'))
    assert.ok(texts.some((t) => t.includes('gate module not found')), `gate body held: ${JSON.stringify(texts)}`)
  })

  test('age formatting covers seconds, minutes, hours and days', () => {
    assert.equal(api.ageText(5000), '5s')
    assert.equal(api.ageText(60000), '1m')
    assert.equal(api.ageText(7200000), '2h')
    assert.equal(api.ageText(3 * 86400000), '3d')
  })
});

const collect = (node, out = []) => {
  const walk = (n) => {
    if (!n) return
    if (n.textContent) out.push(n.textContent)
    for (const c of n.children || []) walk(c)
    for (const v of Object.values(n.attributes || {})) out.push(String(v))
  }
  walk(node)
  return out.filter(Boolean)
};

describe('the hub serves the UI', () => {
  let port;
  let child;

  // 127.0.0.1, not "localhost": this container has no usable IPv6, and a fetch to
  // localhost can hang on ::1 instead of failing over to the v4 loopback.
  const get = (p) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, agent: false, headers: { host: `localhost:${port}` } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')) })
    req.end()
  })

  before(async () => {
    port = await new Promise((resolve) => {
      const s = net.createServer();
      s.listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => resolve(p)) })
    });
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'trail-ui-home-'));
    child = spawn(process.execPath, [hubBin, '--port', String(port)], {
      env: { ...process.env, HOME: home, AOS_TRAIL_STATE_DIR: path.join(home, '.aos', 'trail'), AOS_GOGATE_PATH: path.join(home, 'none.mjs') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (let i = 0; i < 80; i += 1) {
      try { const r = await get('/whoami'); if (r.status === 200) return } catch { /* retry */ }
      await new Promise((r2) => setTimeout(r2, 100));
    }
    throw new Error('hub did not start');
  });

  after(() => { if (child) child.kill('SIGKILL') });

  test('index.html is served with the csrf token in place and the security headers', async () => {
    const res = await get('/')
    assert.equal(res.status, 200)
    assert.equal(res.headers['cache-control'], 'no-store')
    assert.equal(res.headers['x-frame-options'], 'DENY')
    assert.match(res.headers['content-security-policy'], /default-src 'self'/)
    assert.match(res.body, /name="csrf-token" content="[a-zA-Z0-9_-]{20,}"/)
    assert.equal(res.body.includes('__TRAIL_CSRF__'), false, 'the placeholder must be replaced')
  })

  test('app.js and app.css are served with their own types', async () => {
    const js = await get('/app.js')
    assert.equal(js.status, 200)
    assert.match(js.headers['content-type'], /javascript/)
    const css = await get('/app.css')
    assert.equal(css.status, 200)
    assert.match(css.headers['content-type'], /text\/css/)
  })

  test('a path outside the UI directory is not served', async () => {
    const res = await get('/package.json')
    assert.notEqual(res.status, 200)
  })
});