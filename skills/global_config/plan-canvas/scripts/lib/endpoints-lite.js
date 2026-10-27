'use strict';
// Minimal writer for ~/.aos/endpoints.json (schema 1, docs/one-port.md): upsert this server's entry on
// start, mark it down on clean exit. Best effort: discovery must never break the server.
const fs = require('fs');
const os = require('os');
const path = require('path');

function update(mutate) {
  try {
    const file = path.join(process.env.HOME || os.homedir(), '.aos', 'endpoints.json');
    let doc = {};
    try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* missing or broken: start fresh */ }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) doc = {};
    doc.schema = 1;
    doc.hub = typeof doc.hub === 'string' ? doc.hub : 'http://127.0.0.1:7900';
    doc.services = doc.services && typeof doc.services === 'object' ? doc.services : {};
    doc.agenttrail = Array.isArray(doc.agenttrail) ? doc.agenttrail : [];
    mutate(doc);
    doc.updated = new Date().toISOString();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
    fs.renameSync(tmp, file);
  } catch { /* best effort */ }
}

function announce(id, { port, version }) {
  update((doc) => {
    doc.services[id] = { ...doc.services[id], url: `http://127.0.0.1:${port}`, port, pid: process.pid, version: version || null, status: 'up', via: `${doc.hub}/canvas` };
  });
}
function retire(id) {
  update((doc) => { if (doc.services[id]) doc.services[id] = { ...doc.services[id], pid: null, status: 'down' }; });
}

module.exports = { announce, retire, update };
