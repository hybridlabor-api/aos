// WP5 markup bar: tools pin/box/freehand/text, color, stroke, undo (Cmd/Ctrl+Z), element-pick.
import { TOOLS, COLORS, initialToolState, toolReducer, buildSelector, buildAnnotationBody, newIdempotencyKey, undoPush, undoPop } from './logic.mjs';

const CAPTIONS = { pin: 'Pin: drop a point', box: 'Box: drag a rectangle', freehand: 'Freehand: draw', text: 'Text note: click then type', pick: 'Pick: click an element' };

export function createMarkupBar({ root, pageId, onPosted, post }) {
  let state = initialToolState('pin');
  let undoStack = [];
  const send = post || defaultPost;
  const bar = root.ownerDocument.createElement('div');
  bar.setAttribute('data-aos-markup', 'bar');
  const btns = {};
  for (const t of TOOLS) {
    const b = root.ownerDocument.createElement('button');
    b.type = 'button'; b.textContent = t; b.title = CAPTIONS[t]; b.dataset.tool = t;
    b.addEventListener('click', () => { state = toolReducer(state, { type: 'SELECT_TOOL', tool: t }); paint(); armTool(); });
    bar.appendChild(b); btns[t] = b;
  }
  const cap = root.ownerDocument.createElement('span');
  cap.setAttribute('data-aos-markup', 'caption');
  bar.appendChild(cap);
  const colorSel = root.ownerDocument.createElement('select');
  for (const c of COLORS) { const o = root.ownerDocument.createElement('option'); o.value = c; o.textContent = c; colorSel.appendChild(o); }
  colorSel.addEventListener('change', () => { state = toolReducer(state, { type: 'SET_COLOR', color: colorSel.value }); });
  bar.appendChild(colorSel);
  const stroke = root.ownerDocument.createElement('input');
  stroke.type = 'number'; stroke.min = '1'; stroke.max = '64'; stroke.value = '3'; stroke.title = 'Stroke width';
  stroke.addEventListener('change', () => { state = toolReducer(state, { type: 'SET_STROKE', width: Number(stroke.value) }); });
  bar.appendChild(stroke);
  const undoBtn = root.ownerDocument.createElement('button');
  undoBtn.type = 'button'; undoBtn.textContent = 'Undo'; undoBtn.title = 'Undo (Cmd/Ctrl+Z)';
  undoBtn.addEventListener('click', doUndo);
  bar.appendChild(undoBtn);
  root.appendChild(bar);

  function paint() {
    for (const t of TOOLS) btns[t].setAttribute('aria-pressed', t === state.tool ? 'true' : 'false');
    cap.textContent = CAPTIONS[state.tool] || '';
  }
  function doUndo() {
    const r = undoPop(undoStack); undoStack = r.stack;
    if (onPosted) onPosted({ undone: r.item });
  }
  function onKey(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); }
    if (e.key === 'Escape') state = toolReducer(state, { type: 'CANCEL_PICK' });
  }
  function armTool() {
    if (state.tool === 'pick') state = toolReducer(state, { type: 'START_PICK' });
  }
  // Element-pick: click handler resolves selector via descriptor; crop optional.
  async function pickAt(desc, extra) {
    const { selector } = buildSelector(desc);
    const body = buildAnnotationBody({
      tool: state.tool === 'pick' ? 'pick' : state.tool,
      anchor: { selector, ...(extra || {}) },
      markup: { color: state.color, strokeWidth: state.strokeWidth },
      pageId, authorName: '', idempotencyKey: newIdempotencyKey(randomHex()),
      crop: (extra && extra.crop) || null,
    });
    const res = await send('/aos-api', body);
    undoStack = undoPush(undoStack, body);
    state = toolReducer(state, { type: 'END_DRAFT' });
    paint();
    if (onPosted) onPosted({ body, res });
    return res;
  }
  // Text note submit: text rendered untrusted downstream; posted verbatim.
  async function submitNote(text, anchorExtra) {
    const body = buildAnnotationBody({
      tool: state.tool === 'pick' ? 'pin' : state.tool,
      anchor: { selector: (anchorExtra && anchorExtra.selector) || '', ...(anchorExtra || {}) },
      markup: { color: state.color, strokeWidth: state.strokeWidth, text: String(text || '') },
      pageId, authorName: '', idempotencyKey: newIdempotencyKey(randomHex()),
    });
    const res = await send('/aos-api', body);
    undoStack = undoPush(undoStack, body);
    state = toolReducer(state, { type: 'END_DRAFT' });
    paint();
    if (onPosted) onPosted({ body, res });
    return res;
  }
  paint();
  return { el: bar, pickAt, submitNote, onKey, getState: () => ({ ...state }) };
}

function randomHex() {
  try { return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join(''); } catch { return String(Date.now()); }
}

async function defaultPost(url, body) {
  const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: res.ok, status: res.status };
}
