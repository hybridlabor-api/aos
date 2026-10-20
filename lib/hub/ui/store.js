// WP4 Store tab: store items as cards (missing vs installed) with a slide-over
// inspector (SKILL.md for local items, a dry run that never installs), the
// typed-confirm install and rollback per card, and the package list with
// install/update/repair. Every fetch goes through the app.js api() helper
// (which adds the hub token). Fetched text is only ever set via textContent.
export function mount(view, api) {
  const node = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const button = (label, onClick, cls = '') => {
    const b = node('button', label, cls);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };

  const wrap = node('div', null, 'card');
  const note = node('p', 'Loading store index…', 'note');
  const title = node('h2', 'Store items');
  const grid = node('div', null, 's-grid');
  const pkgTitle = node('h2', 'Packages');
  const pkgTable = document.createElement('table');
  pkgTable.innerHTML = `<thead><tr><th>Package</th><th>Version</th><th>Verify</th><th>Actions</th></tr></thead>`;
  wrap.append(note, title, grid, pkgTitle, pkgTable);
  view.appendChild(wrap);

  const insp = node('aside', null, 's-insp');
  insp.id = 'inspector';
  insp.setAttribute('role', 'dialog');
  insp.setAttribute('aria-modal', 'true');
  insp.setAttribute('aria-label', 'Item inspector');
  insp.inert = true;
  const insKind = node('p', null, 'kicker');
  const insName = node('h2', null, 's-name-lg');
  insName.tabIndex = -1;
  const insMeta = node('div', null, 's-tags');
  const insBody = node('div', null, 's-insp-body');
  const dryOut = node('div', null, 's-insp-body');
  const dryRow = node('div', null, 's-foot');
  const dryBtn = button('Dry run', () => inspected && dryRun(inspected));
  dryRow.append(dryBtn, node('span', 'Shows what would be written. Installs nothing.', 's-muted'));
  const head = node('div', null, 's-insp-head');
  const titleBox = node('div');
  titleBox.append(insKind, insName);
  head.append(titleBox, button('Close', () => closeInspector()));
  insp.append(head, insMeta, insBody, dryRow, dryOut);
  document.body.appendChild(insp);

  let data = null;
  let inspected = null;
  let openerKey = null;
  let inspSeq = 0;
  let dryTok = 0;
  let pendingDraw = false;

  const flagsText = (item) => Object.entries(item.installed || {})
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(',') || 'missing everywhere';

  const check = (input, targets) => {
    if (!input || !input.value || input.value !== targets) return null;
    return targets;
  };

  const typedInput = (targets) => {
    const input = node('input', null, 'confirm');
    input.type = 'text';
    input.spellcheck = false;
    input.placeholder = `type "${targets}" to confirm`;
    return input;
  };

  const pre = (text) => node('pre', text, 's-pre');

  const tagRow = (item) => {
    const r = node('span', null, 's-tags');
    for (const t of [item.kind, item.category, item.source]) r.append(node('span', t, 's-tag'));
    return r;
  };

  const badgeRow = (item) => {
    const r = node('span', null, 's-tags');
    const add = (t, warn) => r.append(node('span', t, warn ? 's-tag warn' : 's-tag'));
    if (item.fileCount > 1) add(`${item.fileCount} files`);
    if (item.hasHooks) add('hooks');
    if (item.execBridge) add('exec bridge', true);
    if ((item.requires || []).length) add(`+${item.requires.length} required`);
    if (item.license) add(item.license);
    if (item.thirdParty) add('third-party');
    return r;
  };

  const openInspector = async (item, opener) => {
    inspected = item;
    openerKey = opener ? opener.dataset.key : null;
    const seq = ++inspSeq;
    insKind.textContent = item.kind;
    insName.textContent = item.name;
    dryRow.hidden = !!item.core;
    insMeta.replaceChildren(...[
      item.category, item.source, item.license,
      item.installed ? 'installed' : '', item.execBridge ? 'exec bridge' : '',
      item.hasHooks ? 'hooks' : '', item.thirdParty ? 'third-party' : '',
    ].filter(Boolean).map((t) => node('span', t, 's-tag')));
    insBody.replaceChildren(node('p', 'Loading…', 's-muted'));
    dryOut.replaceChildren();
    view.inert = true;
    insp.inert = false;
    insp.classList.add('open');
    insName.focus();

    let res;
    try {
      res = await api(`api/store/skill?name=${encodeURIComponent(item.name)}&kind=${encodeURIComponent(item.kind)}`);
    } catch (e) {
      res = { status: 0, json: { error: e.message } };
    }
    if (seq !== inspSeq) return;
    const kids = [];
    if (res.status === 200) {
      const d = res.json;
      kids.push(node('p', item.description || '', 's-muted'), node('p', `Path: ${d.path}`, 's-muted'));
      if (d.truncated) kids.push(node('p', 'Truncated at 200 KB.', 's-err'));
      kids.push(node('p', 'Frontmatter', 'kicker'), pre(d.frontmatter), node('p', 'SKILL.md', 'kicker'), pre(d.body));
    } else if (res.status === 404) {
      kids.push(node('p', item.description || '', 's-muted'), node('p', 'Full SKILL.md is shown after install.', 's-muted'));
    } else {
      kids.push(node('p', `SKILL.md unavailable (${res.status}): ${res.json.error || ''}`, 's-err'));
    }
    insBody.replaceChildren(...kids);
  };

  const closeInspector = () => {
    if (!inspected) return;
    inspected = null;
    inspSeq++;
    dryTok++;
    insp.classList.remove('open');
    insp.inert = true;
    view.inert = false;
    if (pendingDraw) redraw();
    [...grid.querySelectorAll('.s-main')].find((b) => b.dataset.key === openerKey)?.focus();
  };

  const dryRun = async (item) => {
    const tok = ++dryTok;
    dryOut.replaceChildren(node('p', 'Running dry run…', 's-muted'));
    let res;
    try {
      res = await api('api/store/preview', { body: { kind: item.kind, name: item.name, scope: 'global' } });
    } catch (e) {
      res = { status: 0, json: { error: e.message } };
    }
    if (tok !== dryTok) return;
    if (res.status !== 200) {
      dryOut.replaceChildren(node('p', `Dry run failed (${res.status}): ${res.json.error || ''}`, 's-err'));
      return;
    }
    const m = res.json.meta || {};
    const nodes = [
      node('p', `Dry run only: nothing was installed. Would install ${item.kind} ${item.name}. Scope: ${res.json.scope || 'not reported'}.`, 's-muted'),
      node('p', `Files: ${m.fileCount || 1}${m.totalSize ? ` (${(m.totalSize / 1024).toFixed(1)} KB)` : ''}`, 's-muted'),
      node('p', `Source: ${m.source || item.source}${m.license ? ` — ${m.license}` : ''}${m.copyright ? `, ${m.copyright}` : ''}${m.pinned_commit ? ` @ ${m.pinned_commit.slice(0, 10)}` : ''}`, 's-muted'),
    ];
    if (item.hasHooks) nodes.push(node('p', 'Includes hooks: copied only, NOT registered in your harness settings.', 's-err'));
    if (m.execBridge) nodes.push(node('p', 'Warning: contains a script that executes code received over a local socket or file channel without authentication.', 's-err'));
    else if (m.hasScripts) nodes.push(node('p', `Contains ${m.scriptCount} script file(s) that run on your machine when the skill is used.`, 's-muted'));
    if (m.software?.length) nodes.push(node('p', `Needs third-party software that is not included: ${m.software.join(', ')}.`, 's-muted'));
    if (m.requires?.length) nodes.push(node('p', `Would also install required skill(s): ${m.requires.join(', ')}.`, 's-muted'));
    dryOut.replaceChildren(...nodes);
  };

  const onKey = (e) => {
    if (e.key === 'Escape' && inspected) { e.preventDefault(); closeInspector(); }
  };
  document.addEventListener('keydown', onKey);

  const card = (item) => {
    const art = node('article', null, 's-card');
    const main = node('button', null, 's-main');
    main.type = 'button';
    main.dataset.key = `${item.kind}:${item.name}`;
    main.append(node('span', item.name, 's-name'), tagRow(item), node('span', item.description || '', 's-desc'), badgeRow(item));
    main.addEventListener('click', () => openInspector(item, main));

    const foot = node('div', null, 's-foot');
    const state = node('span', null, 's-state');
    state.append(node('span', null, `dot ${item.installed ? 'up' : 'down'}`), document.createTextNode(` ${item.installed ? 'installed' : 'missing'} (${flagsText(item)})`));
    foot.append(state);
    if (!item.core) {
      foot.append(button('Dry run', () => { openInspector(item, main); dryRun(item); }));
      const input = typedInput(item.name);
      if (!item.installed) {
        foot.append(input, button('install', () => {
          if (!check(input, item.name)) { note.textContent = `Type "${item.name}" in the confirm field to install.`; return; }
          installItem(item, input);
        }));
      } else {
        foot.append(input, button('rollback', () => {
          if (!check(input, item.name)) { note.textContent = `Type "${item.name}" in the confirm field to roll back.`; return; }
          rollbackItem(item, input);
        }));
      }
    }
    art.append(main, foot);
    return art;
  };

  const drawItems = () => {
    grid.replaceChildren(...(data.items || []).map(card));
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

  const installItem = async (item, input) => {
    note.textContent = `Installing ${item.name}…`;
    const { status, json } = await api('api/store/install', {
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
    const { status, json } = await api('api/store/rollback', {
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
    const { status, json } = await api(`api/packages/${p.id}/${action}`, {
      body: { id: p.id, confirm: p.id },
    });
    note.textContent = status === 200 ? `${json.ok ? '✔' : '✖'} ${action} ${p.id}:\n${json.stdout || ''}${json.stderr || ''}` : `failed (${status}): ${json.error || ''}`;
    refresh();
  };

  const typing = () => (wrap.contains(document.activeElement) && document.activeElement.tagName === 'INPUT')
    || [...wrap.querySelectorAll('input')].some((i) => i.value);

  const redraw = () => {
    pendingDraw = false;
    drawItems();
    drawPackages();
  };

  const refresh = async () => {
    const { status, json } = await api('api/store');
    if (status !== 200) { note.textContent = `store unavailable (${status}): ${json.error || ''}`; return; }
    data = json;
    if (inspected || typing()) pendingDraw = true;
    else redraw();
    note.textContent = `pinned to ${json.pinned_commit || '—'}; installs are rename-backed and logged to ~/.aos/store/installs.jsonl`;
  };

  refresh();
  const timer = setInterval(refresh, 15000);
  return () => {
    clearInterval(timer);
    document.removeEventListener('keydown', onKey);
    insp.remove();
    view.inert = false;
  };
}
