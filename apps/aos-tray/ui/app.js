// AOS App main window. All data is rendered with textContent (never innerHTML). Every
// state-changing call goes to a Rust command that shows its own native confirmation.
import { t as translate, detectLang } from './i18n.js';
import { SCREENS, screenFromHash, servicesSummary, serviceState, doctorSummary, detailText, upstreamRows, restartConfirmed, gitBadge, projectName, secretRows, routerRows, toggleTarget, moveTarget } from './logic.js';

const invoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);
const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined && text !== null) e.textContent = text; if (cls) e.className = cls; return e; };
const errText = (e) => (typeof e === 'string' ? e : (e && e.message) || String(e));
const quiet = (e) => errText(e) === 'cancelled';

// ---------------------------------------------------------------- language
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
let lang = detectLang(store.get('aos.lang'), navigator.languages || [navigator.language]);
const t = (key, vars) => translate(lang, key, vars);

function applyStrings() {
  document.documentElement.lang = lang;
  for (const n of document.querySelectorAll('[data-i18n]')) n.textContent = t(n.dataset.i18n);
  for (const n of document.querySelectorAll('[data-i18n-aria]')) n.setAttribute('aria-label', t(n.dataset.i18nAria));
  for (const a of document.querySelectorAll('#nav a')) { a.title = t(`nav.${a.dataset.screen}`); }
  $('lang').value = lang;
}
$('lang').addEventListener('change', () => { lang = $('lang').value; store.set('aos.lang', lang); applyStrings(); show(current, true); });

// ---------------------------------------------------------------- helpers
async function busy(btn, fn) { btn.disabled = true; try { await fn(); } finally { btn.disabled = false; } }
function skeleton(box, lines = 2) { box.textContent = ''; for (let i = 0; i < lines; i++) box.append(el('div', null, i ? 'skeleton short' : 'skeleton')); }
function status(text, tone) { return el('span', text, `status ${tone || ''}`); }
function rawBlock(box, parsed) {
  box.append(el('p', t('common.raw'), 'note'));
  if (parsed.raw) box.append(el('pre', parsed.raw));
  else if (parsed.error) box.append(el('pre', parsed.error));
}
function errorRow(box, e, retry) {
  const p = el('p', t('common.failed', { e: errText(e) }), 'bad');
  box.append(p);
  if (retry) { const b = el('button', t('common.retry'), 'btn small'); b.onclick = retry; box.append(b); }
}

