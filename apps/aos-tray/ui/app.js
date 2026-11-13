// Settings window. All data is rendered with textContent (never innerHTML). Every
// state-changing call goes to a Rust command that shows its own native confirmation.
'use strict';
const invoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);
const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
const errText = (e) => (typeof e === 'string' ? e : (e && e.message) || String(e));
const quiet = (e) => errText(e) === 'cancelled';

async function busy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } finally { btn.disabled = false; }
}

// ---------------------------------------------------------------- tabs
const loaders = {};
for (const b of document.querySelectorAll('#tabs button')) {
  b.addEventListener('click', () => {
    for (const x of document.querySelectorAll('#tabs button')) x.classList.toggle('active', x === b);
    for (const s of document.querySelectorAll('.tab')) s.classList.toggle('active', s.id === b.dataset.tab);
    if (loaders[b.dataset.tab]) loaders[b.dataset.tab]();
  });
}

// ---------------------------------------------------------------- status
loaders.status = async () => {
  const box = $('status-body');
  box.textContent = 'Loading...';
  try {
    const s = await invoke('get_status');
    box.textContent = '';
    const dl = el('table');
    const row = (k, v, cls) => { const tr = el('tr'); tr.append(el('th', k), el('td', v, cls)); dl.append(tr); };
    row('Installed', s.installed ? 'yes' : 'no', s.installed ? 'ok' : 'bad');
    row('Version', s.version || '-');
    row('Latest (cached)', s.latest || 'unknown');
    row('Update available', s.update_available ? 'yes' : 'no', s.update_available ? 'bad' : 'ok');
    row('Profile', s.settings.profile || '-');
    row('Disabled packages', s.settings.disabled.join(', ') || '-');
    row('Update mode', s.settings.updates || '-');
    if (s.elevated) row('Warning', 'Running as administrator/root: changes are refused.', 'bad');
    if (s.services_error) row('Services', s.services_error, 'bad');
    for (const sv of s.services) row(`Service ${sv.name || sv.id}`, sv.up === true ? 'up' : sv.up === false ? (sv.status || 'down') : '?', sv.up === true ? 'ok' : sv.up === false ? 'bad' : '');
    box.append(dl);
    $('btn-install').disabled = s.installed;
    $('btn-update').disabled = !s.installed;
    $('btn-repair').disabled = !s.installed;
  } catch (e) { box.textContent = errText(e); }
};
$('btn-refresh').onclick = () => loaders.status();

for (const kind of ['install', 'update', 'repair']) {
  const btn = $(`btn-${kind}`);
  btn.onclick = () => busy(btn, async () => {
    const out = $('action-out');
    out.hidden = false;
    out.textContent = `${kind} running... this can take several minutes.`;
    try { out.textContent = await invoke('lifecycle', { kind }); }
    catch (e) { out.textContent = quiet(e) ? 'Cancelled.' : `Failed: ${errText(e)}`; }
    loaders.status();
  });
}

$('btn-doctor').onclick = () => busy($('btn-doctor'), async () => {
  const box = $('doctor-body');
  box.textContent = 'Running doctor...';
  try {
    const d = await invoke('run_doctor');
    box.textContent = '';
    box.append(el('h3', d.ok ? 'Doctor: all checks ok' : 'Doctor: problems found', d.ok ? 'ok' : 'bad'));
    const t = el('table');
    for (const r of d.results.filter((r) => !r.ok)) {
      const tr = el('tr');
      const detail = [r.detail, r.fix ? `Fix: ${r.fix}` : ''].filter(Boolean).map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n');
      tr.append(el('td', r.warningOnly ? 'warn' : 'fail', r.warningOnly ? '' : 'bad'), el('td', `${r.area} / ${r.name}`), el('td', detail));
      t.append(tr);
    }
    box.append(t);
  } catch (e) { box.textContent = errText(e); }
});
$('btn-hub').onclick = () => invoke('open_hub', { tab: 'services' }).catch((e) => alertText(e));

function alertText(e) { $('action-out').hidden = false; $('action-out').textContent = errText(e); }

// ---------------------------------------------------------------- store
loaders.store = async () => {
  const ul = $('skills');
  ul.textContent = '';
  try { for (const s of await invoke('list_skills')) ul.append(el('li', s)); } catch (e) { ul.append(el('li', errText(e), 'bad')); }
  $('packs').textContent = 'Loading...';
  try { $('packs').textContent = await invoke('store_packs'); } catch (e) { $('packs').textContent = errText(e); }
};
$('btn-store').onclick = () => invoke('open_hub', { tab: 'store' }).catch((e) => { $('packs').textContent = errText(e); });

