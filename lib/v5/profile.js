'use strict';
// Install profiles and the options around them. Pure functions: no I/O except the v5 settings file helpers.
const fs = require('fs');
const path = require('path');

// Gate and safety hooks. No profile and no flag ever removes these.
const ALWAYS_HOOKS = ['go-gate.mjs', 'go-token.mjs', 'go-grant.mjs', 'graph-gate.mjs', 'conventional-commits.mjs', 'env-file-protection.mjs'];
// Context-injection hooks: the only ones --no-hooks and the minimal profile skip.
const CONTEXT_HOOKS = ['memb-inject.mjs', 'rules-inject.mjs', 'trail-relay.mjs', 'trail-autostart.mjs'];
// AOS scripts wired outside the profile switch. a2a-session.mjs is written by installClaudeA2aSessionHook, startcycle-dispatch.mjs is a workflow.
const OTHER_HOOKS = ['startcycle-dispatch.mjs', 'a2a-inbox.mjs', 'a2a-session.mjs'];
// Every AOS-owned script a hook entry may name (agy, Codex, uninstall). One list: installer.js, lib/uninstall-records.js and bin/aos-uninstall.mjs import it.
const HOOK_SCRIPTS = [...ALWAYS_HOOKS, ...CONTEXT_HOOKS, ...OTHER_HOOKS];
// The Claude settings.json merge owns what the shipped template wires (a2a-session is its SessionStart entry); the dispatch workflow is not in it.
const CLAUDE_MERGE_HOOKS = [...ALWAYS_HOOKS, ...CONTEXT_HOOKS, 'a2a-inbox.mjs', 'a2a-session.mjs'];

// Helper scripts a hook imports from its own directory; copied with it.
const HOOK_IMPORTS = { 'go-grant.mjs': ['go-gate.mjs'], 'go-token.mjs': ['go-gate.mjs'] };
const withImports = (names) => [...new Set(names.flatMap((n) => [n, ...(HOOK_IMPORTS[n] || [])]))];
// What each harness really wires (mergeBdbSettingsHooks, mergeCodexTomlHooks, mergeAntigravityHooks), plus imports.
// startcycle-dispatch.mjs is a workflow and is copied separately. a2a-session.mjs is in the Codex list ahead of its wiring.
const HARNESS_HOOKS = {
    // aos-bus.mjs is not a hook: the `aos-bus` launcher (installGlobalBinaries) points at ~/.claude/hooks/aos-bus.mjs, so it stays there for Claude only.
    claude: withImports([...CLAUDE_MERGE_HOOKS, 'aos-bus.mjs']),
    codex: withImports(['go-gate.mjs', 'graph-gate.mjs', 'memb-inject.mjs', 'rules-inject.mjs', 'trail-relay.mjs', 'a2a-session.mjs']),
    agy: withImports(['go-gate.mjs', 'conventional-commits.mjs', 'env-file-protection.mjs', 'graph-gate.mjs', 'trail-relay.mjs', 'memb-inject.mjs', 'rules-inject.mjs']),
};

// exclude: registry ids (lib/v5/packages.js) skipped by install, update and repair. modules: how optional modules are chosen with -y.
const PROFILES = {
    minimal: { contextHooks: false, skippedHooks: CONTEXT_HOOKS, exclude: ['gateway', 'fleet', 'openwiki', 'token-saver', 'codenotch'], modules: 'none' },
    standard: { contextHooks: true, skippedHooks: [], exclude: [], modules: 'requested' },
    full: { contextHooks: true, skippedHooks: [], exclude: [], modules: 'all' },
};
const DEFAULT_PROFILE = 'standard';

// hasOwn, never PROFILES[x]: "constructor", "toString" and "__proto__" are not profiles.
const knownProfile = (x) => typeof x === 'string' && Object.hasOwn(PROFILES, x);
const profileOf = (st) => (st && knownProfile(st.profile) ? st.profile : DEFAULT_PROFILE);
const excludedIds = (st) => new Set([...PROFILES[profileOf(st)].exclude, ...(st && Array.isArray(st.disabled) ? st.disabled.filter((x) => typeof x === 'string') : [])]);