// ---------------------------------------------------------------- routing
const loaders = {};
let current = null;
function show(id, force) {
  if (!SCREENS.includes(id)) id = 'home';
  for (const s of document.querySelectorAll('[data-view]')) s.hidden = s.dataset.view !== id;
  for (const a of document.querySelectorAll('#nav a')) { if (a.dataset.screen === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  const changed = current !== id;
  current = id;
  if ((changed || force) && loaders[id]) loaders[id]();
  if (changed) $('main').focus({ preventScroll: true });
}
window.addEventListener('hashchange', () => show(screenFromHash(location.hash)));

// ---------------------------------------------------------------- home
let lastDoctor = null;
loaders.home = async () => {
  skeleton($('home-version')); skeleton($('home-services'));
  if (!lastDoctor) $('home-doctor-body').textContent = t('home.doctorIdle');
  try {
    const s = await invoke('get_status');
    $('home-elevated').hidden = !s.elevated;
    const v = $('home-version'); v.textContent = '';
    if (!s.installed) v.append(el('div', t('home.notInstalled'), 'metric bad'));
    else {
      v.append(el('div', s.version || t('common.none'), 'metric'));
      v.append(el('p', s.update_available ? t('home.updateAvailable', { v: s.latest }) : t('home.upToDate'), s.update_available ? 'warn' : 'muted'));
    }
    $('side-version').textContent = s.version ? `AOS ${s.version}` : '';
    const box = $('home-services'); box.textContent = '';
    if (s.services_error) { box.append(el('p', s.services_error, 'bad')); }
    else {
      const sum = servicesSummary(s.services);
      box.append(el('div', t('home.servicesUp', { up: sum.up, total: sum.total }), `metric ${sum.tone}`));
      if (sum.down.length) box.append(el('p', t('home.servicesDown', { list: sum.down.join(', ') }), 'bad'));
    }
  } catch (e) { $('home-version').textContent = ''; errorRow($('home-version'), e, loaders.home); $('home-services').textContent = ''; }
  if (lastDoctor) renderDoctor(lastDoctor);
};
$('home-refresh').onclick = () => loaders.home();
$('home-doctor').onclick = () => busy($('home-doctor'), async () => {
  const box = $('home-doctor-body');
  box.textContent = ''; box.append(el('p', t('home.doctorRunning'), 'note')); box.append(el('div', null, 'skeleton'));
  try { lastDoctor = await invoke('doctor_view'); renderDoctor(lastDoctor); }
  catch (e) { box.textContent = ''; errorRow(box, e); }
});
function renderDoctor(p) {
  const box = $('home-doctor-body'); box.textContent = '';
  if (!p.data) { rawBlock(box, p); return; }
  const sum = doctorSummary(p.data);
  box.append(el('div', sum.tone === 'ok' ? t('home.doctorOk', { n: sum.total }) : t('home.doctorBad', { fail: sum.fail, warn: sum.warn }), `metric ${sum.tone}`));
  const ul = el('ul', null, 'rows');
  for (const r of p.data.results.filter((r) => !r.ok)) {
    const li = el('li', null, 'row');
    const main = el('div', null, 'row-main');
    main.append(el('div', `${r.area} / ${r.name}`, 'row-title'));
    const d = [detailText(r.detail), r.fix ? `Fix: ${detailText(r.fix)}` : ''].filter(Boolean).join(' — ');
    if (d) main.append(el('div', d, 'row-sub'));
    li.append(status(r.warningOnly ? 'warn' : 'fail', r.warningOnly ? 'warn' : 'bad'), main);
    ul.append(li);
  }
  if (ul.childElementCount) box.append(ul);
}

// ---------------------------------------------------------------- store
loaders.store = async () => {
  const ul = $('store-skills'); ul.textContent = '';
  try {
    const skills = await invoke('list_skills');
    if (!skills.length) ul.append(el('li', t('store.noSkills')));
    for (const s of skills) ul.append(el('li', s));
  } catch (e) { ul.append(el('li', errText(e), 'bad')); }
  $('store-packs').textContent = t('common.loading');
  try { $('store-packs').textContent = await invoke('store_packs'); } catch (e) { $('store-packs').textContent = errText(e); }
};
$('store-open').onclick = () => busy($('store-open'), async () => {
  $('store-msg').textContent = t('store.opening');
  try { await invoke('open_store'); $('store-msg').textContent = t('store.opened'); }
  catch (e) { $('store-msg').textContent = t('common.failed', { e: errText(e) }); }
});

// ---------------------------------------------------------------- services
loaders.services = async () => {
  const ul = $('services-rows'); ul.textContent = '';
  $('services-msg').textContent = t('common.loading');
  try {
    const p = await invoke('services_view');
    $('services-msg').textContent = '';
    if (!p.data) { rawBlock($('services-msg'), p); }
    else for (const s of p.data) ul.append(serviceRow(s));
  } catch (e) { $('services-msg').textContent = t('common.failed', { e: errText(e) }); }
  loadGateway();
};
$('services-refresh').onclick = () => loaders.services();

function serviceRow(s) {
  const li = el('li', null, 'row');
  const st = serviceState(s);
  const main = el('div', null, 'row-main');
  main.append(el('div', s.name || s.id, 'row-title'));
  main.append(el('div', [s.id, s.version ? `v${s.version}` : '', s.url || ''].filter(Boolean).join(' · '), 'row-sub'));
  const actions = el('div', null, 'row-actions');
  const btn = el('button', t('services.restart'), 'btn small');
  btn.onclick = () => openRestart(actions, s.id, btn);
  actions.append(btn);
  li.append(status(s.status || t(`services.${st}`), st === 'up' ? 'ok' : st === 'down' ? 'bad' : 'warn'), main, actions);
  return li;
}

/** Inline typed confirm: the restart button only enables once the id is typed exactly. */
function openRestart(actions, id, trigger) {
  trigger.hidden = true;
  const input = el('input', null, 'small');
  input.setAttribute('aria-label', t('services.restartPrompt', { id }));
  input.placeholder = id; input.spellcheck = false; input.autocomplete = 'off';
  const go = el('button', t('services.restartGo'), 'btn small danger'); go.disabled = true;
  const cancel = el('button', '×', 'btn small'); cancel.setAttribute('aria-label', t('common.cancel'));
  const close = () => { input.remove(); go.remove(); cancel.remove(); trigger.hidden = false; trigger.focus(); };
  input.addEventListener('input', () => { go.disabled = !restartConfirmed(input.value, id); });
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); if (ev.key === 'Enter' && !go.disabled) go.click(); });
  cancel.onclick = close;
  go.onclick = () => busy(go, async () => {
    if (!restartConfirmed(input.value, id)) { $('services-msg').textContent = t('services.restartMismatch'); return; }
    $('services-msg').textContent = t('services.restarting', { id });
    try { await invoke('service_restart', { id, typed: input.value }); $('services-msg').textContent = t('services.restarted', { id }); }
    catch (e) { $('services-msg').textContent = quiet(e) ? t('common.cancelled') : t('common.failed', { e: errText(e) }); }
    close(); loaders.services();
  });
  actions.append(input, go, cancel);
  input.focus();
}

