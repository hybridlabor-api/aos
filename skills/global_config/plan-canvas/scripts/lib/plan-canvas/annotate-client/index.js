'use strict';

/**
 * Plan Canvas annotation layer (element, text, area, arrow, freehand, blur,
 * comment). One module for both hosts: the sandboxed canvas iframe
 * (transport 'postMessage') and a running localhost app (transport 'fetch').
 * Own code, no third-party drawing library.
 */

const geometry = require('./geometry');
const model = require('./model');
const { toolbarCss, toolbarHtml } = require('./toolbar');

const { rawUnits, toAnchorUnits, fromAnchorUnits, fitsAnchor } = geometry;
const { createDraft, draftAdd, draftUndo, draftRedo, draftClear, makeShape, buildItem, chunkItems, shapeSummary } = model;

// Runs in the browser. Free identifiers are the inlined pure helpers above.
function clientMain(CFG) {
  const FETCH = CFG.transport === 'fetch';
  if (!FETCH && window.parent === window) return;
  if (window.__aosAnnotate) return;
  window.__aosAnnotate = true;

  const script = document.currentScript;
  let endpoint = null;
  let token = '';
  if (FETCH && script) {
    const key = script.getAttribute('data-session') || '';
    token = script.getAttribute('data-token') || '';
    let base = '';
    try { base = new URL(script.src).origin; } catch (err) { base = ''; }
    if (/^[a-f0-9]{12}$/.test(key) && token && base) endpoint = base + '/api/annotate/' + key;
  }

  const TOOL_IDS = ['element', 'text', 'rect', 'arrow', 'freehand', 'blur', 'comment'];
  const TOOL_KEYS = { V: 'element', T: 'text', R: 'rect', A: 'arrow', F: 'freehand', B: 'blur', C: 'comment' };
  const DRAW = ['rect', 'arrow', 'freehand', 'blur', 'comment'];
  const COLOR_HEX = { red: '#e5484d', yellow: '#f5c518', blue: '#3b82f6', green: '#30a46c' };
  const NS = 'http://www.w3.org/2000/svg';
  const MAX_RAW = 5000;

  let on = !FETCH;
  let tool = 'element';
  let color = 'red';
  let stroke = 4;
  let draft = createDraft();
  let pending = null;
  let live = null;
  let queue = [];
  let sending = false;
  let statusTimer = null;
  let frame = 0;

  const post = msg => window.parent.postMessage(msg, '*');

  // --- shadow-root UI ------------------------------------------------------
  const host = document.createElement('div');
  host.setAttribute('data-ecc-plan-canvas', 'ui');
  host.setAttribute('data-version', CFG.version);
  host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647';
  const root = host.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = CFG.css;
  root.appendChild(styleEl);
  root.append(...Array.from(new DOMParser().parseFromString(CFG.html, 'text/html').body.childNodes));
  const attach = () => (document.body ? document.body.appendChild(host) : null);
  if (document.body) attach();
  else document.addEventListener('DOMContentLoaded', attach);

  const $ = sel => root.querySelector(sel);
  const ov = $('svg.ov');
  const hl = $('.hl');
  const selhint = $('.selhint');
  const launch = $('.launch');
  const bar = $('.bar');
  const statusEl = $('.status');
  const cardEl = $('.card');
  const cardTitle = cardEl.querySelector('h4');
  const cardSnippet = cardEl.querySelector('.snippet');
  const noteEl = cardEl.querySelector('textarea');
  const mini = $('.mini');
  const miniList = mini.querySelector('ul');
  const miniMsg = mini.querySelector('.msg');
  const sendBtn = mini.querySelector('[data-act=send]');

  const isOurs = el => el === host || host.contains(el);
  const isTyping = t => Boolean(t && t.nodeType === 1 && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable));
  const FORMISH = 'input,textarea,select,option,[contenteditable],script,style,noscript,[data-ecc-plan-canvas]';

  function setStatus(msg) {
    statusEl.textContent = msg;
    clearTimeout(statusTimer);
    if (msg) statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 5000);
  }

  // --- selectors & context -------------------------------------------------
  const esc = v => ((window.CSS && CSS.escape) ? CSS.escape(v) : v.replace(/[^a-zA-Z0-9_-]/g, '\\$&'));
  function selectorFor(el) {
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 6; depth++) {
      if (node.id) { parts.unshift('#' + esc(node.id)); return parts.join(' > '); }
      const tag = node.tagName.toLowerCase();
      if (tag === 'body' || tag === 'html') { parts.unshift(tag); break; }
      let nth = 1;
      let sib = node;
      while ((sib = sib.previousElementSibling)) if (sib.tagName === node.tagName) nth++;
      parts.unshift(tag + ':nth-of-type(' + nth + ')');
      node = node.parentElement;
    }
    return parts.join(' > ');
  }
  // Text nodes only: values of form controls and editable regions are never read.
  function snippetFor(el) {
    if (el.matches(FORMISH) || el.closest(FORMISH)) return '';
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.parentElement && !n.parentElement.closest(FORMISH) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT)
    });
    let text = '';
    for (let n = walker.nextNode(); n && text.length < 400; n = walker.nextNode()) text += ' ' + n.nodeValue;
    return text.replace(/\s+/g, ' ').trim().slice(0, CAPS.snippet);
  }
  function isInteractive(el) {
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      if (/^(button|input|select|textarea|option|label|summary|a)$/i.test(node.tagName) || node.isContentEditable) return true;
    }
    return false;
  }
  function boxOf(el) {
    const r = el.getBoundingClientRect();
    return { left: r.left + window.scrollX, top: r.top + window.scrollY, width: r.width, height: r.height };
  }
  function anchorFor(el) {
    return {
      selector: selectorFor(el),
      tag: el.tagName.toLowerCase(),
      snippet: snippetFor(el),
      classes: Array.from(el.classList || [])
    };
  }
  function srcLocFor(el) {
    const holder = FETCH ? el.closest('[data-aos-src]') : null;
    return holder ? holder.getAttribute('data-aos-src') : null;
  }
  function elementAtClient(x, y) {
    const hit = document.elementsFromPoint(x, y).find(el => !isOurs(el) && el !== document.documentElement && el !== document.body);
    return hit || document.body;
  }

  // --- overlay rendering ---------------------------------------------------
  function svgEl(name, attrs) {
    const n = document.createElementNS(NS, name);
    for (const k of Object.keys(attrs)) n.setAttribute(k, String(attrs[k]));
    return n;
  }
  function drawShape(type, pts, colorName, sw, n) {
    const col = COLOR_HEX[colorName] || COLOR_HEX.red;
    const g = svgEl('g', { fill: 'none', stroke: col, 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (type === 'rect' || type === 'blur') {
      const x = Math.min(a[0], b[0]);
      const y = Math.min(a[1], b[1]);
      const w = Math.abs(b[0] - a[0]);
      const h = Math.abs(b[1] - a[1]);
      if (type === 'blur') g.appendChild(svgEl('rect', { x, y, width: w, height: h, fill: '#111', 'fill-opacity': 0.92, stroke: 'none' }));
      else g.appendChild(svgEl('rect', { x, y, width: w, height: h, fill: col, 'fill-opacity': 0.08, rx: 2 }));
    } else if (type === 'arrow') {
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const len = 10 + sw * 2;
      const wing = d => (b[0] - len * Math.cos(ang + d)) + ',' + (b[1] - len * Math.sin(ang + d));
      g.appendChild(svgEl('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }));
      g.appendChild(svgEl('polygon', { points: wing(-0.45) + ' ' + b[0] + ',' + b[1] + ' ' + wing(0.45), fill: col }));
    } else if (type === 'freehand') {
      g.appendChild(svgEl('polyline', { points: pts.map(p => p[0] + ',' + p[1]).join(' ') }));
    } else if (type === 'comment') {
      g.appendChild(svgEl('circle', { cx: a[0], cy: a[1], r: 11, fill: col, stroke: '#fff', 'stroke-width': 2 }));
      const label = svgEl('text', { x: a[0], y: a[1] + 4, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: '#fff', stroke: 'none' });
      label.textContent = String(n);
      g.appendChild(label);
    }
    return g;
  }
  function currentBox() {
    return pending.el && pending.el.isConnected ? boxOf(pending.el) : pending.box;
  }
  function render() {
    const de = document.documentElement;
    ov.setAttribute('width', String(Math.max(de.scrollWidth, window.innerWidth)));
    ov.setAttribute('height', String(Math.max(de.scrollHeight, window.innerHeight)));
    ov.replaceChildren();
    if (pending && draft.shapes.length) {
      const box = currentBox();
      draft.shapes.forEach((s, i) => ov.appendChild(drawShape(s.type, s.points.map(p => fromAnchorUnits(p, box)), s.color, s.s || 4, i + 1)));
    }
    if (live) ov.appendChild(drawShape(live.type, live.pts, color, stroke, draft.shapes.length + 1));
    for (const b of root.querySelectorAll('.bar button[data-act]')) {
      if (b.dataset.act === 'undo') b.disabled = !draft.shapes.length;
      else if (b.dataset.act === 'redo') b.disabled = !draft.redo.length;
      else if (b.dataset.act === 'delete') b.disabled = !pending;
    }
  }
  const scheduleRender = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; render(); });
  };

  // --- state transitions ---------------------------------------------------
  function syncUi() {
    bar.hidden = !on;
    launch.hidden = !(FETCH && !on);
    ov.classList.toggle('draw', on && DRAW.includes(tool));
    for (const b of root.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    for (const b of root.querySelectorAll('[data-color]')) b.setAttribute('aria-pressed', String(b.dataset.color === color));
    for (const b of root.querySelectorAll('[data-stroke]')) b.setAttribute('aria-pressed', String(Number(b.dataset.stroke) === stroke));
  }
  function cancelAll() {
    draftClear(draft);
    pending = null;
    live = null;
    cardEl.hidden = true;
    noteEl.value = '';
    render();
  }
  function setOn(v) {
    on = Boolean(v);
    if (!on) { cancelAll(); hl.style.display = 'none'; selhint.style.display = 'none'; }
    syncUi();
  }
  function setTool(t, fromChrome) {
    if (!TOOL_IDS.includes(t)) return;
    tool = t;
    hl.style.display = 'none';
    syncUi();
    if (!FETCH && !fromChrome) post({ type: 'pc:tool', tool });
  }
  function focusTool() {
    const b = root.querySelector('[data-tool][aria-pressed=true]');
    if (b) b.focus();
  }

  // --- note card -----------------------------------------------------------
  function showCard(label, x, y) {
    cardTitle.textContent = label;
    cardSnippet.textContent = pending.anchor.snippet || pending.anchor.selector;
    if (cardEl.hidden) {
      cardEl.hidden = false;
      cardEl.style.left = Math.max(8, Math.min(x, window.scrollX + window.innerWidth - 316)) + 'px';
      cardEl.style.top = y + 12 + 'px';
      noteEl.focus();
    }
  }
  function openElementCard(label, el, anchor, clientX, clientY) {
    cancelAll();
    pending = { fromShapes: false, el, box: boxOf(el), anchor, srcLoc: srcLocFor(el) };
    showCard(label, clientX + window.scrollX, clientY + window.scrollY);
  }
  function queueCard(sendNow) {
    if (!pending) return;
    const text = noteEl.value.trim();
    if (!text) { noteEl.focus(); return; }
    if (pending.fromShapes && !draft.shapes.length) { setStatus('Nothing drawn: draw a shape first.'); return; }
    const item = buildItem({
      text,
      anchor: pending.anchor,
      shapes: draft.shapes,
      box: currentBox(),
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
      target: FETCH ? { url: location.origin + location.pathname, srcLoc: pending.srcLoc } : null
    });
    if (!item) { setStatus('Could not build this annotation.'); return; }
    cancelAll();
    if (FETCH) {
      queue.push(item);
      renderMini();
      if (sendNow) send();
    } else {
      post({ type: sendNow ? 'pc:queue-and-send' : 'pc:queue', item });
    }
  }
  noteEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); queueCard(true); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); queueCard(false); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelAll(); }
    e.stopPropagation();
  });
  noteEl.addEventListener('keyup', e => e.stopPropagation());
  noteEl.addEventListener('keypress', e => e.stopPropagation());

  // --- drawing -------------------------------------------------------------
  const pagePt = e => [e.clientX + window.scrollX, e.clientY + window.scrollY];
  function pickAnchor(allPts, refPage) {
    let el = elementAtClient(refPage[0] - window.scrollX, refPage[1] - window.scrollY);
    let box = boxOf(el);
    while (!fitsAnchor(allPts, box) && el.parentElement) { el = el.parentElement; box = boxOf(el); }
    return fitsAnchor(allPts, box) ? { el, box } : null;
  }
  function addDrawn(type, pts) {
    if (pending && !pending.fromShapes) cancelAll();
    if (!pending) {
      const ref = type === 'arrow' ? pts[1] : [(pts[0][0] + pts[pts.length - 1][0]) / 2, (pts[0][1] + pts[pts.length - 1][1]) / 2];
      const a = pickAnchor(pts, ref);
      if (!a) { setStatus('Could not anchor this shape to an element.'); render(); return; }
      pending = { fromShapes: true, el: a.el, box: a.box, anchor: anchorFor(a.el), srcLoc: srcLocFor(a.el) };
    } else if (!fitsAnchor(pts, currentBox())) {
      setStatus('Too far from the first shape: queue this note first, then draw it again.');
      render();
      return;
    }
    const box = currentBox();
    const shape = makeShape(type, pts.map(p => toAnchorUnits(p, box)), color);
    const why = draftAdd(draft, Object.assign(shape || {}, { s: stroke }));
    if (why === 'max-shapes') setStatus('Limit of ' + CAPS.maxShapes + ' shapes per note: queue this note first.');
    else if (why === 'max-points') setStatus('Drawing too detailed: queue this note first.');
    else if (why) setStatus('Shape discarded.');
    const last = pts[pts.length - 1];
    showCard('Annotate drawing', last[0], last[1]);
    render();
  }
  function endDraw() {
    if (!live) return;
    const { type, pts } = live;
    live = null;
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (type === 'comment') return addDrawn(type, [a]);
    if (type === 'freehand') {
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (len < 3) return render();
      return addDrawn(type, pts);
    }
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 4) return render();
    return addDrawn(type, [a, b]);
  }
  ov.addEventListener('pointerdown', e => {
    if (!on || !DRAW.includes(tool) || e.button !== 0 || live) return;
    e.preventDefault();
    try { ov.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    live = { id: e.pointerId, type: tool, pts: [pagePt(e)] };
    if (tool === 'comment') endDraw();
    else scheduleRender();
  });
  ov.addEventListener('pointermove', e => {
    if (!live || e.pointerId !== live.id) return;
    const p = pagePt(e);
    if (live.type === 'freehand') { if (live.pts.length < MAX_RAW) live.pts.push(p); }
    else live.pts[1] = p;
    scheduleRender();
  });
  ov.addEventListener('pointerup', e => { if (live && e.pointerId === live.id) endDraw(); });
  ov.addEventListener('pointercancel', () => { live = null; render(); });

  // --- element hover / click -----------------------------------------------
  document.addEventListener('mousemove', e => {
    if (!on || tool !== 'element' || pending) { hl.style.display = 'none'; return; }
    const el = e.target;
    if (!el || isOurs(el) || el === document.body || el === document.documentElement || isInteractive(el)) {
      hl.style.display = 'none';
      return;
    }
    const rect = el.getBoundingClientRect();
    hl.style.display = 'block';
    hl.style.left = rect.left - 2 + 'px';
    hl.style.top = rect.top - 2 + 'px';
    hl.style.width = rect.width + 'px';
    hl.style.height = rect.height + 'px';
  }, true);

  document.addEventListener('click', e => {
    if (!on || tool !== 'element') return;
    const el = e.target;
    if (isOurs(el)) return;
    if (pending) { if (!pending.fromShapes) cancelAll(); return; }
    if (isInteractive(el)) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    if (el === document.body || el === document.documentElement) return;
    e.preventDefault();
    e.stopPropagation();
    hl.style.display = 'none';
    openElementCard('Annotate <' + el.tagName.toLowerCase() + '>', el, anchorFor(el), e.clientX, e.clientY);
  }, true);

  // --- text selection ------------------------------------------------------
  document.addEventListener('mouseup', e => {
    if (!on || (tool !== 'element' && tool !== 'text') || isOurs(e.target)) return;
    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) { selhint.style.display = 'none'; return; }
      const text = selection.toString().replace(/\s+/g, ' ').trim();
      const range = selection.rangeCount ? selection.getRangeAt(0) : null;
      if (!text || !range) return;
      const node = range.commonAncestorContainer;
      const el = node.nodeType === 1 ? node : node.parentElement;
      if (el && (el.matches(FORMISH) || el.closest(FORMISH))) return;
      const rect = range.getBoundingClientRect();
      selhint.style.display = 'block';
      selhint.style.left = Math.max(8, rect.left + window.scrollX) + 'px';
      selhint.style.top = rect.top + window.scrollY - 36 + 'px';
      selhint.onclick = () => {
        selhint.style.display = 'none';
        const target = el || document.body;
        const anchor = { selector: selectorFor(target), tag: 'text', snippet: text.slice(0, CAPS.snippet), classes: Array.from(target.classList || []), textRange: { text: text.slice(0, CAPS.textRange) } };
        openElementCard('Annotate selection', target, anchor, rect.left, rect.bottom);
      };
    }, 0);
  }, true);
  document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) selhint.style.display = 'none';
  });

  // --- toolbar -------------------------------------------------------------
  function undo() { if (draftUndo(draft)) render(); }
  function redo() { if (draftRedo(draft)) render(); }
  bar.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tool) setTool(b.dataset.tool);
    else if (b.dataset.color) { color = b.dataset.color; syncUi(); }
    else if (b.dataset.stroke) { stroke = Number(b.dataset.stroke) || 4; syncUi(); }
    else if (b.dataset.act === 'undo') undo();
    else if (b.dataset.act === 'redo') redo();
    else if (b.dataset.act === 'delete') cancelAll();
    else if (b.dataset.act === 'close') { if (FETCH) setOn(false); else post({ type: 'pc:toggle-mode' }); }
  });
  bar.addEventListener('keydown', e => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const list = Array.from(bar.querySelectorAll('button:not(:disabled)'));
    const i = list.indexOf(e.composedPath()[0]);
    if (i < 0) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
    list[next].focus();
  });
  cardEl.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'cancel') cancelAll();
    else if (b.dataset.act === 'queue') queueCard(false);
  });
  launch.addEventListener('click', () => { setOn(true); focusTool(); });

  // --- app-mode mini queue and transport -------------------------------------
  function setMiniMsg(msg) {
    miniMsg.textContent = msg;
    renderMini();
  }
  function renderMini() {
    miniList.replaceChildren();
    queue.forEach((item, i) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = (item.shapes ? '[' + shapeSummary(item.shapes) + '] ' : '') + item.text;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = '×';
      rm.setAttribute('aria-label', 'Remove annotation ' + (i + 1));
      rm.addEventListener('click', () => { queue = queue.filter(q => q !== item); renderMini(); });
      li.append(label, rm);
      miniList.appendChild(li);
    });
    sendBtn.disabled = sending || !queue.length;
    mini.hidden = !FETCH || (!queue.length && !miniMsg.textContent);
  }
  async function send() {
    if (sending || !queue.length) return;
    if (!endpoint) { setMiniMsg('Missing data-session or data-token on the script tag.'); return; }
    sending = true;
    setMiniMsg('Sending...');
    try {
      for (const chunk of chunkItems(queue.slice())) {
        const res = await fetch(endpoint, {
          method: 'POST',
          credentials: 'omit',
          headers: { 'content-type': 'application/json', 'x-aos-annotate-token': token },
          body: JSON.stringify({ items: chunk })
        });
        if (!res.ok) {
          const expired = res.status === 401 || res.status === 403;
          sending = false;
          setMiniMsg(expired ? 'canvas link expired: run `aos-plan-canvas annotate <url>` again'
            : res.status === 429 ? 'Too many annotations sent or queued: wait a moment and retry.'
              : 'The canvas server refused this batch (HTTP ' + res.status + ').');
          return;
        }
        queue = queue.filter(q => !chunk.includes(q));
      }
      sending = false;
      setMiniMsg('Sent to the canvas.');
    } catch (err) {
      sending = false;
      setMiniMsg('Could not reach the canvas server. Your annotations are still queued.');
    }
  }
  sendBtn.addEventListener('click', send);

  // --- keyboard ------------------------------------------------------------
  document.addEventListener('keydown', e => {
    const t = e.composedPath()[0];
    const mod = e.metaKey || e.ctrlKey;
    const k = (e.key || '').toLowerCase();
    if (!FETCH && mod && k === 'i') { e.preventDefault(); post({ type: 'pc:toggle-mode' }); return; }
    if (FETCH && e.altKey && e.shiftKey && e.code === 'KeyA') { e.preventDefault(); setOn(!on); if (on) focusTool(); return; }
    if (!on || t === noteEl) return;
    if (e.key === 'Escape') {
      if (pending || live || draft.shapes.length) { e.preventDefault(); e.stopPropagation(); cancelAll(); }
      else if (FETCH) setOn(false);
      return;
    }
    if (isTyping(t)) return;
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (e.key === 'Enter' && pending && !root.contains(t)) {
      e.preventDefault();
      if (noteEl.value.trim()) queueCard(mod); else noteEl.focus();
      return;
    }
    if (mod || e.altKey) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && pending) { e.preventDefault(); cancelAll(); return; }
    const hit = TOOL_KEYS[e.key.length === 1 ? e.key.toUpperCase() : ''];
    if (hit) { e.preventDefault(); setTool(hit); }
  }, true);

  // --- chrome bridge -------------------------------------------------------
  if (!FETCH) {
    window.addEventListener('message', e => {
      if (e.source !== window.parent) return;
      const msg = e.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'pc:set-mode') setOn(msg.annotate);
      else if (msg.type === 'pc:restore-scroll') window.scrollTo(Number(msg.x) || 0, Number(msg.y) || 0);
      else if (msg.type === 'pc:set-tool') setTool(msg.tool, true);
    });
    let scrollTimer = null;
    window.addEventListener('scroll', () => {
      if (scrollTimer) return;
      scrollTimer = setTimeout(() => {
        scrollTimer = null;
        post({ type: 'pc:scroll', x: window.scrollX, y: window.scrollY });
      }, 150);
    }, { passive: true });
  }
  window.addEventListener('resize', scheduleRender);
  if (typeof ResizeObserver === 'function') new ResizeObserver(scheduleRender).observe(document.documentElement);

  syncUi();
  render();
  renderMini();
  if (!FETCH) post({ type: 'pc:ready' });
}

