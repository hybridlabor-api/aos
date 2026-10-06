// Plans tab: session list with top-level links (target=_blank) to plan-canvas
// on :4519. No iframe — plan-canvas returns 403 for framed loads by design.
export function mount(view, api) {
  const wrap = document.createElement('div');
  wrap.className = 'card';
  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>Plan file</th><th>Status</th><th>Updated</th><th></th></tr></thead>';
  wrap.appendChild(table);
  const note = document.createElement('p');
  note.className = 'note';
  view.appendChild(wrap);
  view.appendChild(note);

  let timer = null;
  const load = async () => {
    const { json } = await api('/api/plans');
    const body = table.tBodies[0] || table.appendChild(document.createElement('tbody'));
    body.textContent = '';
    if (json.down) {
      note.textContent = json.note || 'plan-canvas is down.';
      return;
    }
    note.textContent = `Open sessions are listed from plan-canvas (${json.base}); links open it in its own tab.`;
    for (const s of json.sessions || []) {
      const tr = document.createElement('tr');
      const file = document.createElement('td');
      file.textContent = s.file.split('/').pop() || s.file;
      file.title = s.file;
      const st = document.createElement('td');
      const dot = document.createElement('span');
      dot.className = `dot ${s.status === 'ended' ? 'down' : 'up'}`;
      st.appendChild(dot);
      st.appendChild(document.createTextNode(` ${s.status}${s.pending ? ` (${s.pending} pending)` : ''}`));
      const upd = document.createElement('td');
      upd.textContent = s.updatedAt;
      const link = document.createElement('td');
      if (s.key) {
        const a = document.createElement('a');
        a.href = `${json.base}/canvas/${s.key}`;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = 'open';
        link.appendChild(a);
      }
      tr.append(file, st, upd, link);
      body.appendChild(tr);
    }
  };
  load();
  timer = setInterval(load, 5000);
  return () => clearInterval(timer);
}
