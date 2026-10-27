'use strict';
// The profile flag the OpenCode plugin reads at load: <plugins dir>/aos-hooks/aos-profile.json = {"contextHooks": bool, "memory"?: false}.
const fs = require('fs');
const path = require('path');

const flagPath = (opencodeDir) => path.join(opencodeDir, 'plugins', 'aos-hooks', 'aos-profile.json');

// Rewrites only when the content changes. Returns { file, changed }.
// gate false (Settings: go-gate off): the plugin skips the go-gate checks. memory false (unified memory not installed): no memB injection. Written only when false, so older flags stay byte-identical.
function writeProfileFlag(opencodeDir, contextHooks, memory = true, gate = true) {
    const file = flagPath(opencodeDir);
    const content = JSON.stringify({ contextHooks: contextHooks !== false, ...(memory === false ? { memory: false } : {}), ...(gate === false ? { gate: false } : {}) }) + '\n';
    let current = null;
    try { current = fs.readFileSync(file, 'utf8'); } catch { /* absent */ }
    if (current === content) return { file, changed: false };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return { file, changed: true };
}

module.exports = { flagPath, writeProfileFlag };