// ---------------------------------------------------------------- MCP
loaders.mcp = async () => {
  const tbody = $('gw-rows');
  tbody.textContent = '';
  $('gw-summary').textContent = 'Loading...';
  let v;
  try { v = await invoke('gateway_status'); } catch (e) { $('gw-summary').textContent = errText(e); return; }
  const st = v.status;
  $('gw-summary').textContent = st ? (st.running ? `Gateway running on 127.0.0.1:${st.port}` : `Gateway not running${st.error ? `: ${st.error}` : ''}`) : `Gateway status unavailable: ${v.error}`;
  const selected = new Map((st ? st.upstreams : []).map((u) => [u.name, u]));
  const names = [...new Set([...selected.keys(), ...v.known])].sort();
  for (const name of names) {
    const u = selected.get(name);
    const tr = el('tr');
    const state = u ? (u.ok ? 'ok' : u.busy ? 'starting' : u.degraded ? 'degraded' : 'failing') : 'not selected';
    tr.append(el('td', name), el('td', u && u.error ? `${state}: ${u.error}` : state, u ? (u.ok ? 'ok' : 'bad') : 'hint'));
    const td = el('td');
    if (v.known.includes(name)) {
      const b = el('button', u ? 'Remove' : 'Add');
      b.onclick = () => busy(b, async () => {
        const out = $('gw-out');
        out.hidden = false;
        out.textContent = 'Working...';
        try { out.textContent = await invoke('gateway_change', { server: name, add: !u }); }
        catch (e) { out.textContent = quiet(e) ? 'Cancelled.' : errText(e); }
        loaders.mcp();
      });
      td.append(b);
    }
    tr.append(td);
    tbody.append(tr);
  }
};

// ---------------------------------------------------------------- AGENTS.md
let agentsFingerprint = null;
loaders.agents = async () => {
  $('agents-msg').textContent = '';
  try {
    const l = await invoke('agents_md_load');
    $('agents-text').value = l.text;
    agentsFingerprint = l.fingerprint;
    if (!l.exists) $('agents-msg').textContent = '~/AGENTS.md does not exist yet; saving creates it.';
  } catch (e) { $('agents-msg').textContent = errText(e); }
};
$('btn-agents-reload').onclick = () => loaders.agents();
$('btn-agents-save').onclick = () => busy($('btn-agents-save'), async () => {
  if (agentsFingerprint === null) return;
  try {
    $('agents-msg').textContent = await invoke('agents_md_save', { text: $('agents-text').value, fingerprint: agentsFingerprint });
    await loaders.agents();
  } catch (e) { $('agents-msg').textContent = quiet(e) ? 'Cancelled.' : errText(e); }
});

// ---------------------------------------------------------------- secrets
loaders.secrets = async () => {
  const tbody = $('secret-rows');
  tbody.textContent = '';
  try {
    for (const s of await invoke('secrets_list')) {
      const tr = el('tr');
      const b = el('button', 'Remove');
      b.onclick = () => busy(b, async () => {
        try { await invoke('secrets_remove', { name: s.name }); $('secret-msg').textContent = `${s.name} removed.`; }
        catch (e) { $('secret-msg').textContent = quiet(e) ? 'Cancelled.' : errText(e); }
        loaders.secrets();
      });
      const td = el('td'); td.append(b);
      tr.append(el('td', s.name), el('td', s.has_value ? '••••••••' : '(empty)', 'hint'), td);
      tbody.append(tr);
    }
  } catch (e) { const tr = el('tr'); tr.append(el('td', errText(e), 'bad')); tbody.append(tr); }
};
$('secret-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const name = $('secret-name').value.trim();
  const value = $('secret-value').value;
  try {
    await invoke('secrets_set', { name, value });
    $('secret-msg').textContent = `${name} saved.`;
    $('secret-name').value = '';
  } catch (e) { $('secret-msg').textContent = quiet(e) ? 'Cancelled.' : errText(e); }
  // Clear the value from the DOM in every case.
  $('secret-value').value = '';
  loaders.secrets();
});

// ---------------------------------------------------------------- advanced
$('btn-router').onclick = () => invoke('router_show').then((t) => { $('adv-out').textContent = t; }, (e) => { $('adv-out').textContent = errText(e); });
$('btn-memory').onclick = () => invoke('memory_list').then((t) => { $('adv-out').textContent = t; }, (e) => { $('adv-out').textContent = errText(e); });

loaders.status();
