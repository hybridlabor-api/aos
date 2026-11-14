// AOS App main window. All data is rendered with textContent (never innerHTML). Every
// state-changing call goes to a Rust command that shows its own native confirmation.
import { t as translate, detectLang } from './i18n.js';
import { SCREENS, screenFromHash, servicesSummary, serviceState, doctorSummary, detailText, upstreamRows, restartConfirmed, gitBadge, projectName, secretRows, routerRows, toggleTarget, moveTarget, awakeStatus, codenotchState, filterItems, itemActions, gatewayCounts, gogateTone } from './logic.js';

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
  for (const n of document.querySelectorAll('[data-i18n-ph]')) n.placeholder = t(n.dataset.i18nPh);
  for (const b of document.querySelectorAll('.presets [data-min]')) b.textContent = t('awake.preset', { n: b.dataset.min });
  for (const a of document.querySelectorAll('#nav a')) { a.title = t(`nav.${a.dataset.screen}`); }
  $('lang').value = lang;
}
$('lang').addEventListener('change', () => { lang = $('lang').value; store.set('aos.lang', lang); applyStrings(); show(current, true); });

// ---------------------------------------------------------------- helpers
async function busy(btn, fn) {
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try { await fn(); } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
}
function skeleton(box, lines = 2) { box.textContent = ''; for (let i = 0; i < lines; i++) box.append(el('div', null, i ? 'skeleton short' : 'skeleton')); }
function status(text, tone) { return el('span', text, `status ${tone || ''}`); }
function rawBlock(box, parsed) {
  box.append(el('p', t('common.raw'), 'note'));
  if (parsed.raw) box.append(el('pre', parsed.raw));
  else if (parsed.error) box.append(el('pre', parsed.error));
}
function errorRow(box, e, retry) {
  const wrap = el('div', null, 'errbox');
  wrap.append(el('p', t('common.failed', { e: errText(e) }), 'bad'));
  if (retry) { const b = el('button', t('common.retry'), 'btn small'); b.onclick = retry; wrap.append(b); }
  box.append(wrap);
}
/** Friendly empty state: one line of text and an optional next action. */
function emptyState(text, actionLabel, onAction) {
  const box = el('div', null, 'empty');
  box.append(el('p', text, 'empty-text'));
  if (actionLabel) { const b = el('button', actionLabel, 'btn small'); b.type = 'button'; b.onclick = onAction; box.append(b); }
  return box;
}

// ---------------------------------------------------------------- motion helpers (presentation only)
const reduceMotion = () => Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) { const n = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v)); return n; }

