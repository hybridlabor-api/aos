'use strict';
// `aos allow <preset>`: the USER adds permission allow rules to ~/.claude/settings.json.
// Agents must not run it: the auto-mode classifier blocks an agent editing its own permissions.
const fs = require('fs');
const os = require('os');
const path = require('path');

const PRESETS = path.join(__dirname, '..', 'config', 'allow-presets.json');
const settingsPath = (home) => path.join(home, '.claude', 'settings.json');
const recordPath = (home) => path.join(home, '.aos', 'allow-records.json');

const readJson = (file, fallback) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) {
        if (e.code === 'ENOENT') return fallback;
        throw new Error(`${file} is unreadable (${e.message}); nothing was changed.`);
    }
};
const writeJson = (file, data) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
};
const expand = (v, home) => (v === '~' ? home : v.startsWith('~/') ? path.join(home, v.slice(2)) : v);

// Keeps "~/" in the key path: Claude Code matches the command text literally.
function parseArgs(argv) {
    const o = { flags: {}, rest: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--dry-run' || a === '--remove') o.flags[a.slice(2)] = true;
        else if (a.startsWith('--') && a.includes('=')) o.flags[a.slice(2, a.indexOf('='))] = a.slice(a.indexOf('=') + 1);
        else if (a.startsWith('--')) o.flags[a.slice(2)] = argv[++i];
        else o.rest.push(a);
    }
    return o;
}

function rulesFor(name, flags, home, presets) {
    const p = presets[name];
    if (!p) throw new Error(`unknown preset "${name}". Presets: ${Object.keys(presets).join(', ')}`);
    const missing = Object.keys(p.params).filter((k) => !flags[k]);
    if (missing.length) {
        throw new Error(`preset ${name} needs ${missing.map((k) => `--${k} ${p.params[k]}`).join(' ')}`);
    }
    const val = (k) => (k === 'scripts' ? expand(flags[k], home).replace(/\/+$/, '') : flags[k]);
    return p.rules.map((r) => r.replace(/\{(\w+)\}/g, (_, k) => val(k)));
}

function allowCommand(argv, { home = os.homedir(), write = (s) => process.stdout.write(s), presetsFile = PRESETS } = {}) {
    const { flags, rest } = parseArgs(argv);
    try {
        const presets = readJson(presetsFile, {});
        if (!rest[0] || rest[0] === 'list') {
            write('Usage: aos allow <preset> [params] [--dry-run] [--remove]\n');
            for (const [n, p] of Object.entries(presets)) {
                write(`  ${n.padEnd(10)} ${p.description}${Object.keys(p.params).map((k) => ` --${k} ${p.params[k]}`).join('')}\n`);
            }
            return rest[0] ? 0 : 2;
        }
        const rules = rulesFor(rest[0], flags, home, presets);
        const file = settingsPath(home);
        const settings = readJson(file, {});
        const allow = (settings.permissions && settings.permissions.allow) || [];
        if (!Array.isArray(allow)) throw new Error(`${file}: permissions.allow is not an array; nothing was changed.`);
        const rec = readJson(recordPath(home), { added: [] });
        const ours = new Set(rec.added || []);

        const change = flags.remove ? rules.filter((r) => ours.has(r) && allow.includes(r)) : rules.filter((r) => !allow.includes(r));
        const sign = flags.remove ? '-' : '+';
        if (!change.length) {
            write(flags.remove ? 'Nothing to remove: no matching rule was added by `aos allow`.\n' : 'Already allowed: no change.\n');
            if (flags.remove) { rec.added = [...ours].filter((r) => !rules.includes(r) || allow.includes(r)); if (!flags['dry-run']) writeJson(recordPath(home), rec); }
            return 0;
        }
        write(`${file}\n${change.map((r) => `  ${sign} permissions.allow: ${r}`).join('\n')}\n`);
        if (flags['dry-run']) { write('(dry run: nothing written)\n'); return 0; }

        if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.aos-bak-${Date.now()}`);
        const next = flags.remove ? allow.filter((r) => !change.includes(r)) : [...allow, ...change];
        writeJson(file, { ...settings, permissions: { ...(settings.permissions || {}), allow: next } });
        rec.added = flags.remove ? [...ours].filter((r) => !change.includes(r)) : [...new Set([...ours, ...change])];
        writeJson(recordPath(home), rec);
        write(flags.remove ? `Removed ${change.length} rule(s).\n` : `Added ${change.length} rule(s). Revert: aos allow ${rest.join(' ')} --remove\n`);
        return 0;
    } catch (e) {
        write(`aos allow: ${e.message}\n`);
        return 2;
    }
}

// For uninstall: removes exactly the rules `aos allow` recorded.
function removeAllRecorded(home = os.homedir()) {
    const rec = readJson(recordPath(home), { added: [] });
    const file = settingsPath(home);
    const settings = readJson(file, null);
    if (settings && settings.permissions && Array.isArray(settings.permissions.allow) && rec.added.length) {
        settings.permissions.allow = settings.permissions.allow.filter((r) => !rec.added.includes(r));
        writeJson(file, settings);
    }
    try { fs.unlinkSync(recordPath(home)); } catch {}
    return rec.added.length;
}

module.exports = { allowCommand, removeAllRecorded, recordPath };
