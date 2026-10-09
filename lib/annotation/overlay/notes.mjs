// WP6 notes list panel + SVG connectors + drift handling + orphan rebind. DOM, thin.
import { resolveAnchor, connectorPath, nextNumber, filterNotes, foreignMutation } from './connectors.mjs';
import { buildSelector, newIdempotencyKey } from './logic.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Small element-pick helper (used when markup.mjs does not export one).
// Returns a Promise (awaitable as before) with a .cancel() method.
let activePick = null;
function cancelPick() { try { activePick?.cancel?.(); } catch {} activePick = null; }
export function pickElementOnce(doc, host) {
  if (activePick) cancelPick();
  let onClick, onKey, cancel;
  const promise = new Promise((resolve, reject) => {
    onClick = (e) => {
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (host && (path.includes(host) || host.contains?.(e.target))) return;
      cleanup();
      e.preventDefault();
      e.stopPropagation();
      const el = e.target;
      const desc = {
        tag: el.tagName ? el.tagName.toLowerCase() : '',
        id: typeof el.id === 'string' ? el.id : '',
        classes: el.classList ? [...el.classList].slice(0, 2) : [],
      };
      resolve(buildSelector(desc));
    };
    onKey = (e) => { if (e.key === 'Escape') { cleanup(); reject(new Error('pick-cancelled')); } };
    cancel = () => { cleanup(); reject(new Error('pick-cancelled')); };
    function cleanup() {
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('keydown', onKey, true);
      if (activePick?.promise === promise) activePick = null;
    }
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('keydown', onKey, true);
  });
  promise.cancel = cancel;
  activePick = { promise, cancel };
  // swallow unhandled rejection when caller ignores cancel
  promise.catch(() => {});
  return promise;
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status };
}

