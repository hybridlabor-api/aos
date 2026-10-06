'use strict';
// The profile flag the OpenCode plugin reads at load: <plugins dir>/aos-hooks/aos-profile.json = {"contextHooks": bool}.
const fs = require('fs');
const path = require('path');

const flagPath = (opencodeDir) => path.join(opencodeDir, 'plugins', 'aos-hooks', 'aos-profile.json');

// Rewrites only when the content changes. Returns { file, changed }.
function writeProfileFlag(opencodeDir, contextHooks) {
    const file = flagPath(opencodeDir);
    const content = JSON.stringify({ contextHooks: contextHooks !== false }) + '\n';
    let current = null;
    try { current = fs.readFileSync(file, 'utf8'); } catch { /* absent */ }
    if (current === content) return { file, changed: false };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return { file, changed: true };
}

module.exports = { flagPath, writeProfileFlag };