const parseList = (raw) => String(raw || '').split(',').map((x) => x.trim()).filter(Boolean);
// `--name=value` or `--name value` (the next argument, unless it is another flag). '' = present without a value.
const flagValue = (argv, name) => {
    const i = argv.findIndex((x) => x === name || x.startsWith(`${name}=`));
    if (i < 0) return undefined;
    if (argv[i] !== name) return argv[i].slice(name.length + 1);
    const next = argv[i + 1];
    return next !== undefined && !next.startsWith('-') ? next : '';
};

// knownIds: registry ids (array or function returning one). Throws Error with a user-facing message.
function parseOptions(argv = process.argv, env = process.env, knownIds = []) {
    for (const f of ['--no-hooks', '--hooks-only']) {
        const bad = argv.find((x) => x.startsWith(`${f}=`));
        if (bad) throw new Error(`${bad}: ${f} is a switch and takes no value. Pass ${f} alone or leave it out.`);
    }
    const flag = flagValue(argv, '--profile');
    const raw = flag !== undefined ? flag : env.AOS_PROFILE;
    const profileGiven = raw !== undefined && raw !== '';
    if (flag === '') throw new Error('--profile needs a value: --profile=minimal|standard|full');
    const profile = profileGiven ? String(raw).trim().toLowerCase() : DEFAULT_PROFILE;
    if (!knownProfile(profile)) throw new Error(`Unknown profile "${raw}". Valid: ${Object.keys(PROFILES).join(', ')}.`);

    const withoutRaw = flagValue(argv, '--without');
    if (withoutRaw === '') throw new Error('--without needs a value: --without=<id,id>');
    const without = parseList(withoutRaw);
    if (without.length) {
        const known = typeof knownIds === 'function' ? knownIds() : knownIds;
        if (without.includes('kernel')) throw new Error('--without: "kernel" cannot be excluded (skills, agents and the gate hooks live there).');
        const unknown = without.filter((id) => !known.includes(id));
        if (unknown.length) throw new Error(`Unknown id(s) in --without: ${unknown.join(', ')}. Valid: ${known.filter((id) => id !== 'kernel').join(', ')}.`);
    }
    const hooksOnly = argv.includes('--hooks-only');
    if (hooksOnly) {
        if (flag !== undefined || withoutRaw !== undefined) throw new Error('--hooks-only cannot be combined with --profile or --without. Add --no-hooks to refresh the gate hooks only.');
        if (['status', 'update', 'repair'].includes(argv[2])) throw new Error(`--hooks-only belongs to the install, not to "aos ${argv[2]}". Run: aos --hooks-only`);
    }
    // profileFromFlag: only a flag on the command line is ever saved; AOS_PROFILE applies to this run only.
    return { profile, profileGiven, profileFromFlag: flag !== undefined, noHooks: argv.includes('--no-hooks'), hooksOnly, without };
}

const UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype'];
const OWNED_KEYS = ['disabled', 'profile', 'noHooks'];
const knownRegistryIds = () => { try { return require('./packages').registry.map((p) => p.id); } catch { return null; } };