async function loadGateway() {
  const ul = $('gw-rows'); ul.textContent = '';
  $('gw-summary').textContent = t('common.loading');
  let v;
  try { v = await invoke('gateway_status'); } catch (e) { $('gw-summary').textContent = t('common.failed', { e: errText(e) }); return; }
  const st = v.status;
  $('gw-summary').textContent = st ? (st.running ? t('services.gatewayRunning', { port: st.port }) : `${t('services.gatewayDown')}${st.error ? `: ${st.error}` : ''}`) : t('services.gatewayUnavailable', { e: v.error });
  for (const r of upstreamRows(st, v.known)) {
    const li = el('li', null, 'row');
    const main = el('div', null, 'row-main');
    main.append(el('div', r.name, 'row-title'));
    if (r.upstream && r.upstream.error) main.append(el('div', r.upstream.error, 'row-sub'));
    const tone = r.state === 'ok' ? 'ok' : r.state === 'notSelected' ? 'muted' : r.state === 'starting' ? 'warn' : 'bad';
    const actions = el('div', null, 'row-actions');
    if (r.changeable) {
      const b = el('button', t(r.upstream ? 'services.remove' : 'services.add'), 'btn small');
      b.onclick = () => busy(b, async () => {
        $('gw-summary').textContent = t('services.working');
        try { $('gw-summary').textContent = await invoke('gateway_change', { server: r.name, add: !r.upstream }); }
        catch (e) { $('gw-summary').textContent = quiet(e) ? t('common.cancelled') : errText(e); }
        loadGateway();
      });
      actions.append(b);
    }
    li.append(status(t(`services.${r.state}`), tone), main, actions);
    ul.append(li);
  }
}

// ---------------------------------------------------------------- router
loaders.router = async () => {
  const ul = $('router-rows'); ul.textContent = '';
  const msg = $('router-msg'); msg.textContent = ''; skeleton(msg, 2);
  try {
    const p = await invoke('router_view');
    msg.textContent = '';
    if (!p.data) { rawBlock(msg, p); return; }
    msg.textContent = t(p.data.enforce ? 'router.enforce' : 'router.notEnforced');
    for (const r of routerRows(p.data)) ul.append(routerRow(r, p.data.known_targets));
  } catch (e) { msg.textContent = ''; errorRow(msg, e, loaders.router); }
};
$('router-refresh').onclick = () => loaders.router();

