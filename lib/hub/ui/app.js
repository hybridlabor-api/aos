// AOS Hub shell: tab router + api(). The token from the injected <meta> is
// attached as X-AOS-Hub-Token on every api() call (POST only; GETs need none).
import { mount as mountServices } from './services.js';
import { mount as mountCatalog } from './catalog.js';
import { mount as mountStore } from './store.js';
import { mount as mountPlans } from './plans.js';

const TOKEN = (document.querySelector('meta[name="aos-hub-token"]')?.content || '');
const TABS = [
  { id: 'services', label: 'Services', mount: mountServices },
  { id: 'catalog', label: 'Catalog', mount: mountCatalog },
  { id: 'store', label: 'Store', mount: mountStore },
  { id: 'plans', label: 'Plans', mount: mountPlans },
];

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.body === undefined ? 'GET' : 'POST',
    headers: { ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), 'x-aos-hub-token': TOKEN },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

function currentTab() {
  const p = new URLSearchParams(location.search).get('tab');
  return TABS.some((t) => t.id === p) ? p : 'services';
}

const view = document.getElementById('view');
let stop = null;
function show(id) {
  if (stop) { stop(); stop = null; }
  view.textContent = '';
  const tab = TABS.find((t) => t.id === id);
  for (const el of document.querySelectorAll('#tabs a')) el.classList.toggle('active', el.dataset.tab === id);
  document.title = `AOS Hub — ${tab.label}`;
  stop = tab.mount(view, api) || null;
}

const nav = document.getElementById('tabs');
for (const t of TABS) {
  const a = document.createElement('a');
  a.href = `/?tab=${t.id}`;
  a.textContent = t.label;
  a.dataset.tab = t.id;
  a.addEventListener('click', (e) => { e.preventDefault(); history.replaceState(null, '', `/?tab=${t.id}`); show(t.id); });
  nav.appendChild(a);
}

// Header links to live agenttrail maps (new tabs; top-level navigations are
// exempt on the hub side, and the maps open directly on their own ports).
async function trail() {
  const el = document.getElementById('trail');
  const { json } = await api('/api/trail');
  el.textContent = '';
  const links = json?.links || [];
  if (!links.length) {
    const s = document.createElement('span');
    s.className = 'none';
    s.textContent = 'no live trail maps';
    el.appendChild(s);
    return;
  }
  for (const l of links) {
    const a = document.createElement('a');
    a.href = l.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = `trail :${l.port}`;
    el.appendChild(a);
  }
}

api('/api/health').then(({ json }) => {
  const el = document.getElementById('ver');
  if (json.updateAvailable && json.latest) {
    el.textContent = `${json.version || '—'} (v${json.latest} available)`;
    el.title = `Update available: ${json.latest}`;
  } else {
    el.textContent = json.version || '—';
  }
});
show(currentTab());
trail();