export function createNotesPanel({ root, pageId = 'dev', send } = {}) {
  const doc = root.ownerDocument;
  const post = send || apiPost;
  const state = { notes: [], filter: 'all', numbers: new Map(), live: new Map() };

  const panel = doc.createElement('div');
  panel.setAttribute('data-aos', 'notes-panel');

  const filterBar = doc.createElement('div');
  for (const f of ['all', 'open', 'resolved', 'orphan']) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = f;
    b.dataset.filter = f;
    b.addEventListener('click', () => {
      state.filter = f;
      render();
    });
    filterBar.appendChild(b);
  }
  panel.appendChild(filterBar);

  const cards = doc.createElement('div');
  cards.setAttribute('data-aos', 'note-cards');
  panel.appendChild(cards);
  root.appendChild(panel);

  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('data-aos', 'connectors');
  svg.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
  doc.documentElement.appendChild(svg);

  function rectOfCard(el) {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  function queryRect(selector) {
    if (typeof selector !== 'string' || !selector || selector.length > 500) return null;
    let el = null;
    try {
      el = doc.querySelector(selector);
    } catch {
      return null;
    }
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  function redraw() {
    while (svg.firstChild) svg.firstChild.remove();
    for (const note of state.notes) {
      const res = resolveAnchor(note, queryRect);
      const card = cards.querySelector(`[data-note-id="${CSS.escape(note.id)}"]`);
      if (res.state !== 'live' || !card) continue;
      const d = connectorPath(rectOfCard(card), res.rect);
      if (!d) continue;
      const p = doc.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('stroke', '#3e63dd');
      p.setAttribute('fill', 'none');
      svg.appendChild(p);
    }
  }

  let rafId = 0;
  let destroyed = false;
  function scheduleRedraw() {
    if (destroyed || rafId) return;
    const raf = doc.defaultView?.requestAnimationFrame?.bind(doc.defaultView) || ((fn) => setTimeout(fn, 16));
    rafId = raf(() => {
      rafId = 0;
      redraw();
    });
  }

  const isOwn = (t) => !!t && (svg.contains?.(t) || panel.contains?.(t) || t === svg || t === panel);
  const mo = new MutationObserver((records) => {
    if (!foreignMutation(records, isOwn)) return;
    scheduleRedraw();
  });
  mo.observe(doc.documentElement, { childList: true, subtree: true, attributes: true });
  doc.addEventListener('scroll', scheduleRedraw, true);
  const resizeTarget = (doc.defaultView || window);
  resizeTarget.addEventListener('resize', scheduleRedraw);

  function textOf(note) {
    if (note.markupText) return String(note.markupText);
    if (note.markup && typeof note.markup.text === 'string') return note.markup.text;
    if (note.body && note.body.markup && typeof note.body.markup.text === 'string') return note.body.markup.text;
    return String(note.type || note.id || '');
  }

  function setNotes(notes) {
    state.notes = Array.isArray(notes) ? [...notes] : [];
    state.numbers = nextNumber(state.notes);
    // annotate orphan flags via live resolve
    for (const n of state.notes) {
      const sel = n?.anchor?.selector ?? n?.selector ?? '';
      const r = resolveAnchor(n, queryRect);
      n.orphan = r.state === 'orphan' && !!sel ? true : r.state === 'orphan' ? true : false;
      n._orphan = n.orphan;
    }
    render();
  }

  function addNote(ev) {
    const body = ev && ev.body ? ev.body : ev;
    if (!body) return;
    const note = {
      id: body.id || `a_${String(Date.now())}`,
      createdAt: body.createdAt || new Date().toISOString(),
      status: 'open',
      anchor: body.anchor || { selector: '' },
      markup: body.markup,
      markupText: (body.markup && body.markup.text) || '',
    };
    state.notes.push(note);
    setNotes(state.notes);
  }

  async function rebind(note) {
    let picked;
    try {
      picked = await pickElementOnce(doc, { contains: (t) => panel.contains?.(t) || svg.contains?.(t) || t === panel || t === svg });
    } catch { return undefined; }
    const { selector } = picked;
    const body = {
      annotationId: note.id,
      pageId: String(pageId),
      selector,
      idempotencyKey: newIdempotencyKey(String(Date.now())),
    };
    return post('/aos-api', body);
  }

  async function editNote(note, text) {
    return post('/aos-api', {
      annotationId: note.id,
      pageId: String(pageId),
      body: String(text),
      idempotencyKey: newIdempotencyKey(String(Date.now())),
    });
  }

  async function deleteNote(note) {
    return post('/aos-api', {
      annotationId: note.id,
      pageId: String(pageId),
      delete: true,
      idempotencyKey: newIdempotencyKey(String(Date.now())),
    });
  }

  function render() {
    while (cards.firstChild) cards.firstChild.remove();
    const visible = filterNotes(state.notes, state.filter);
    for (const note of visible) {
      const card = doc.createElement('div');
      card.dataset.noteId = note.id;
      const head = doc.createElement('span');
      head.textContent = `#${state.numbers.get(note.id) ?? '?'} [untrusted] `;
      card.appendChild(head);
      const bodyEl = doc.createElement('span');
      bodyEl.textContent = textOf(note);
      card.appendChild(bodyEl);
      card.addEventListener('click', () => {
        const sel = note?.anchor?.selector ?? note?.selector ?? '';
        if (!sel) return;
        let el = null;
        try {
          el = doc.querySelector(sel);
        } catch {
          el = null;
        }
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
      });
      if (note.orphan) {
        const chip = doc.createElement('span');
        chip.textContent = 'orphan';
        chip.dataset.chip = 'orphan';
        card.appendChild(chip);
        const rb = doc.createElement('button');
        rb.type = 'button';
        rb.textContent = 'rebind';
        rb.addEventListener('click', (e) => {
          e.stopPropagation();
          rebind(note);
        });
        card.appendChild(rb);
      }
      const eb = doc.createElement('button');
      eb.type = 'button';
      eb.textContent = 'edit';
      eb.addEventListener('click', (e) => {
        e.stopPropagation();
        editNote(note, textOf(note));
      });
      card.appendChild(eb);
      const db = doc.createElement('button');
      db.type = 'button';
      db.textContent = 'delete';
      db.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteNote(note);
      });
      card.appendChild(db);
      cards.appendChild(card);
    }
    scheduleRedraw();
  }

  return {
    el: panel,
    svg,
    setNotes,
    addNote,
    rebind,
    editNote,
    deleteNote,
    getState: () => ({ ...state, notes: [...state.notes] }),
    destroy() {
      destroyed = true;
      cancelPick();
      mo.disconnect();
      doc.removeEventListener('scroll', scheduleRedraw, true);
      resizeTarget.removeEventListener('resize', scheduleRedraw);
      const caf = doc.defaultView?.cancelAnimationFrame?.bind(doc.defaultView) || clearTimeout;
      if (rafId) caf(rafId);
      rafId = 0;
      svg.remove();
      panel.remove();
    },
  };
}