function routerRow(r, known) {
  const li = el('li', null, 'row col');
  const head = el('div', null, 'row');
  const main = el('div', null, 'row-main');
  main.append(el('div', r.role, 'row-title'));
  const tags = el('div', null, 'tags');
  const show = (list) => { tags.textContent = ''; if (!list.length) tags.append(el('span', t('router.none'), 'tag')); for (const x of list) tags.append(el('span', x, 'tag')); };
  show(r.targets);
  main.append(tags);
  const actions = el('div', null, 'row-actions');
  const edit = el('button', t('router.edit'), 'btn small');
  actions.append(edit);
  head.append(status(t(`router.source.${r.source}`), r.source === 'shipped' ? 'muted' : 'ok'), main, actions);
  li.append(head);
  edit.onclick = () => {
    edit.hidden = true;
    let list = r.targets.slice();
    const box = el('div', null, 'editor');
    const draw = () => {
      box.textContent = '';
      box.append(el('p', t('router.targets'), 'note'));
      for (const name of list) {
        const line = el('div', null, 'edit-line');
        const up = el('button', '↑', 'btn small'); up.setAttribute('aria-label', t('router.up'));
        const down = el('button', '↓', 'btn small'); down.setAttribute('aria-label', t('router.down'));
        const rm = el('button', '×', 'btn small'); rm.setAttribute('aria-label', t('common.cancel'));
        up.onclick = () => { list = moveTarget(list, name, -1); draw(); };
        down.onclick = () => { list = moveTarget(list, name, 1); draw(); };
        rm.onclick = () => { list = toggleTarget(list, name); draw(); };
        line.append(el('span', name, 'mono grow'), up, down, rm);
        box.append(line);
      }
      const rest = known.filter((k) => !list.includes(k));
      if (rest.length) {
        const sel = el('select', null, 'select'); sel.setAttribute('aria-label', t('router.pick'));
        sel.append(new Option(t('router.pick'), ''));
        for (const k of rest) sel.append(new Option(k, k));
        sel.onchange = () => { if (sel.value) { list = toggleTarget(list, sel.value); draw(); } };
        box.append(sel);
      }
      const save = el('button', t('router.save'), 'btn primary small'); save.disabled = !list.length;
      const cancel = el('button', t('common.cancel'), 'btn small');
      cancel.onclick = () => { box.remove(); edit.hidden = false; edit.focus(); };
      save.onclick = () => busy(save, async () => {
        try { await invoke('router_set', { role: r.role, targets: list }); $('router-msg').textContent = t('router.saved'); loaders.router(); }
        catch (e) { $('router-msg').textContent = quiet(e) ? t('common.cancelled') : t('common.failed', { e: errText(e) }); }
      });
      const bar = el('div', null, 'actions'); bar.append(save, cancel);
      box.append(bar);
    };
    draw();
    li.append(box);
  };
  return li;
}

// ---------------------------------------------------------------- projects
loaders.projects = async () => {
  const ul = $('projects-rows'); ul.textContent = '';
  const msg = $('projects-msg'); msg.textContent = ''; skeleton(msg, 3);
  try {
    const v = await invoke('projects_list');
    msg.textContent = '';
    if (v.error) { msg.append(el('span', v.error, 'warn')); return; }
    if (!v.projects.length) { msg.textContent = t('projects.empty'); return; }
    msg.textContent = t('projects.count', { n: v.projects.length, root: v.root });
    for (const p of v.projects) {
      const li = el('li', null, 'row');
      const main = el('div', null, 'row-main');
      main.append(el('div', projectName(p), 'row-title'));
      const tags = el('div', null, 'tags');
      if (p.meta) {
        if (p.meta.slug) tags.append(el('span', `${t('projects.slug')}: ${p.meta.slug}`, 'tag'));
        if (p.meta.domain) tags.append(el('span', `${t('projects.domain')}: ${p.meta.domain}`, 'tag'));
      } else tags.append(el('span', t('projects.noMeta'), 'tag'));
      tags.append(el('span', t(p.wiki ? 'projects.wiki' : 'projects.noWiki'), 'tag'));
      if (projectName(p) !== p.dir) main.append(el('div', p.dir, 'row-sub'));
      main.append(tags);
      const g = gitBadge(p);
      li.append(main, status(t(g.key, { n: g.n }), g.tone));
      ul.append(li);
    }
  } catch (e) { msg.textContent = ''; errorRow(msg, e, loaders.projects); }
};
$('projects-refresh').onclick = () => loaders.projects();

