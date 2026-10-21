// WP2: Services tab. Renders the service table; start/stop/restart buttons
// with an inline confirm input field (window.prompt is NOT used); "open"
// link when a service is up; log viewer; 5 s status refresh; 30 min meta
// (npm update) refresh; openwiki visualize buttons and live viewer links.
export function mount(view, api) {
  const kb = (n) => n < 1024 ? `${n} B` : `${(n / 1024).toFixed(0)} KB`;
  const openLog = new Map(); // service id -> log name
  const seen = new Map(); // service id -> last up state

  const head = document.createElement('div');
  head.className = 'card';
  const headRow = document.createElement('div');
  headRow.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 16px';
  const aosVer = document.createElement('strong');
  aosVer.textContent = 'AOS';
  const updates = {};
  headRow.appendChild(aosVer);
  head.appendChild(headRow);

  const list = document.createElement('div');
  list.style.display = 'grid';
  list.style.gap = '10px';
  const errNote = document.createElement('p');
  errNote.className = 'note';
  errNote.hidden = true;
  view.appendChild(head);
  view.appendChild(errNote);
  view.appendChild(list);

  // One row per service. Everything is textContent-built: no HTML with data.
  function card(s, watch) {
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.service = s.id;

    const headLine = document.createElement('div');
    headLine.style.cssText = 'display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 16px';
    const title = document.createElement('div');
    title.style.flex = '1';
    const b = document.createElement('b');
    b.textContent = s.name;
    const role = document.createElement('span');
    role.style.cssText = 'display:block;color:var(--dim);font-size:12px';
    role.textContent = s.role + (s.installed ? '' : ' — not installed');
    title.append(b, role);

    const state = document.createElement('span');
    const dot = document.createElement('span');
    dot.className = 'dot ' + (s.up === null ? 'unknown' : s.up ? 'up' : 'down');
    state.appendChild(dot);
    const stateText = s.up === null ? 'unknown' : s.up ? 'up' : 'down';
    const verBits = [s.version ? `v${s.version}` : '', s.port ? `:${s.port}` : ''].filter(Boolean).join(' · ');
    state.appendChild(document.createTextNode(` ${stateText}${verBits ? ` · ${verBits}` : ''}`));
    const u = updates[s.id];
    if (u && u.state === 'outdated') {
      const up = document.createElement('span');
      up.style.color = 'var(--accent)';
      up.textContent = ` · v${u.remote} available`;
      state.appendChild(up);
    } else if (u && u.state === 'uncheckable') {
      const up = document.createElement('span');
      up.textContent = ' · not checkable';
      state.appendChild(up);
    }
    // Watcher data (from ~/.aos/status.json via GET /api/watch): restart count,
    // failed badge, lastError. Everything textContent-built like the rest.
    if (watch) {
      const r = (watch.restarts || []).filter((ts) => Date.now() - ts < 600000).length;
      if (r) {
        const badge = document.createElement('span');
        badge.textContent = ` · Restarts (10 min): ${r}`;
        state.appendChild(badge);
      }
      if (watch.failed) {
        const badge = document.createElement('span');
        badge.style.cssText = 'color:var(--aos-status-failed-fg)';
        badge.textContent = ' · failed';
        state.appendChild(badge);
      }
      if (watch.lastError) {
        const err = document.createElement('span');
        err.style.cssText = 'color:var(--aos-status-failed-fg)';
        err.textContent = ` · ${watch.lastError}`;
        state.appendChild(err);
      }
    }

    const acts = document.createElement('span');
    acts.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    if (s.url && s.up) {
      const a = document.createElement('a');
      a.href = s.url; a.target = '_blank'; a.rel = 'noopener';
      a.className = 'btn'; a.textContent = 'open';
      acts.appendChild(a);
    }
    // observe services are never controlled: no buttons, just the note.
    if (!s.observe) {
      if (!s.up) {
        const start = document.createElement('button');
        start.className = 'btn';
        start.textContent = 'Start';
        start.addEventListener('click', () => doAction(s.id, 'start', start));
        acts.appendChild(start);
      } else {
        const stop = document.createElement('button');
        stop.className = 'btn';
        stop.textContent = 'Stop';
        stop.title = s.confirm ? 'requires typed confirm' : 'stop';
        stop.addEventListener('click', () => confirmInline(el, s.id, 'stop', stop));
        acts.appendChild(stop);
        const restart = document.createElement('button');
        restart.className = 'btn';
        restart.textContent = 'Restart';
        restart.addEventListener('click', () => confirmInline(el, s.id, 'restart', restart));
        acts.appendChild(restart);
      }
    }
    headLine.append(title, state, acts);
    el.appendChild(headLine);

    if (s.health) {
      const h = document.createElement('p');
      h.className = 'note';
      h.textContent = s.health.text || JSON.stringify(s.health);
      if (s.health.level === 'error') h.style.borderColor = 'rgba(248,113,113,.34)';
      el.appendChild(h);
    }

    // OpenWiki: projects + visualize buttons + live viewer links.
    if (s.projects) {
      const sub = document.createElement('div');
      sub.className = 'note';
      sub.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:0 16px 12px';
      const lbl = document.createElement('span');
      lbl.textContent = 'Wikis:';
      sub.appendChild(lbl);
      if (!s.projects.length) {
        const none = document.createElement('span');
        none.textContent = 'none yet';
        sub.appendChild(none);
      }
      for (const p of s.projects) {
        const v = (s.viewers || []).find((x) => x.project === p.path);
        if (v) {
          const a = document.createElement('a');
          a.href = `http://127.0.0.1:${v.port}`;
          a.target = '_blank'; a.rel = 'noopener';
          a.textContent = `${p.name} · :${v.port}`;
          sub.appendChild(a);
        } else {
          const btn = document.createElement('button');
          btn.textContent = `visualize ${p.name}`;
          btn.addEventListener('click', async () => {
            btn.disabled = true;
            const { json } = await api('api/services/openwiki/visualize', { body: { project: p.path } });
            btn.disabled = false;
            if (!json.ok) {
              errNote.hidden = false;
              errNote.textContent = json.error || 'visualize failed';
            }
            setTimeout(refresh, 500);
          });
          sub.appendChild(btn);
        }
      }
      el.appendChild(sub);
    }

    // Logs: one toggle button per declared log basename.
    if (s.logs && s.logs.length) {
      const sub = document.createElement('div');
      sub.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:0 16px 12px';
      const lbl = document.createElement('span');
      lbl.textContent = 'Logs:';
      sub.appendChild(lbl);
      for (const l of s.logs) {
        const btn = document.createElement('button');
        btn.textContent = `${l.name} · ${kb(l.size)}`;
        if (openLog.get(s.id) === l.name) btn.style.borderColor = 'var(--accent)';
        btn.addEventListener('click', () => {
          if (openLog.get(s.id) === l.name) openLog.delete(s.id);
          else openLog.set(s.id, l.name);
          refresh();
        });
        sub.appendChild(btn);
      }
      el.appendChild(sub);
      if (openLog.get(s.id)) {
        const pre = document.createElement('pre');
        pre.style.cssText = 'background:var(--pill);border:1px solid var(--line);border-radius:8px;padding:12px;margin:0 16px 14px;overflow:auto;max-height:320px;font-size:12px;white-space:pre-wrap;word-break:break-word';
        pre.textContent = 'loading …';
        pre.dataset.log = s.id;
        el.appendChild(pre);
        loadLog(s.id);
      }
    }
    return el;
  }

  // Inline typed confirm: an input + Confirm/Cancel pair appended under the
  // clicked row. window.prompt is not used.
  function confirmInline(el, id, action, originBtn) {
    const existing = el.querySelector('div.confirm');
    if (existing) existing.remove();
    const box = document.createElement('div');
    box.className = 'confirm';
    box.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:0 16px 12px';
    const label = document.createElement('span');
    label.textContent = `type "${id}" to confirm ${action}:`;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'confirm-input';
    input.setAttribute('aria-label', `type ${id} to confirm ${action}`);
    const okBtn = document.createElement('button');
    okBtn.textContent = 'Confirm';
    okBtn.disabled = true;
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    input.addEventListener('input', () => { okBtn.disabled = input.value !== id; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !okBtn.disabled) submitted(); });
    const submitted = () => {
      box.remove();
      doAction(id, action, originBtn, input.value);
    };
    okBtn.addEventListener('click', submitted);
    cancelBtn.addEventListener('click', () => box.remove());
    box.append(label, input, okBtn, cancelBtn);
    el.appendChild(box);
    input.focus();
  }

  async function doAction(id, action, btn, confirmValue) {
    if (btn) { btn.disabled = true; }
    const { status, json } = await api(`api/services/${encodeURIComponent(id)}/${action}`,
      { body: confirmValue !== undefined ? { id, confirm: confirmValue } : { id } });
    if (btn) btn.disabled = false;
    if (status !== 200) {
      errNote.hidden = false;
      errNote.textContent = json.error || `${action} ${id} failed (${status})`;
      return;
    }
    errNote.hidden = true;
    // Give launchd a beat, then re-probe.
    setTimeout(refresh, 1200);
  }

  async function loadLog(id) {
    const pre = list.querySelector(`pre[data-log="${id}"]`);
    if (!pre) return;
    const { status, json } = await api(`api/services/${encodeURIComponent(id)}/log?name=${encodeURIComponent(openLog.get(id))}`);
    if (status !== 200) pre.textContent = `log not readable: ${json.error || status}`;
    else pre.textContent = json.text;
  }

  async function refresh() {
    try {
      const [{ json }, watch] = await Promise.all([api('api/services'), api('api/watch').catch(() => null)]);
      // watch: the hub watcher's map (GET /api/watch) — 404 or {} means no watcher data, nothing extra shown.
      const w = watch && watch.status === 200 && watch.json && watch.json.services ? watch.json.services : {};
      list.replaceChildren(...(json.services || []).map((s) => card(s, w[s.id])));
      // Lanes motion: M1 arrival for a service seen the first time, M5 flip when its up state changes.
      let i = 0;
      for (const s of json.services || []) {
        const el = list.querySelector(`[data-service="${CSS.escape(s.id)}"]`);
        if (!el) continue;
        if (!seen.has(s.id)) { el.style.setProperty('--i', String(Math.min(i++, 8))); el.classList.add('aos-enter'); }
        else if (seen.get(s.id) !== s.up) el.querySelector('.dot')?.classList.add('aos-flip');
        seen.set(s.id, s.up);
      }
      for (const id of openLog.keys()) loadLog(id);
    } catch {
      errNote.hidden = false;
      errNote.textContent = 'status refresh failed';
    }
  }

  async function loadMeta() {
    try {
      const { json } = await api('api/services/meta');
      updates.aos = (json.updates || {}).aos;
      aosVer.textContent = `AOS v${json.version || '?'}`;
      for (const s of Object.entries(json.updates || {})) updates[s[0]] = s[1];
      if (updates.aos && updates.aos.state === 'outdated') {
        // Full refresh is cheap; the cards re-render from cached rows of meta.
        refresh();
      }
    } catch { /* the page stays useful without version info */ }
  }

  refresh();
  loadMeta();
  const statusTimer = setInterval(refresh, 5000);
  const metaTimer = setInterval(loadMeta, 30 * 60 * 1000);
  return () => { clearInterval(statusTimer); clearInterval(metaTimer); };
}