function annotateClientJs({ transport = 'postMessage', version = '' } = {}) {
  if (transport !== 'postMessage' && transport !== 'fetch') throw new Error(`unknown transport: ${transport}`);
  const cfg = {
    transport,
    version: String(version).replace(/[^\w.+-]/g, '').slice(0, 40),
    html: toolbarHtml(),
    css: toolbarCss()
  };
  const consts = [
    `const CAPS = ${JSON.stringify(model.CAPS)};`,
    `const SHAPE_COLORS = ${JSON.stringify(model.SHAPE_COLORS)};`,
    `const POINT_RULES = ${JSON.stringify(model.POINT_RULES)};`,
    `const STRIP_RE = ${model.STRIP_RE};`,
    `const CLASS_RE = ${model.CLASS_RE};`,
    `const SRC_RE = ${model.SRC_RE};`,
    `const TAG_RE = ${model.TAG_RE};`
  ];
  const fns = [
    geometry.roundPoint, geometry.clampPoint, geometry.rawUnits, geometry.toAnchorUnits, geometry.fromAnchorUnits,
    geometry.fitsAnchor, geometry.rdp, geometry.simplify, ...model.PURE_FUNCTIONS
  ].map(fn => fn.toString());
  const json = JSON.stringify(cfg).replace(/</g, '\\u003c');
  return `'use strict';\n(() => {\n${consts.join('\n')}\n${fns.join('\n')}\n(${clientMain.toString()})(${json});\n})();\n`;
}

module.exports = { annotateClientJs };