// ---------------------------------------------------------------- secrets (names and status only)
loaders.secrets = async () => {
  const ul = $('secret-rows'); ul.textContent = '';
  try {
    const rows = secretRows(await invoke('secrets_list'));
    if (!rows.length) { $('secret-msg').textContent = t('secrets.none'); return; }
    for (const s of rows) {
      const li = el('li', null, 'row');
      const main = el('div', null, 'row-main'); main.append(el('div', s.name, 'row-title mono'));
      const b = el('button', t('secrets.remove'), 'btn small danger');
      b.onclick = () => busy(b, async () => {
        try { await invoke('secrets_remove', { name: s.name }); $('secret-msg').textContent = t('secrets.removed', { name: s.name }); }
        catch (e) { $('secret-msg').textContent = quiet(e) ? t('common.cancelled') : errText(e); }
        loaders.secrets();
      });
      const actions = el('div', null, 'row-actions'); actions.append(b);
      li.append(status(t(s.set ? 'secrets.set' : 'secrets.empty'), s.set ? 'ok' : 'muted'), main, actions);
      ul.append(li);
    }
  } catch (e) { $('secret-msg').textContent = errText(e); }
};
$('secret-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const name = $('secret-name').value.trim();
  const value = $('secret-value').value;
  try { await invoke('secrets_set', { name, value }); $('secret-msg').textContent = t('secrets.saved', { name }); $('secret-name').value = ''; }
  catch (e) { $('secret-msg').textContent = quiet(e) ? t('common.cancelled') : errText(e); }
  // Clear the value from the DOM in every case.
  $('secret-value').value = '';
  loaders.secrets();
});

// ---------------------------------------------------------------- settings
loaders.settings = async () => {
  try {
    const s = await invoke('get_status');
    $('btn-install').disabled = s.installed; $('btn-update').disabled = !s.installed; $('btn-repair').disabled = !s.installed;
  } catch { /* buttons stay enabled; Rust re-checks */ }
  loadAgents();
};
for (const kind of ['install', 'update', 'repair']) {
  const btn = $(`btn-${kind}`);
  btn.onclick = () => busy(btn, async () => {
    const out = $('action-out'); out.hidden = false;
    out.textContent = t('settings.running', { kind: t(`settings.${kind}`) });
    try { out.textContent = await invoke('lifecycle', { kind }); }
    catch (e) { out.textContent = quiet(e) ? t('common.cancelled') : t('common.failed', { e: errText(e) }); }
  });
}
let agentsFingerprint = null;
async function loadAgents() {
  $('agents-msg').textContent = '';
  try {
    const l = await invoke('agents_md_load');
    $('agents-text').value = l.text; agentsFingerprint = l.fingerprint;
    if (!l.exists) $('agents-msg').textContent = t('settings.agentsMissing');
  } catch (e) { $('agents-msg').textContent = errText(e); }
}
$('btn-agents-reload').onclick = () => loadAgents();
$('btn-agents-save').onclick = () => busy($('btn-agents-save'), async () => {
  if (agentsFingerprint === null) return;
  try { $('agents-msg').textContent = await invoke('agents_md_save', { text: $('agents-text').value, fingerprint: agentsFingerprint }); await loadAgents(); }
  catch (e) { $('agents-msg').textContent = quiet(e) ? t('common.cancelled') : errText(e); }
});
const adv = (cmd) => () => { const o = $('adv-out'); o.hidden = false; o.textContent = t('common.loading'); invoke(cmd).then((x) => { o.textContent = x; }, (e) => { o.textContent = errText(e); }); };
$('btn-router').onclick = adv('router_show');
$('btn-memory').onclick = adv('memory_list');

applyStrings();
show(screenFromHash(location.hash));
