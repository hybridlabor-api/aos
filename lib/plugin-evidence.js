'use strict';
// Which skills does the installed bdb-aos Claude Code plugin really deliver? The plugin cache is
// nested (skills/basic/<name>), so the lookup follows plugin.json's `skills` array and walks
// recursively. Pure of installer state: every path derives from `home`.
const fs = require('fs');
const path = require('path');

const PLUGIN = 'bdb-aos';
const MARKETPLACE = 'bdb-marketplace';
const MAX_DEPTH = 4;

function collect(dir, out, depth = 0) {
    if (fs.existsSync(path.join(dir, 'SKILL.md'))) { out.add(path.basename(dir)); return; }
    if (depth >= MAX_DEPTH) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) if (e.isDirectory() || e.isSymbolicLink()) collect(path.join(dir, e.name), out, depth + 1);
}

function skillsOf(pluginDir) {
    let roots = [path.join(pluginDir, 'skills')];
    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'));
        if (Array.isArray(manifest.skills) && manifest.skills.length) roots = manifest.skills.map((s) => path.resolve(pluginDir, String(s)));
    } catch { /* default layout */ }
    const out = new Set();
    for (const r of roots) {
        let real;
        try { real = fs.realpathSync(r); } catch { continue; }
        const base = fs.realpathSync(pluginDir) + path.sep;
        if (real.startsWith(base)) collect(real, out);
    }
    return out;
}

// -> { installPath, skills: Set<string> } of the first plugin copy that has the sentinel(s), else null.
function pluginSkills(home, wanted = []) {
    const dir = path.join(home, '.claude', 'plugins');
    let realPlugins;
    try { realPlugins = fs.realpathSync(dir) + path.sep; } catch { return null; }
    const check = (candidate) => {
        let real;
        try { real = fs.realpathSync(candidate); } catch { return null; }
        if (!real.startsWith(realPlugins)) return null;
        const rel = real.slice(realPlugins.length).split(path.sep);
        if (rel[0] === 'cache' && rel[1] !== MARKETPLACE) return null;
        const skills = skillsOf(real);
        const ok = wanted.length ? wanted.some((n) => skills.has(n)) : skills.size > 0;
        return ok ? { installPath: real, skills } : null;
    };
    const candidates = [];
    try {
        const doc = JSON.parse(fs.readFileSync(path.join(dir, 'installed_plugins.json'), 'utf8'));
        const entries = doc && doc.plugins && doc.plugins[`${PLUGIN}@${MARKETPLACE}`];
        if (Array.isArray(entries)) for (const e of entries) if (e && typeof e.installPath === 'string') candidates.push(e.installPath);
    } catch { /* no evidence */ }
    try {
        const base = path.join(dir, 'cache', MARKETPLACE, PLUGIN);
        for (const v of fs.readdirSync(base)) candidates.push(path.join(base, v));
    } catch { /* no cache */ }
    for (const c of candidates) { const r = check(c); if (r) return r; }
    return null;
}

module.exports = { pluginSkills, skillsOf };