// Whatever is on disk: wrong shapes are dropped (and named in `problems`), never thrown on. knownIds null = any string id.
function sanitizeSettings(raw, knownIds = knownRegistryIds()) {
    const out = { disabled: [] };
    const problems = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        if (raw !== undefined) problems.push('is not a JSON object, ignored');
        return { settings: out, problems };
    }
    for (const [k, v] of Object.entries(raw)) {
        if (UNSAFE_KEYS.includes(k)) problems.push(`key "${k}" ignored`);
        else if (!OWNED_KEYS.includes(k)) out[k] = v;
    }
    if (Object.hasOwn(raw, 'disabled')) {
        const v = raw.disabled;
        if (!Array.isArray(v)) problems.push('"disabled" is not an array, ignored');
        else {
            const ok = v.filter((id) => typeof id === 'string' && (!knownIds || knownIds.includes(id)));
            if (ok.length !== v.length) problems.push(`"disabled" has ${v.length - ok.length} entr${v.length - ok.length === 1 ? 'y' : 'ies'} that are not known package ids, ignored`);
            out.disabled = [...new Set(ok)];
        }
    }
    if (Object.hasOwn(raw, 'profile')) {
        if (knownProfile(raw.profile)) out.profile = raw.profile;
        else problems.push(`"profile" ${JSON.stringify(String(raw.profile)).slice(0, 40)} is not a profile (${Object.keys(PROFILES).join(', ')}), using ${DEFAULT_PROFILE}`);
    }
    if (Object.hasOwn(raw, 'noHooks')) {
        if (typeof raw.noHooks === 'boolean') out.noHooks = raw.noHooks;
        else problems.push('"noHooks" is not true or false, ignored');
    }
    return { settings: out, problems };
}

// settings = persisted v5 settings. An explicit --profile replaces the persisted profile and --no-hooks setting.
function resolve(opts, settings = {}) {
    const st = sanitizeSettings(settings, null).settings;
    const profile = opts.profileGiven && knownProfile(opts.profile) ? opts.profile : (opts.profileGiven ? DEFAULT_PROFILE : (st.profile || DEFAULT_PROFILE));
    const noHooks = opts.noHooks || (!opts.profileGiven && st.noHooks === true);
    const excluded = new Set([...PROFILES[profile].exclude, ...opts.without, ...st.disabled]);
    return { profile, noHooks, contextHooks: PROFILES[profile].contextHooks && !noHooks, excluded };
}

const isContextCommand = (cmd) => typeof cmd === 'string' && CONTEXT_HOOKS.some((n) => cmd.includes(n));

// Claude-style entries [{ matcher?, hooks: [{ command }] }]: context handlers out, empty entries out.
const dropContextHooks = (entries) => entries
    .map((e) => (e && Array.isArray(e.hooks) ? { ...e, hooks: e.hooks.filter((h) => !isContextCommand(h && h.command)) } : e))
    .filter((e) => !(e && Array.isArray(e.hooks)) || e.hooks.length);

// servers: { name: entry }. Names in `disabled` are dropped; names that are not in `servers` come back as `unknown`.
function filterMcpServers(servers, disabled) {
    const out = { ...servers };
    const unknown = [];
    for (const name of disabled) {
        if (name in out) delete out[name]; else unknown.push(name);
    }
    return { servers: out, unknown };
}

const settingsFile = (home) => path.join(home, '.aos', 'v5-settings.json');
const warned = new Set();
const warnOnce = (msg) => { if (!warned.has(msg)) { warned.add(msg); process.stderr.write(`Warning: ${msg}\n`); } };
// Never throws: a missing, corrupt or oddly shaped file gives defaults (one warning per message), so status/update/repair/uninstall stay usable.
function readSettings(home, warn = warnOnce) {
    const file = settingsFile(home);
    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
        if (e.code !== 'ENOENT') warn(`${file} is unreadable (${e.message}); using defaults.`);
        return { disabled: [] };
    }
    const { settings, problems } = sanitizeSettings(raw);
    for (const p of problems) warn(`${file}: ${p}`);
    return settings;
}
function writeSettings(home, s) {
    fs.mkdirSync(path.dirname(settingsFile(home)), { recursive: true, mode: 0o700 });
    fs.writeFileSync(settingsFile(home), JSON.stringify(s, null, 2));
}

module.exports = { ALWAYS_HOOKS, CONTEXT_HOOKS, OTHER_HOOKS, HOOK_SCRIPTS, CLAUDE_MERGE_HOOKS, HOOK_IMPORTS, HARNESS_HOOKS, PROFILES, DEFAULT_PROFILE, knownProfile, profileOf, excludedIds, parseList, parseOptions, sanitizeSettings, resolve, isContextCommand, dropContextHooks, filterMcpServers, settingsFile, readSettings, writeSettings, OWNED_KEYS };
