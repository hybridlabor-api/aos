// WP4 Store tab: store items (missing vs installed), preview with
// script/exec-bridge warnings and license/commit, an on-page typed-confirm
// input), install and rollback, and the package list with
// install/update/repair. Every fetch goes through the app.js api() helper
// (which adds the hub token).
export function mount(view, api) {
  const wrap = document.createElement('div');
  wrap.className = 'card';

  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = 'Loading store index…';

  const title = document.createElement('h2');
  title.textContent = 'Store items';

  const pkgTitle = document.createElement('h2');
  pkgTitle.textContent = 'Packages';

  const table = document.createElement('table');
  table.innerHTML = `<thead><tr><th>Item</th><th>Kind</th><th>Source</th><th>State</th><th>Preview</th></tr></thead>`;

  const pkgTable = document.createElement('table');
  pkgTable.innerHTML = `<thead><tr><th>Package</th><th>Version</th><th>Verify</th><th>Actions</th></tr></thead>`;

  const detail = document.createElement('pre');
  detail.className = 'note';
  wrap.append(note, title, table, detail, pkgTitle, pkgTable);
  view.appendChild(wrap);

  let data = null;

  const flagsText = (item) => Object.entries(item.installed || {})
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(',') || 'missing everywhere';

  const check = (input, targets) => {
    if (!input || !input.value || input.value !== targets) return null;
    return targets;
  };

  const typedInput = (targets) => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'confirm';
    input.spellcheck = false;
    input.placeholder = `type "${targets}" to confirm`;
    return input;
  };

  const drawItems = () => {
    const tbody = table.tBodies[0] || table.appendChild(document.createElement('tbody'));
    tbody.textContent = '';
    for (const item of data.items || []) {
      const tr = document.createElement('tr');
      const nm = document.createElement('td');
      nm.textContent = item.name;
      const kd = document.createElement('td');
      kd.textContent = item.kind;
      const src = document.createElement('td');
      src.textContent = item.source || '';
      const state = document.createElement('td');
      const dot = document.createElement('span');
      dot.className = `dot ${item.installed ? 'up' : 'down'}`;
      state.append(dot, document.createTextNode(` ${item.installed ? 'installed' : 'missing'} (${flagsText(item)})`));
      const actions = document.createElement('td');
      const btn = document.createElement('button');
      btn.textContent = 'preview';
      btn.addEventListener('click', () => preview(item));
      actions.appendChild(btn);
      if (!item.installed && !item.core) {
        const b2 = document.createElement('button');
        b2.textContent = 'install';
        const input = typedInput(item.name);
        b2.addEventListener('click', () => {
          if (!check(input, item.name)) { note.textContent = `Type "${item.name}" in the confirm field to install.`; return; }
          installItem(item, input);
        });
        actions.append(input, b2);
      } else if (!item.core) {
        const b3 = document.createElement('button');
        b3.textContent = 'rollback';
        const input = typedInput(item.name);
        b3.addEventListener('click', () => {
          if (!check(input, item.name)) { note.textContent = `Type "${item.name}" in the confirm field to roll back.`; return; }
          rollbackItem(item, input);
        });
        actions.append(input, b3);
      }
      tr.append(nm, kd, src, state, actions);
      tbody.appendChild(tr);
    }
  };

  const drawPackages = () => {
    const tbody = pkgTable.tBodies[0] || pkgTable.appendChild(document.createElement('tbody'));
    tbody.textContent = '';
    for (const p of data.packages || []) {
      if (p.error) {
        const tr = document.createElement('tr');
        const t = document.createElement('td');
        t.colSpan = 4;
        t.textContent = `${p.error}`;
        tr.appendChild(t);
        tbody.appendChild(tr);
        continue;
      }
      const tr = document.createElement('tr');
      const nm = document.createElement('td');
      nm.textContent = p.id;
      const ver = document.createElement('td');
      ver.textContent = p.version || (p.installed ? 'unknown' : 'not installed');
      const vf = document.createElement('td');
      vf.textContent = p.verify ? `${p.verify.ok ? 'ok' : 'broken'}${p.verify.detail ? ` (${p.verify.detail})` : ''}` : '—';
      const act = document.createElement('td');
      for (const action of ['install', 'update', 'repair']) {
        const b = document.createElement('button');
        b.textContent = action;
        const input = typedInput(p.id);
        b.addEventListener('click', () => {
          if (!check(input, p.id)) { note.textContent = `Type "${p.id}" in the confirm field to run ${action}.`; return; }
          packageAction(p, action);
        });
        act.append(input, b);
      }
      tr.append(nm, ver, vf, act);
      tbody.appendChild(tr);
    }
  };

  const preview = async (item) => {
    detail.textContent = 'previewing…';
    const { status, json } = await api('/api/store/preview', {
      body: { kind: item.kind, name: item.name, scope: 'global' },
    });
    detail.textContent = status === 200
      ? JSON.stringify(json, null, 2)
      : `preview failed (${status}): ${json.error || ''}`;
  };

  const installItem = async (item, input) => {
    note.textContent = `Installing ${item.name}…`;
    const { status, json } = await api('/api/store/install', {
      body: { name: item.name, kind: item.kind, scope: 'global', confirm: item.name },
    });
    note.textContent = status === 200
      ? `${json.ok ? '✔' : '✖'} ${item.name}:\n${json.stdout || ''}${json.stderr || ''}`
      : `install failed (${status}): ${json.error || ''}`;
    input.value = '';
    refresh();
  };

  const rollbackItem = async (item, input) => {
    note.textContent = `Rolling back ${item.name}…`;
    const { status, json } = await api('/api/store/rollback', {
      body: { name: item.name, confirm: item.name },
    });
    note.textContent = status === 200
      ? `${json.ok ? '✔' : '✖'} rolled back ${item.name}: ${json.restored || 0} target(s) restored${(json.parked || []).length ? `, parked: ${json.parked.join(', ')}` : ''}`
      : `rollback failed (${status}): ${json.error || ''}`;
    input.value = '';
    refresh();
  };

  const packageAction = async (p, action) => {
    note.textContent = `${action} ${p.id}…`;
    const { status, json } = await api(`/api/packages/${p.id}/${action}`, {
      body: { id: p.id, confirm: p.id },
    });
    note.textContent = status === 200 ? `${json.ok ? '✔' : '✖'} ${action} ${p.id}:\n${json.stdout || ''}${json.stderr || ''}` : `failed (${status}): ${json.error || ''}`;
    refresh();
  };

  const refresh = async () => {
    const { status, json } = await api('/api/store');
    if (status !== 200) { note.textContent = `store unavailable (${status}): ${json.error || ''}`; return; }
    data = json;
    drawItems();
    drawPackages();
    note.textContent = `pinned to ${json.pinned_commit || '—'}; installs are rename-backed and logged to ~/.aos/store/installs.jsonl`;
  };

  refresh();
  const timer = setInterval(refresh, 15000);
  return () => clearInterval(timer);
}
