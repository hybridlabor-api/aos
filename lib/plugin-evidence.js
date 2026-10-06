'use strict';
// Which skills does the installed bdb-aos Claude Code plugin really deliver? The plugin cache is
// nested (skills/basic/<name>), so the lookup follows plugin.json's `skills` array and walks
// recursively. Pure of installer state: every path derives from `home`.
const fs = require('fs');
const path = require('path');

const PLUGIN = 'bdb-aos';
const MARKETPLACE = 'bdb-marketplace';

// Claude Code reads CLAUDE_CONFIG_DIR instead of ~/.claude when it is set.
const claudeConfigDir = (home) => (process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(home, '.claude'));

// Skill names (the directory holding a SKILL.md) a plugin install delivers: the paths in plugin.json
// "skills" (string or array, default ./skills), each walked recursively, so nested layouts such as
// skills/basic/startcycle count. Paths must stay inside the plugin root; node_modules is skipped.
function skillsOf(root) {
    const names = new Set();
    let realRoot;
    try { realRoot = fs.realpathSync(root); } catch { return names; }
    let declared = null;
    for (const m of ['plugin.json', path.join('.claude-plugin', 'plugin.json')]) {
        try { declared = JSON.parse(fs.readFileSync(path.join(realRoot, m), 'utf8')).skills; break; } catch { /* next */ }
    }
    const entries = (Array.isArray(declared) ? declared : declared ? [declared] : ['./skills']).filter((e) => typeof e === 'string');
    let budget = 20000;
    const walk = (dir, depth) => {
        if (budget-- <= 0 || depth > 8) return;
        let real;
        try { real = fs.realpathSync(dir); } catch { return; }
        if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return;
        if (fs.existsSync(path.join(real, 'SKILL.md'))) names.add(path.basename(dir));
        let kids;
        try { kids = fs.readdirSync(real, { withFileTypes: true }); } catch { return; }
        for (const k of kids) {
            if (k.name === 'node_modules' || k.name.startsWith('.')) continue;
            if (k.isDirectory() || k.isSymbolicLink()) walk(path.join(dir, k.name), depth + 1);
        }
    };
    for (const e of entries) walk(path.resolve(realRoot, e), 0);
    return names;
}

// -> { installPath, skills: Set<string> } of the first plugin copy that delivers EVERY wanted skill
// (any skill when none is named), else null. `every: false` relaxes that to "at least one".
// Evidence that Claude Code itself installed the plugin, readable without network: a candidate must
// resolve (realpath) under <claude config dir>/plugins and not be cached from another marketplace.
function pluginSkills(home, wanted = [], { every = true } = {}) {
    const dir = path.join(claudeConfigDir(home), 'plugins');
    let realPlugins;
    try { realPlugins = fs.realpathSync(dir) + path.sep; } catch { return null; }
    const check = (candidate) => {
        let real;
        try { real = fs.realpathSync(candidate); } catch { return null; }
        if (!real.startsWith(realPlugins)) return null;
        const rel = real.slice(realPlugins.length).split(path.sep);
        if (rel[0] === 'cache' && rel[1] !== MARKETPLACE) return null;
        const skills = skillsOf(real);
        const ok = wanted.length ? wanted[every ? 'every' : 'some']((n) => skills.has(n)) : skills.size > 0;
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

module.exports = { pluginSkills, skillsOf, claudeConfigDir, PLUGIN, MARKETPLACE };