/** Sets a ring's fill (0..1). With fromZero the ring starts empty and fills on the next frame. */
function setRing(wrap, p, fromZero) {
  const v = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0));
  if (!fromZero || reduceMotion()) { wrap.style.setProperty('--p', String(v)); return; }
  wrap.style.setProperty('--p', '0');
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.style.setProperty('--p', String(v))));
}
/** Small progress ring in a tone colour. Decorative: the number next to it carries the meaning. */
function ring(p, tone, size = 'm') {
  const wrap = el('span', null, `ring ring-${size}`);
  wrap.dataset.tone = tone || 'muted';
  wrap.setAttribute('aria-hidden', 'true');
  const s = svgEl('svg', { viewBox: '0 0 36 36' });
  s.append(svgEl('circle', { class: 'ring-track', cx: 18, cy: 18, r: 15.5 }), svgEl('circle', { class: 'ring-fill', cx: 18, cy: 18, r: 15.5 }));
  wrap.append(s);
  setRing(wrap, p, true);
  return wrap;
}
/** Counts a number up from 0 with an ease-out; instant under reduced motion. */
function countUp(node, to) {
  const end = Math.max(0, Math.round(Number(to) || 0));
  if (reduceMotion() || end === 0) { node.textContent = String(end); return; }
  const dur = Math.min(900, 380 + end * 40);
  const t0 = performance.now();
  node.textContent = '0';
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    node.textContent = String(Math.round(end * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
/** Big tabular number "n/total". Visual only; a caption next to it carries the sentence. */
function stat(n, total) {
  const box = el('div', null, 'stat');
  box.setAttribute('aria-hidden', 'true');
  const num = el('span', null, 'stat-num'); countUp(num, n); box.append(num);
  if (total !== undefined) box.append(el('span', `/${total}`, 'stat-of'));
  return box;
}
function statRow(...kids) { const r = el('div', null, 'stat-row'); r.append(...kids); return r; }
/** Re-runs a one-shot CSS animation class on a node. */
function replay(node, cls) { if (!node) return; node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); }
/** Sets the tone of the tile (or card) around a body element; pops its dot when the tone changes. */
function setTone(id, tone) {
  const host = $(id) && $(id).closest('.tile, .card');
  if (!host || host.dataset.tone === tone) return;
  host.dataset.tone = tone;
  replay(host.querySelector('.tile-dot, .orb'), 'flip');
}

// ---------------------------------------------------------------- routing
const loaders = {};
let current = null;
function show(id, force) {
  if (!SCREENS.includes(id)) id = 'home';
  for (const s of document.querySelectorAll('[data-view]')) s.hidden = s.dataset.view !== id;
  for (const a of document.querySelectorAll('#nav a')) { if (a.dataset.screen === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  moveNavPill();
  const changed = current !== id;
  current = id;
  if ((changed || force) && loaders[id]) loaders[id]();
  if (changed) $('main').focus({ preventScroll: true });
}
window.addEventListener('hashchange', () => show(screenFromHash(location.hash)));

/** Sliding highlight behind the active nav link. */
function moveNavPill() {
  const pill = $('nav-pill'); const a = document.querySelector('#nav a[aria-current="page"]');
  if (!pill || !a) return;
  pill.style.transform = `translateY(${a.offsetTop}px)`;
  pill.style.height = `${a.offsetHeight}px`;
  if (!pill.classList.contains('ready')) requestAnimationFrame(() => pill.classList.add('ready'));
}
window.addEventListener('resize', moveNavPill);

// ---------------------------------------------------------------- home
let lastDoctor = null;
/** Health signals for the hero line. null = still loading, undefined = not part of the check. */
let health = {};
const SIGNALS = { services: 'home.services', gateway: 'home.gateway', gogate: 'home.gogate', doctor: 'home.doctor' };
function signal(name, tone) { health[name] = tone; renderHero(); }
function renderHero() {
  const hero = $('home-hero');
  const names = Object.keys(SIGNALS).filter((k) => health[k] !== undefined);
  const pending = names.filter((k) => health[k] === null);
  const done = names.filter((k) => health[k] !== null && health[k] !== 'muted');
  const issues = done.filter((k) => health[k] === 'bad' || health[k] === 'warn');
  const okN = done.filter((k) => health[k] === 'ok').length;
  const tone = pending.length ? 'checking' : issues.some((k) => health[k] === 'bad') ? 'bad' : issues.length ? 'warn' : 'ok';
  if (hero.dataset.tone !== tone) { hero.dataset.tone = tone; replay($('home-hero-ring'), 'flip'); }
  const title = t(`home.health.${tone}`);
  if ($('home-hero-title').textContent !== title) $('home-hero-title').textContent = title;
  $('home-hero-sub').textContent = tone === 'checking' ? '' : issues.length ? issues.map((k) => t(SIGNALS[k])).join(' · ') : t('home.health.okSub');
  $('home-hero-score').textContent = tone === 'checking' ? '' : `${okN}/${done.length}`;
  $('home-hero-time').textContent = tone === 'checking' ? '' : t('home.checkedAt', { time: new Date().toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }) });
  setRing($('home-hero-ring'), tone === 'checking' ? 0.25 : done.length ? okN / done.length : 0);
}

loaders.home = async () => {
  health = { services: null, gateway: null, gogate: null, doctor: lastDoctor && lastDoctor.data ? doctorSummary(lastDoctor.data).tone : undefined };
  renderHero();
  skeleton($('home-version'), 1); skeleton($('home-services'));
  if (!lastDoctor) doctorIdle();
  try {
    const s = await invoke('get_status');
    $('home-elevated').hidden = !s.elevated;
    const v = $('home-version'); v.textContent = '';
    if (!s.installed) v.append(status(t('home.notInstalled'), 'bad'));
    else {
      v.append(el('div', s.version || t('common.none'), 'version'));
      v.append(status(s.update_available ? t('home.updateAvailable', { v: s.latest }) : t('home.upToDate'), s.update_available ? 'warn' : 'ok'));
    }
    $('side-version').textContent = s.version ? `AOS ${s.version}` : '';
    const box = $('home-services'); box.textContent = '';
    if (s.services_error) { box.append(el('p', s.services_error, 'bad')); setTone('home-services', 'bad'); signal('services', 'bad'); }
    else {
      const sum = servicesSummary(s.services);
      box.append(statRow(ring(sum.total ? sum.up / sum.total : 0, sum.tone), stat(sum.up, sum.total)));
      box.append(el('p', t('home.servicesUp', { up: sum.up, total: sum.total }), 'stat-cap'));
      if (sum.down.length) box.append(el('p', t('home.servicesDown', { list: sum.down.join(', ') }), 'bad stat-cap'));
      setTone('home-services', sum.tone); signal('services', sum.tone);
    }
  } catch (e) {
    $('home-version').textContent = ''; errorRow($('home-version'), e, loaders.home);
    $('home-services').textContent = ''; setTone('home-services', 'bad'); signal('services', 'bad');
  }
  if (lastDoctor) renderDoctor(lastDoctor);
  loadHomeExtras();
};
/** Each tile loads on its own, so one slow command never blocks the others. */
function loadHomeExtras() {
  const tile = (id, sig, fn) => {
    skeleton($(id), 2);
    Promise.resolve().then(fn).catch((e) => { $(id).textContent = ''; $(id).append(el('p', errText(e), 'bad stat-cap')); setTone(id, 'bad'); if (sig) signal(sig, 'bad'); });
  };
  tile('home-gateway', 'gateway', async () => {
    const v = await invoke('gateway_status'); const c = gatewayCounts(v.status); const box = $('home-gateway'); box.textContent = '';
    if (!v.status || !c.running) { box.append(el('div', t('services.gatewayDown'), 'stat-word')); setTone('home-gateway', 'bad'); signal('gateway', 'bad'); return; }
    const tone = c.failed ? 'bad' : 'ok';
    box.append(statRow(ring(c.total ? c.ok / c.total : 1, tone), stat(c.ok, c.total)));
    box.append(el('p', t('home.gatewayUp', { ok: c.ok, total: c.total }), 'stat-cap'));
    if (c.failed) box.append(el('p', t('home.gatewayFailed', { n: c.failed }), 'bad stat-cap'));
    setTone('home-gateway', tone); signal('gateway', tone);
  });
  tile('home-gogate', 'gogate', async () => {
    const mode = await invoke('gogate_mode'); const box = $('home-gogate'); box.textContent = '';
    const tone = gogateTone(mode);
    // CLI output is data: unknown words are shown as they are, not as a missing-key string.
    box.append(el('div', ['off', 'soft', 'hard'].includes(mode) ? t(`home.gogate.${mode}`) : (mode || t('common.none')), 'stat-word'));
    const gauge = el('div', null, 'gauge'); gauge.setAttribute('aria-hidden', 'true');
    for (const m of ['off', 'soft', 'hard']) gauge.append(el('span', t(`home.gogate.${m}`), m === mode ? 'gauge-seg on' : 'gauge-seg'));
    box.append(gauge);
    if (mode === 'off') box.append(el('p', t('home.gogateOff'), 'warn stat-cap'));
    setTone('home-gogate', tone); signal('gogate', tone);
  });
  tile('home-awake', null, async () => {
    const v = await invoke('awake_get'); const s = awakeStatus(v); const box = $('home-awake'); box.textContent = '';
    box.append(el('div', t(s.key, { n: s.minutes }), 'stat-word small'));
    setTone('home-awake', s.tone);
  });
  tile('home-codenotch', null, async () => {
    const s = codenotchState(await invoke('codenotch_info')); const box = $('home-codenotch'); box.textContent = '';
    box.append(el('div', t(s.key), 'stat-word small'));
    setTone('home-codenotch', s.tone);
  });
}
$('home-refresh').onclick = () => busy($('home-refresh'), loaders.home);
$('home-doctor').onclick = () => busy($('home-doctor'), async () => {
  const box = $('home-doctor-body');
  box.textContent = ''; box.append(el('p', t('home.doctorRunning'), 'note aos-shimmer')); box.append(el('div', null, 'skeleton bar'));
  setTone('home-doctor-body', 'loading'); signal('doctor', null);
  try { lastDoctor = await invoke('doctor_view'); renderDoctor(lastDoctor); }
  catch (e) { box.textContent = ''; errorRow(box, e); setTone('home-doctor-body', 'bad'); signal('doctor', 'bad'); }
});
function doctorIdle() {
  const box = $('home-doctor-body'); box.textContent = '';
  const idle = emptyState(t('home.doctorIdle'));
  idle.append(el('p', t('home.doctorHint'), 'note'));
  box.append(idle);
  setTone('home-doctor-body', 'muted');
}
function renderDoctor(p) {
  const box = $('home-doctor-body'); box.textContent = '';
  if (!p.data) { rawBlock(box, p); setTone('home-doctor-body', 'warn'); signal('doctor', 'warn'); return; }
  const sum = doctorSummary(p.data);
  const pass = Math.max(0, sum.total - sum.fail - sum.warn);
  const top = el('div', null, 'doctor-top');
  const lead = el('div', null, 'doctor-lead');
  lead.append(statRow(ring(sum.total ? pass / sum.total : 0, sum.tone, 'l'), stat(pass, sum.total)));
  lead.append(el('p', sum.tone === 'ok' ? t('home.doctorOk', { n: sum.total }) : t('home.doctorBad', { fail: sum.fail, warn: sum.warn }), 'stat-cap'));
  top.append(lead, doctorMeter(pass, sum.warn, sum.fail));
  box.append(top);
  const ul = el('ul', null, 'rows');
  for (const r of p.data.results.filter((r) => !r.ok)) {
    const li = el('li', null, 'row');
    li.dataset.tone = r.warningOnly ? 'warn' : 'bad';
    const main = el('div', null, 'row-main');
    main.append(el('div', `${r.area} / ${r.name}`, 'row-title'));
    const d = [detailText(r.detail), r.fix ? `Fix: ${detailText(r.fix)}` : ''].filter(Boolean).join(' — ');
    if (d) main.append(el('div', d, 'row-sub'));
    li.append(status(r.warningOnly ? 'warn' : 'fail', r.warningOnly ? 'warn' : 'bad'), main);
    ul.append(li);
  }
  if (ul.childElementCount) box.append(ul);
  setTone('home-doctor-body', sum.tone); signal('doctor', sum.tone);
}
/** Stacked pass/warn/fail bar with a legend that always names each part (never colour alone). */
function doctorMeter(pass, warn, fail) {
  const wrap = el('div', null, 'meter');
  const bar = el('div', null, 'meter-bar'); bar.setAttribute('aria-hidden', 'true');
  const legend = el('ul', null, 'meter-legend');
  const parts = [[pass, 'ok', t('home.doctorPass')], [warn, 'warn', t('home.doctorWarn')], [fail, 'bad', t('home.doctorFail')]];
  for (const [n, tone, label] of parts) {
    if (n) { const seg = el('span', null, `meter-seg ${tone}`); seg.style.flexGrow = String(n); bar.append(seg); }
    const li = el('li', null, `meter-key ${tone}`);
    li.append(el('span', String(n), 'meter-n'), el('span', label, 'meter-label'));
    legend.append(li);
  }
  wrap.append(bar, legend);
  return wrap;
}

// ---------------------------------------------------------------- store
let library = null;
loaders.store = async () => {
  skeleton($('lib-count'), 1); $('lib-rows').textContent = '';
  try { library = await invoke('store_catalog'); renderLibrary(); }
  catch (e) { $('lib-count').textContent = ''; errorRow($('lib-count'), e, loaders.store); }
  $('store-packs').textContent = t('common.loading');
  try { $('store-packs').textContent = await invoke('store_packs'); } catch (e) { $('store-packs').textContent = errText(e); }
};
/** Called with an event while typing: rows then appear without the entrance motion. */
function renderLibrary(ev) {
  if (!library) return;
  const { rows, total } = filterItems(library.items, { q: $('lib-q').value, kind: $('lib-kind').value, scope: $('lib-scope').value });
  const ul = $('lib-rows'); ul.textContent = '';
  ul.classList.toggle('quiet', Boolean(ev));
  $('lib-count').textContent = total > rows.length ? t('library.countCapped', { shown: rows.length, total }) : t('library.count', { n: total });
  for (const it of rows) ul.append(libraryRow(it));
  if (!rows.length) {
    const li = el('li', null, 'row empty-row');
    li.append(emptyState(t('library.empty'), t('library.clear'), () => {
      $('lib-q').value = ''; $('lib-kind').value = 'all'; $('lib-scope').value = 'all'; renderLibrary(); $('lib-q').focus();
    }));
    ul.append(li);
  }
}
function libraryRow(it) {
  const li = el('li', null, 'row col');
  li.dataset.lane = it.kind === 'agent' ? '0' : '1';
  const head = el('div', null, 'row');
  const main = el('div', null, 'row-main');
  main.append(el('div', it.name, 'row-title'));
  if (it.description) main.append(el('div', it.description, 'row-sub clamp'));
  const tags = el('div', null, 'tags');
  tags.append(el('span', t(`library.${it.kind}`), 'tag kind'));
  if (it.category) tags.append(el('span', it.category, 'tag'));
  if (it.source) tags.append(el('span', it.source, 'tag'));
  if (it.thirdParty || it.third_party) tags.append(el('span', t('library.thirdParty'), 'tag attn'));
  if (it.requires_auth) tags.append(el('span', t('library.needsAuth'), 'tag attn'));
  main.append(tags);
  if (it.problem) main.append(el('div', it.problem, 'row-sub bad'));
  const a = itemActions(it);
  const actions = el('div', null, 'row-actions');
  const doc = el('button', t('library.details'), 'btn small disclose');
  doc.setAttribute('aria-expanded', 'false');
  doc.onclick = () => toggleDoc(li, doc, it);
  actions.append(doc);
  if (a.install) actions.append(libraryAction(it, 'store_install', 'library.install', 'library.installing'));
  if (a.uninstall) actions.append(libraryAction(it, 'store_uninstall', 'library.uninstall', 'library.removing'));
  head.append(status(t(it.core ? 'library.core' : it.installed ? 'library.installed' : 'library.available'), it.installed ? 'ok' : 'muted'), main, actions);
  li.append(head);
  return li;
}
function libraryAction(it, cmd, label, working) {
  const b = el('button', t(label), cmd === 'store_install' ? 'btn small primary' : 'btn small danger');
  b.onclick = () => busy(b, async () => {
    $('lib-count').textContent = t(working, { name: it.name });
    try { await invoke(cmd, cmd === 'store_install' ? { kind: it.kind, name: it.name } : { name: it.name }); $('store-msg').textContent = t('library.done', { name: it.name }); }
    catch (e) { $('store-msg').textContent = quiet(e) ? t('common.cancelled') : t('common.failed', { e: errText(e) }); }
    loaders.store();
  });
  return b;
}
async function toggleDoc(li, btn, it) {
  const open = li.querySelector('.doc');
  if (open) { open.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
  btn.setAttribute('aria-expanded', 'true');
  const box = el('pre', t('common.loading'), 'doc mono'); li.append(box);
  try { const d = await invoke('store_doc', { kind: it.kind, name: it.name }); box.textContent = typeof d === 'string' ? d : (d.content || d.text || d.body || JSON.stringify(d, null, 2)).slice(0, 6000); }
  catch (e) { box.textContent = errText(e); }
}
for (const id of ['lib-q', 'lib-kind', 'lib-scope']) $(id).addEventListener('input', renderLibrary);
$('lib-filter').addEventListener('submit', (ev) => ev.preventDefault());
$('store-open').onclick = () => busy($('store-open'), async () => {
  $('store-msg').textContent = t('store.opening');
  try { await invoke('open_store'); $('store-msg').textContent = t('store.opened'); }
  catch (e) { $('store-msg').textContent = t('common.failed', { e: errText(e) }); }
});
// "/" jumps to the library search, Escape clears it.
document.addEventListener('keydown', (ev) => {
  if (current !== 'store') return;
  const typing = ev.target instanceof HTMLElement && ev.target.matches('input, textarea, select');
  if (ev.key === '/' && !typing && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { ev.preventDefault(); $('lib-q').focus(); $('lib-q').select(); }
  else if (ev.key === 'Escape' && ev.target === $('lib-q') && $('lib-q').value) { $('lib-q').value = ''; renderLibrary(ev); }
});

// ---------------------------------------------------------------- services
loaders.services = async () => {
  const ul = $('services-rows'); ul.textContent = '';
  skeleton($('services-msg'), 3);
  try {
    const p = await invoke('services_view');
    $('services-msg').textContent = '';
    if (!p.data) { rawBlock($('services-msg'), p); }
    else if (!p.data.length) { $('services-msg').append(emptyState(t('services.empty'))); }
    else for (const s of p.data) ul.append(serviceRow(s));
  } catch (e) { $('services-msg').textContent = ''; errorRow($('services-msg'), e, loaders.services); }
  loadGateway();
};
$('services-refresh').onclick = () => busy($('services-refresh'), loaders.services);

function serviceRow(s) {
  const li = el('li', null, 'row');
  const st = serviceState(s);
  li.dataset.tone = st === 'up' ? 'ok' : st === 'down' ? 'bad' : 'warn';
  const main = el('div', null, 'row-main');
  main.append(el('div', s.name || s.id, 'row-title'));
  main.append(el('div', [s.id, s.version ? `v${s.version}` : '', s.url || ''].filter(Boolean).join(' · '), 'row-sub mono'));
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
  const input = el('input', null, 'small confirm-input');
  input.setAttribute('aria-label', t('services.restartPrompt', { id }));
  input.placeholder = id; input.spellcheck = false; input.autocomplete = 'off';
  const go = el('button', t('services.restartGo'), 'btn small danger'); go.disabled = true;
  const cancel = el('button', '×', 'btn small icon'); cancel.setAttribute('aria-label', t('common.cancel'));
  const close = () => { input.remove(); go.remove(); cancel.remove(); trigger.hidden = false; trigger.focus(); };
  input.addEventListener('input', () => { const ok = restartConfirmed(input.value, id); go.disabled = !ok; input.classList.toggle('match', ok); });
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
  delete $('gw-summary').dataset.tone;
  $('gw-summary').textContent = t('common.loading');
  let v;
  try { v = await invoke('gateway_status'); } catch (e) { $('gw-summary').textContent = t('common.failed', { e: errText(e) }); return; }
  const st = v.status;
  $('gw-summary').dataset.tone = st && st.running ? 'ok' : 'bad';
  $('gw-summary').textContent = st ? (st.running ? t('services.gatewayRunning', { port: st.port }) : `${t('services.gatewayDown')}${st.error ? `: ${st.error}` : ''}`) : t('services.gatewayUnavailable', { e: v.error });
  for (const r of upstreamRows(st, v.known)) {
    const li = el('li', null, 'row');
    const main = el('div', null, 'row-main');
    main.append(el('div', r.name, 'row-title'));
    if (r.upstream && r.upstream.error) main.append(el('div', r.upstream.error, 'row-sub'));
    const tone = r.state === 'ok' ? 'ok' : r.state === 'notSelected' ? 'muted' : r.state === 'starting' ? 'warn' : 'bad';
    li.dataset.tone = tone;
    const actions = el('div', null, 'row-actions');
    if (r.changeable) {
      const b = el('button', t(r.upstream ? 'services.remove' : 'services.add'), r.upstream ? 'btn small' : 'btn small primary');
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
  const msg = $('router-msg'); msg.textContent = ''; delete msg.dataset.tone; skeleton(msg, 3);
  try {
    const p = await invoke('router_view');
    msg.textContent = '';
    if (!p.data) { rawBlock(msg, p); return; }
    msg.dataset.tone = p.data.enforce ? 'ok' : 'muted';
    msg.textContent = t(p.data.enforce ? 'router.enforce' : 'router.notEnforced');
    const rows = routerRows(p.data);
    if (!rows.length) { msg.append(emptyState(t('router.empty'))); return; }
    for (const r of rows) ul.append(routerRow(r, p.data.known_targets));
  } catch (e) { msg.textContent = ''; errorRow(msg, e, loaders.router); }
};
$('router-refresh').onclick = () => busy($('router-refresh'), loaders.router);

function routerRow(r, known) {
  const li = el('li', null, 'row col');
  if (r.source !== 'shipped') li.dataset.lane = r.source === 'project' ? '3' : '2';
  const head = el('div', null, 'row');
  const main = el('div', null, 'row-main');
  main.append(el('div', r.role, 'row-title mono'));
  const tags = el('div', null, 'tags chain');
  const show = (list) => { tags.textContent = ''; if (!list.length) tags.append(el('span', t('router.none'), 'tag none')); for (const x of list) tags.append(el('span', x, 'tag')); };
  show(r.targets);
  main.append(tags);
  const actions = el('div', null, 'row-actions');
  const edit = el('button', t('router.edit'), 'btn small');
  actions.append(edit);
  head.append(status(['shipped', 'user', 'project'].includes(r.source) ? t(`router.source.${r.source}`) : String(r.source), r.source === 'shipped' ? 'muted' : 'ok'), main, actions);
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
        const up = el('button', '↑', 'btn small icon'); up.setAttribute('aria-label', t('router.up'));
        const down = el('button', '↓', 'btn small icon'); down.setAttribute('aria-label', t('router.down'));
        const rm = el('button', '×', 'btn small icon'); rm.setAttribute('aria-label', t('common.cancel'));
        up.disabled = list.indexOf(name) === 0; down.disabled = list.indexOf(name) === list.length - 1;
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

// ---------------------------------------------------------------- always on + codenotch
let awakeView = null;
function renderAwake(v) {
  awakeView = v;
  const s = awakeStatus(v);
  const box = $('awake-state'); box.textContent = '';
  box.append(el('div', t(s.key, { n: s.minutes }), `metric ${s.tone}`));
  setTone('awake-state', s.tone);
  const toggle = $('awake-toggle');
  const on = v && v.supported && v.mode && v.mode.kind !== 'off' && s.key !== 'awake.off';
  toggle.textContent = t(on ? 'awake.turnOff' : 'awake.turnOn');
  toggle.className = on ? 'btn' : 'btn primary';
  toggle.disabled = !(v && v.supported);
  $('awake-timer').querySelectorAll('input,button').forEach((n) => { n.disabled = !(v && v.supported); });
}
async function awakeSet(kind, minutes) {
  try { renderAwake(await invoke('awake_set', { kind, minutes })); }
  catch (e) { const box = $('awake-state'); box.textContent = ''; errorRow(box, e); setTone('awake-state', 'bad'); }
}
loaders.awake = async () => {
  skeleton($('awake-state'), 1); skeleton($('codenotch-state'), 1);
  try { renderAwake(await invoke('awake_get')); } catch (e) { $('awake-state').textContent = ''; errorRow($('awake-state'), e, loaders.awake); setTone('awake-state', 'bad'); }
  loadCodenotch();
};
$('awake-refresh').onclick = () => busy($('awake-refresh'), loaders.awake);
$('awake-toggle').onclick = () => busy($('awake-toggle'), () => awakeSet(awakeStatus(awakeView).key === 'awake.off' ? 'on' : 'off'));
$('awake-timer').addEventListener('submit', (ev) => { ev.preventDefault(); const n = Number($('awake-minutes').value); awakeSet('timer', Number.isInteger(n) && n > 0 ? n : 60); });
// Quick picks only fill the minutes field; "Start timer" still starts it.
function markPreset() { for (const b of document.querySelectorAll('.presets [data-min]')) b.setAttribute('aria-pressed', String(b.dataset.min === $('awake-minutes').value)); }
for (const b of document.querySelectorAll('.presets [data-min]')) b.addEventListener('click', () => { $('awake-minutes').value = b.dataset.min; markPreset(); });
$('awake-minutes').addEventListener('input', markPreset);

async function loadCodenotch() {
  const box = $('codenotch-state');
  try {
    const info = await invoke('codenotch_info');
    const s = codenotchState(info);
    box.textContent = '';
    box.append(el('div', t(s.key), `metric ${s.tone}`));
    if (info.path) box.append(el('p', info.path, 'note mono'));
    setTone('codenotch-state', s.tone);
    $('codenotch-start').disabled = !s.canStart;
    $('codenotch-install').disabled = !s.canInstall;
  } catch (e) { box.textContent = ''; errorRow(box, e, loadCodenotch); setTone('codenotch-state', 'bad'); }
}
$('codenotch-start').onclick = () => busy($('codenotch-start'), async () => {
  try { await invoke('codenotch_start'); $('codenotch-msg').textContent = t('codenotch.started'); setTimeout(loadCodenotch, 1500); }
  catch (e) { $('codenotch-msg').textContent = t('common.failed', { e: errText(e) }); }
});
$('codenotch-install').onclick = () => busy($('codenotch-install'), async () => {
  $('codenotch-msg').textContent = t('codenotch.working');
  try { $('codenotch-msg').textContent = await invoke('codenotch_install'); }
  catch (e) { $('codenotch-msg').textContent = quiet(e) ? t('common.cancelled') : t('common.failed', { e: errText(e) }); }
  loadCodenotch();
});

// ---------------------------------------------------------------- projects
/** Stable lane colour (0..5) per project name, used only as an edge and monogram tint. */
function laneOf(name) { let h = 7; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return String(h % 6); }
loaders.projects = async () => {
  const ul = $('projects-rows'); ul.textContent = '';
  const msg = $('projects-msg'); msg.textContent = ''; skeleton(msg, 3);
  try {
    const v = await invoke('projects_list');
    msg.textContent = '';
    if (v.error) { msg.append(el('span', v.error, 'warn')); return; }
    if (!v.projects.length) { msg.append(emptyState(t('projects.empty'))); return; }
    msg.textContent = t('projects.count', { n: v.projects.length, root: v.root });
    for (const p of v.projects) {
      const li = el('li', null, 'row');
      const name = projectName(p);
      li.dataset.lane = laneOf(name);
      const avatar = el('span', name.trim().charAt(0).toUpperCase() || '?', 'avatar'); avatar.setAttribute('aria-hidden', 'true');
      const main = el('div', null, 'row-main');
      main.append(el('div', name, 'row-title'));
      const tags = el('div', null, 'tags');
      if (p.meta) {
        if (p.meta.slug) tags.append(el('span', `${t('projects.slug')}: ${p.meta.slug}`, 'tag'));
        if (p.meta.domain) tags.append(el('span', `${t('projects.domain')}: ${p.meta.domain}`, 'tag'));
      } else tags.append(el('span', t('projects.noMeta'), 'tag none'));
      tags.append(el('span', t(p.wiki ? 'projects.wiki' : 'projects.noWiki'), p.wiki ? 'tag' : 'tag none'));
      if (name !== p.dir) main.append(el('div', p.dir, 'row-sub mono'));
      main.append(tags);
      const g = gitBadge(p);
      li.append(avatar, main, status(t(g.key, { n: g.n }), g.tone));
      ul.append(li);
    }
  } catch (e) { msg.textContent = ''; errorRow(msg, e, loaders.projects); }
};
$('projects-refresh').onclick = () => busy($('projects-refresh'), loaders.projects);

// ---------------------------------------------------------------- secrets (names and status only)
loaders.secrets = async () => {
  const ul = $('secret-rows'); ul.textContent = '';
  try {
    const rows = secretRows(await invoke('secrets_list'));
    if (!rows.length) { $('secret-msg').textContent = t('secrets.none'); return; }
    for (const s of rows) {
      const li = el('li', null, 'row');
      li.dataset.tone = s.set ? 'ok' : 'muted';
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

// ---------------------------------------------------------------- ambient spells (presentation only)
// Status lines flash softly when their text changes, so a result never goes unnoticed.
const flashQueue = new Set();
const flashObs = new MutationObserver((muts) => {
  for (const m of muts) { const n = m.target.nodeType === 1 ? m.target : m.target.parentElement; const host = n && n.closest('[role="status"]'); if (host && !host.classList.contains('count')) flashQueue.add(host); }
  requestAnimationFrame(() => { for (const h of flashQueue) if (h.textContent.trim()) replay(h, 'flash'); flashQueue.clear(); });
});
for (const n of document.querySelectorAll('.note[role="status"]')) flashObs.observe(n, { childList: true, characterData: true, subtree: true });
// Cursor spotlight on tiles and cards (pointer devices only; CSS hides it under reduced motion).
if (window.matchMedia && window.matchMedia('(hover: hover)').matches) {
  document.addEventListener('pointermove', (ev) => {
    const c = ev.target instanceof Element && ev.target.closest('.tile, .card, .hero');
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', `${Math.round(ev.clientX - r.left)}px`);
    c.style.setProperty('--my', `${Math.round(ev.clientY - r.top)}px`);
  }, { passive: true });
}

// A loader that is already running is not started twice: a second request waits and reruns once
// when the first finishes, so overlapping refreshes never append duplicate rows.
for (const id of Object.keys(loaders)) {
  const fn = loaders[id];
  let running = false; let again = false;
  loaders[id] = async () => {
    if (running) { again = true; return; }
    running = true;
    try { await fn(); } finally { running = false; if (again) { again = false; loaders[id](); } }
  };
}

applyStrings();
markPreset();
show(screenFromHash(location.hash));
