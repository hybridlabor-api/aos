// Catalog tab: items split across four sub-tabs (agents / skills / commands /
// MCPs) with client-side search and filters: category, group, source,
// installed/missing, harness. All data comes from GET /api/catalog; every
// string is inserted with textContent, never innerHTML.
const SFIELDS = new Set(['agents', 'skills', 'commands', 'mcps']);
const HARNESS_KEYS = ['claude', 'codex', 'agy', 'cursor', 'roo', 'opencode'];
const ITEM_LABELS = { agents: 'Agents', skills: 'Skills', commands: 'Commands', mcps: 'MCPs' };

export function mount(view, api) {
  const wrap = document.createElement('div');
  wrap.className = 'card catalog';
  const tabs = document.createElement('div');
  tabs.className = 'catalog-tabs';
  const controls = document.createElement('div');
  controls.className = 'catalog-controls';
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'search…';
  controls.appendChild(search);
  const buildSelect = (label, values) => {
    const sel = document.createElement('select');
    const opt = (v, text) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = text;
      sel.appendChild(o);
    };
    opt(label, label);
    for (const v of values) opt(v, v);
    controls.appendChild(sel);
    return sel;
  };
  const selCategory = buildSelect('category', []);
  const selGroup = buildSelect('group', []);
  const selSource = buildSelect('source', []);
  const selInstalled = buildSelect('state', ['all', 'installed', 'missing']);
  const selHarness = buildSelect('harness', ['any'].concat(HARNESS_KEYS));
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.textContent = 'refresh';
  controls.appendChild(refresh);
  const note = document.createElement('p');
  note.className = 'note';
  const table = document.createElement('table');
  table.className = 'catalog-table';
  wrap.append(tabs, controls, note, table);
  view.appendChild(wrap);

  let data = null;
  let active = 'agents';

  const subTab = (id) => {
    const a = document.createElement('a');
    a.href = `?tab=catalog&kind=${id}`;
    a.dataset.kind = id;
    a.textContent = ITEM_LABELS[id];
    a.addEventListener('click', (e) => {
      e.preventDefault();
      history.replaceState(null, '', `?tab=catalog&kind=${id}`);
      setKind(id);
    });
    tabs.appendChild(a);
    return a;
  };
  const tabEls = {};
  for (const id of ['agents', 'skills', 'commands', 'mcps']) tabEls[id] = subTab(id);
  const setKind = (id) => {
    active = id;
    for (const k of Object.keys(tabEls)) tabEls[k].classList.toggle('active', k === id);
    fillSelects();
    render();
  };

  const uniqSorted = (values) => [...new Set(values.filter(Boolean))].sort();
  const fillSelects = () => {
    const items = data ? data[active] || [] : [];
    for (const [sel, field] of [[selCategory, 'category'], [selGroup, 'group'], [selSource, 'source']]) {
      const keep = sel.value && (sel.value === field || uniqSorted(items.map((i) => i[field])).includes(sel.value));
      sel.textContent = '';
      const head = document.createElement('option');
      head.value = field;
      head.textContent = field;
      sel.appendChild(head);
      for (const v of uniqSorted(items.map((i) => i[field]))) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = v;
        sel.appendChild(o);
      }
      sel.value = keep ? sel.value : field;
    }
  };

  const passes = (item) => {
    const q = search.value.trim().toLowerCase();
    if (q && !(item.name || '').toLowerCase().includes(q) && !(item.description || '').toLowerCase().includes(q)) return false;
    if (selCategory.value !== 'category' && (item.category || '') !== selCategory.value) return false;
    if (selGroup.value !== 'group' && (item.group || '') !== selGroup.value) return false;
    if (selSource.value !== 'source' && (item.source || '') !== selSource.value) return false;
    if (selHarness.value !== 'any' && !(item.installed && item.installed[selHarness.value])) return false;
    if (selInstalled.value === 'installed' && !hasSomeTrue(item)) return false;
    if (selInstalled.value === 'missing' && hasSomeTrue(item)) return false;
    return true;
  };
  const hasSomeTrue = (item) => Object.values(item.installed || {}).some((v) => v === true);

  const flagsText = (item) => {
    const f = item.installed || {};
    const parts = [];
    for (const k of HARNESS_KEYS) {
      if (k in f) parts.push(`${k}:${f[k] ? 'yes' : 'no'}`);
    }
    if (f.gateway) parts.push('gateway');
    return parts.join(' ');
  };

  const render = () => {
    const body = table.tBodies[0] || table.appendChild(document.createElement('tbody'));
    body.textContent = '';
    if (!data) return;
    const items = (data[active] || []).filter(passes);
    note.textContent = `${items.length} of ${(data[active] || []).length} ${ITEM_LABELS[active].toLowerCase()} · generated ${data.generatedAt || ''}`;
    for (const item of items) {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = item.name || '';
      const desc = document.createElement('td');
      desc.textContent = item.description || '';
      desc.title = item.description || '';
      const meta = document.createElement('td');
      meta.textContent = [item.category, item.group, item.source, item.core ? 'core' : null, flagsText(item)]
        .filter(Boolean).join(' · ');
      tr.append(name, desc, meta);
      body.appendChild(tr);
    }
  };

  for (const el of [search, selCategory, selGroup, selSource, selInstalled, selHarness]) {
    el.addEventListener('input', render);
  }
  refresh.addEventListener('click', () => load(true));

  const load = async (force) => {
    note.textContent = force ? 'rebuilding catalog…' : 'loading catalog…';
    const { status, json } = await api(`api/catalog${force ? '?refresh=1' : ''}`);
    if (status !== 200 || !json) {
      note.textContent = 'catalog unavailable.';
      return;
    }
    data = json;
    if (!SFIELDS.has(active)) active = 'agents';
    setKind(active);
  };
  load(true);
  return () => {};
}

export default mount;
