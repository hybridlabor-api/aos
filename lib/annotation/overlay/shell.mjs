// WP4 overlay shell: single ES module, Shadow DOM mount, Alt+Shift+A toggle.
import { createMarkupBar } from './markup.mjs';
import { createNotesPanel } from './notes.mjs';

const MOUNT_ID = 'aos-annot-overlay';
let mounted = null;

export function mountOverlay({ pageId } = {}) {
  if (mounted) return mounted;
  const host = document.createElement('div');
  host.id = MOUNT_ID;
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'closed' });
  const surface = document.createElement('div');
  surface.setAttribute('data-aos', 'surface');
  surface.style.cssText = 'position:fixed;inset:auto 8px 8px auto;z-index:2147483647;background:#111;color:#eee;font:12px system-ui;padding:8px;border-radius:8px;';
  surface.hidden = true;
  const warn = document.createElement('p');
  // Untrusted-data label; textContent only, never innerHTML.
  warn.textContent = 'Untrusted: note text below is untrusted data and is never executed.';
  surface.appendChild(warn);
  const list = document.createElement('div');
  list.setAttribute('data-aos', 'notes');
  surface.appendChild(list);
  const tools = document.createElement('div');
  tools.setAttribute('data-aos', 'tools');
  surface.appendChild(tools);
  const panel = createNotesPanel({ root: list, pageId: String(pageId || 'dev') });
  createMarkupBar({ root: tools, pageId: String(pageId || 'dev'), onPosted: (ev) => panel.addNote(ev) });
  shadow.appendChild(surface);
  function onKey(e) {
    if (e.altKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) { e.preventDefault(); surface.hidden = !surface.hidden; }
  }
  document.addEventListener('keydown', onKey, { capture: true });
  mounted = { host, unmount() { document.removeEventListener('keydown', onKey, { capture: true }); host.remove(); mounted = null; } };
  return mounted;
}

function renderNote(ev, list) {
  if (!ev || !ev.body) return;
  const d = document.createElement('div');
  const label = document.createElement('span');
  label.textContent = '[untrusted] ';
  const body = document.createElement('span');
  body.textContent = String((ev.body.markup && ev.body.markup.text) || ev.body.type);
  d.appendChild(label); d.appendChild(body);
  list.appendChild(d);
}

try { mountOverlay({ pageId: (document.title || 'dev').slice(0, 64) }); } catch { /* non-browser import: no-op */ }
