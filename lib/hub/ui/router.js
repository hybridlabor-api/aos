// Router tab: the layered role -> target routing table. Each role card lists
// its ordered targets with the source layer (shipped/user/project), reorder
// buttons, a save button (writes to the layer picked in the toggle) and a
// test button showing what the router would pick for that role right now.
// A limits table shows the configured soft/hard values marked "usage
// unknown" — lib/router exposes no live usage. The router is advisory.
// No polling: a timer re-render would clobber in-progress reordering.
export function mount(view, api) {
  const errNote = document.createElement('p');
  errNote.className = 'note';
  errNote.hidden = true;
  const advisory = document.createElement('p');
  advisory.className = 'note';
  const controls = document.createElement('div');
  controls.className = 'catalog-controls';
  const refreshBtn = document.createElement('button');
  refreshBtn.textContent = 'Refresh';
  const layerLabel = document.createElement('label');
  layerLabel.style.cssText = 'display:flex;gap:6px;align-items:center';
  const layerSelect = document.createElement('select');
  layerSelect.setAttribute('aria-label', 'layer to save to');
  for (const [v, text] of [['user', 'user layer (~/.aos/router.json)'], ['project', 'project layer (.aos/router.json)']]) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = text;
    layerSelect.appendChild(o);
  }
  layerLabel.appendChild(document.createTextNode('Save to:'));
  layerLabel.appendChild(layerSelect);
  controls.append(refreshBtn, layerLabel);

  const rolesBox = document.createElement('div');
  rolesBox.style.cssText = 'display:grid;gap:10px';
  const limitsCard = document.createElement('div');
  limitsCard.className = 'card';
  view.append(advisory, errNote, controls, rolesBox, limitsCard);

  // Working copy of each role's order, edited by the up/down buttons.
  let data = null;
  const order = {};

  const fail = (msg) => { errNote.hidden = false; errNote.textContent = msg || 'request failed'; };

  function sourceBadge(name, layerName) {
    const s = document.createElement('span');
    s.className = 's-tag';
    s.textContent = `${name} · ${layerName}`;
    return s;
  }

  function roleCard(role) {
    const el = document.createElement('div');
    el.className = 'card';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid var(--line)';
    const title = document.createElement('b');
    title.textContent = role;
    head.appendChild(title);
    const src = data.sources?.[role] || 'shipped';
    head.appendChild(sourceBadge('preference source', src));
    const testOut = document.createElement('span');
    testOut.style.cssText = 'color:var(--dim);font-size:12px;margin-left:auto';
    head.appendChild(testOut);
    el.appendChild(head);

    const list = document.createElement('ol');
    list.style.cssText = 'list-style:none;margin:0;padding:8px 14px;display:grid;gap:6px';
    const rows = order[role] || [];
    rows.forEach((target, i) => {
      const li = document.createElement('li');
      li.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
      const pos = document.createElement('span');
      pos.style.cssText = 'color:var(--dim);font-size:12px;min-width:18px;text-align:right';
      pos.textContent = `${i + 1}.`;
      const name = document.createElement('b');
      name.textContent = target;
      const model = data.targets?.[target]?.model;
      const modelNote = document.createElement('span');
      modelNote.style.cssText = 'color:var(--dim);font-size:12px';
      modelNote.textContent = model ? `model: ${model}` : 'model: (session default)';
      const acts = document.createElement('span');
      acts.style.cssText = 'display:flex;gap:4px;margin-left:auto';
      const up = document.createElement('button');
      up.className = 'btn';
      up.textContent = '↑';
      up.setAttribute('aria-label', `move ${target} up for ${role}`);
      up.disabled = i === 0;
      up.addEventListener('click', () => { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; render(); });
      const down = document.createElement('button');
      down.className = 'btn';
      down.textContent = '↓';
      down.setAttribute('aria-label', `move ${target} down for ${role}`);
      down.disabled = i === rows.length - 1;
      down.addEventListener('click', () => { [rows[i], rows[i + 1]] = [rows[i + 1], rows[i]]; render(); });
      acts.append(up, down);
      li.append(pos, name, modelNote, acts);
      list.appendChild(li);
    });
    el.appendChild(list);

    const foot = document.createElement('div');
    foot.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 14px;border-top:1px solid var(--line)';
    const save = document.createElement('button');
    save.className = 'btn';
    save.textContent = 'Save order';
    save.addEventListener('click', async () => {
      save.disabled = true;
      const { status, json } = await api('api/router', { body: { role, targets: order[role], layer: layerSelect.value } });
      save.disabled = false;
      if (status !== 200) return fail(json.error || `save failed (${status})`);
      errNote.hidden = true;
      load();
    });
    const test = document.createElement('button');
    test.className = 'btn';
    test.textContent = 'Test';
    test.title = 'what the router would pick for this role right now';
    test.addEventListener('click', async () => {
      test.disabled = true;
      const { status, json } = await api('api/router');
      test.disabled = false;
      if (status !== 200) return fail(json.error || `router read failed (${status})`);
      errNote.hidden = true;
      data = json;
      showTest();
    });
    foot.append(save, test);
    el.appendChild(foot);

    const showTest = () => {
      const t = data.tests?.[role];
      if (!t || t.error) { testOut.textContent = t?.error ? `test failed: ${t.error}` : ''; return; }
      testOut.textContent = `would pick: ${t.target}${t.model ? ` (${t.model})` : ''} — ${t.reason}`;
    };
    showTest();
    return el;
  }

  function render() {
    if (!data) return;
    advisory.textContent = `${data.note || 'Router is advisory.'} enforce: ${data.enforce ? 'on' : 'off'}${data.usageAvailable ? '' : ' · usage unknown (no live usage data)'}`;
    rolesBox.replaceChildren(...(data.roles || []).map((r) => {
      if (!order[r]) order[r] = [...(data.preferences?.[r] || [])];
      return roleCard(r);
    }));

    limitsCard.replaceChildren();
    const lt = document.createElement('table');
    const thead = document.createElement('thead');
    const hrow = document.createElement('tr');
    for (const h of ['Target', 'Model', 'Limits (soft/hard)', 'Usage']) {
      const th = document.createElement('th');
      th.textContent = h;
      hrow.appendChild(th);
    }
    thead.appendChild(hrow);
    const tbody = document.createElement('tbody');
    for (const [name, cfg] of Object.entries(data.targets || {})) {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.appendChild(document.createTextNode(name));
      const tsrc = data.sources?.[`target:${name}`];
      if (tsrc) tdName.appendChild(document.createTextNode(' '));
      if (tsrc) tdName.appendChild(sourceBadge('config', tsrc));
      const tdModel = document.createElement('td');
      tdModel.textContent = cfg.model || '(session default)';
      const tdLimits = document.createElement('td');
      const win = cfg.limits || {};
      const parts = Object.entries(win).map(([w, l]) => `${w}: ${l.soft ?? '–'}/${l.hard ?? '–'}`);
      tdLimits.textContent = parts.length ? parts.join(' · ') : '(none)';
      const tdUsage = document.createElement('td');
      tdUsage.style.color = 'var(--dim)';
      tdUsage.textContent = data.usageAvailable ? 'live' : 'usage unknown';
      tr.append(tdName, tdModel, tdLimits, tdUsage);
      tbody.appendChild(tr);
    }
    lt.append(thead, tbody);
    limitsCard.appendChild(lt);
    const cap = document.createElement('p');
    cap.className = 'note';
    cap.textContent = 'Limits are the configured soft/hard fractions per window. Live usage is not exposed by lib/router.';
    limitsCard.appendChild(cap);
  }

  async function load() {
    try {
      const { status, json } = await api('api/router');
      if (status !== 200) return fail(json.error || `router read failed (${status})`);
      errNote.hidden = true;
      data = json;
      // A reload means "show what is on disk": drop the working copy so
      // in-progress edits never mask the saved state.
      for (const k of Object.keys(order)) delete order[k];
      render();
    } catch {
      fail('router read failed');
    }
  }

  refreshBtn.addEventListener('click', load);
  load();
  return () => {};
}
