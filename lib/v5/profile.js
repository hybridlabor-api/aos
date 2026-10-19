'use strict';
// Install profiles and the options around them. Pure functions: no I/O except the v5 settings file helpers.
const fs = require('fs');
const os = require('os');
const path = require('path');

// Gate and safety hooks. No profile and no flag ever removes these.
const ALWAYS_HOOKS = ['go-gate.mjs', 'go-token.mjs', 'go-grant.mjs', 'graph-gate.mjs', 'conventional-commits.mjs', 'env-file-protection.mjs'];
// The subset the user can switch off with the `gate` setting (Settings menu); conventional-commits and env-file-protection stay.
const GATE_HOOKS = ['go-gate.mjs', 'go-token.mjs', 'go-grant.mjs', 'graph-gate.mjs'];
// Context-injection hooks: the only ones --no-hooks and the minimal profile skip.
const CONTEXT_HOOKS = ['memb-inject.mjs', 'rules-inject.mjs', 'trail-relay.mjs', 'trail-autostart.mjs', 'aos-session-hint.mjs'];
// AOS scripts wired outside the profile switch. a2a-session.mjs is written by installClaudeA2aSessionHook, startcycle-dispatch.mjs is a workflow.
const OTHER_HOOKS = ['startcycle-dispatch.mjs', 'a2a-inbox.mjs', 'a2a-session.mjs'];
// Every AOS-owned script a hook entry may name (agy, Codex, uninstall). One list: installer.js, lib/uninstall-records.js and bin/aos-uninstall.mjs import it.
const HOOK_SCRIPTS = ['gate-profile.mjs', ...ALWAYS_HOOKS, ...CONTEXT_HOOKS, ...OTHER_HOOKS];
// The Claude settings.json merge owns what the shipped template wires (a2a-session is its SessionStart entry); the dispatch workflow is not in it.
const CLAUDE_MERGE_HOOKS = [...ALWAYS_HOOKS, ...CONTEXT_HOOKS, 'a2a-inbox.mjs', 'a2a-session.mjs'];

// Helper scripts a hook imports from its own directory; copied with it.
const HOOK_IMPORTS = { 'go-gate.mjs': ['gate-profile.mjs'], 'go-grant.mjs': ['go-gate.mjs'], 'go-token.mjs': ['go-gate.mjs'] };
const withImports = (names) => [...new Set(names.flatMap((n) => [n, ...(HOOK_IMPORTS[n] || [])]))];
// What each harness really wires (mergeBdbSettingsHooks, mergeCodexTomlHooks, mergeAntigravityHooks), plus imports.
// startcycle-dispatch.mjs is a workflow and is copied separately. a2a-session.mjs is in the Codex list ahead of its wiring.
const HARNESS_HOOKS = {
    // aos-bus.mjs is not a hook: the `aos-bus` launcher (installGlobalBinaries) points at ~/.claude/hooks/aos-bus.mjs, so it stays there for Claude only.
    claude: withImports([...CLAUDE_MERGE_HOOKS, 'aos-bus.mjs']),
    codex: withImports(['go-gate.mjs', 'graph-gate.mjs', 'memb-inject.mjs', 'rules-inject.mjs', 'trail-relay.mjs', 'a2a-session.mjs', 'aos-session-hint.mjs']),
    agy: withImports(['go-gate.mjs', 'conventional-commits.mjs', 'env-file-protection.mjs', 'graph-gate.mjs', 'trail-relay.mjs', 'memb-inject.mjs', 'rules-inject.mjs', 'a2a-inbox.mjs']),
};

// exclude: registry ids (lib/v5/packages.js) skipped by install, update and repair. modules: how optional modules are chosen with -y.
const PROFILES = {
    minimal: { contextHooks: false, skippedHooks: CONTEXT_HOOKS, exclude: ['gateway', 'hub', 'fleet', 'sessions', 'alert', 'openwiki', 'token-saver', 'codenotch', 'memb', 'deja'], modules: 'none' },
    standard: { contextHooks: true, skippedHooks: [], exclude: ['token-saver'], modules: 'requested' },
    full: { contextHooks: true, skippedHooks: [], exclude: [], modules: 'all' },
};
const DEFAULT_PROFILE = 'standard';
// Unified memory: one --without id for the memory packages. Excluding memb also unwires memb_mcp, deja's MCP and memb-inject.
const BUNDLES = { memory: ['memb', 'deja', 'openwiki'] };
const MEMORY_MCPS = ['memb_mcp', 'deja'];

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
    const asked = parseList(withoutRaw);
    if (asked.length) {
        const known = typeof knownIds === 'function' ? knownIds() : knownIds;
        if (asked.includes('kernel')) throw new Error('--without: "kernel" cannot be excluded (skills, agents and the gate hooks live there).');
        const unknown = asked.filter((id) => !known.includes(id) && !Object.hasOwn(BUNDLES, id));
        if (unknown.length) throw new Error(`Unknown id(s) in --without: ${unknown.join(', ')}. Valid: ${[...Object.keys(BUNDLES), ...known.filter((id) => id !== 'kernel')].join(', ')}.`);
    }
    const without = [...new Set(asked.flatMap((id) => (Object.hasOwn(BUNDLES, id) ? BUNDLES[id] : [id])))];
    const hooksOnly = argv.includes('--hooks-only');
    if (hooksOnly) {
        if (flag !== undefined || withoutRaw !== undefined) throw new Error('--hooks-only cannot be combined with --profile or --without. Add --no-hooks to refresh the gate hooks only.');
        if (['status', 'update', 'repair'].includes(argv[2])) throw new Error(`--hooks-only belongs to the install, not to "aos ${argv[2]}". Run: aos --hooks-only`);
    }
    // profileFromFlag: only a flag on the command line is ever saved; AOS_PROFILE applies to this run only.
    return { profile, profileGiven, profileFromFlag: flag !== undefined, noHooks: argv.includes('--no-hooks'), hooksOnly, without };
}

const UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype'];
const DEFAULT_UPDATES = 'notify';
const DEFAULT_GATE = 'on';
const OWNED_KEYS = ['disabled', 'profile', 'noHooks', 'gateway', 'lastRunFailed', 'lastFailedSteps', 'updates', 'lastAutoUpdate', 'lastAutoUpdateResult', 'context', 'gate'];
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
    if (Object.hasOwn(raw, 'lastRunFailed')) {
        if (typeof raw.lastRunFailed === 'boolean') out.lastRunFailed = raw.lastRunFailed;
        else problems.push('"lastRunFailed" is not true or false, ignored');
    }
    if (Object.hasOwn(raw, 'lastFailedSteps')) {
        const v = raw.lastFailedSteps;
        if (!Array.isArray(v)) problems.push('"lastFailedSteps" is not an array, ignored');
        else {
            const valid = knownIds ? new Set([...knownIds, 'kernel', 'harnesses']) : null;
            const ok = v.filter((id) => typeof id === 'string' && (!valid || valid.has(id)));
            if (ok.length !== v.length) problems.push(`"lastFailedSteps" has ${v.length - ok.length} entr${v.length - ok.length === 1 ? 'y' : 'ies'} that are not known package ids, ignored`);
            out.lastFailedSteps = [...new Set(ok)];
        }
    }
    if (Object.hasOwn(raw, 'gateway')) {
        const g = raw.gateway;
        if (!g || typeof g !== 'object' || Array.isArray(g)) problems.push('"gateway" is not an object, ignored');
        else {
            const gw = {};
            for (const k of ['adopted', 'declined']) {
                if (!Object.hasOwn(g, k)) continue;
                if (Array.isArray(g[k]) && g[k].every((n) => typeof n === 'string')) gw[k] = [...new Set(g[k])];
                else problems.push(`"gateway.${k}" is not a list of names, ignored`);
            }
            if (Object.hasOwn(g, 'promptedAt')) {
                if (typeof g.promptedAt === 'string' && !Number.isNaN(Date.parse(g.promptedAt))) gw.promptedAt = g.promptedAt;
                else problems.push('"gateway.promptedAt" is not a date, ignored');
            }
            if (Object.hasOwn(g, 'mode')) {
                if (g.mode === 'gateway' || g.mode === 'direct') gw.mode = g.mode;
                else problems.push('"gateway.mode" is not "gateway" or "direct", ignored');
            }
            out.gateway = gw;
        }
    }
    if (Object.hasOwn(raw, 'updates')) {
        if (['notify', 'auto', 'off'].includes(raw.updates)) out.updates = raw.updates;
        else problems.push('"updates" is not "notify", "auto" or "off", ignored');
    }
    if (Object.hasOwn(raw, 'gate')) {
        if (['on', 'off'].includes(raw.gate)) out.gate = raw.gate;
        else problems.push(`"gate" is not "on" or "off", using ${DEFAULT_GATE}`);
    }
    if (Object.hasOwn(raw, 'lastAutoUpdate')) {
        if (typeof raw.lastAutoUpdate === 'number' || typeof raw.lastAutoUpdate === 'string' || (raw.lastAutoUpdate && typeof raw.lastAutoUpdate === 'object')) {
            out.lastAutoUpdate = raw.lastAutoUpdate;
        } else problems.push('"lastAutoUpdate" is invalid, ignored');
    }
    if (Object.hasOwn(raw, 'lastAutoUpdateResult')) {
        if (typeof raw.lastAutoUpdateResult === 'string') out.lastAutoUpdateResult = raw.lastAutoUpdateResult;
        else problems.push('"lastAutoUpdateResult" is not a string, ignored');
    }
    if (Object.hasOwn(raw, 'context')) {
        const { knownContextProfile, DEFAULT_CONTEXT_PROFILE } = require('./context-profiles');
        if (knownContextProfile(raw.context)) out.context = String(raw.context).trim().toLowerCase();
        else problems.push(`"context" ${JSON.stringify(String(raw.context)).slice(0, 40)} is not a context profile, using ${DEFAULT_CONTEXT_PROFILE}`);
    }
    return { settings: out, problems };
}

// settings = persisted v5 settings. An explicit --profile replaces the persisted profile and --no-hooks setting.
function resolve(opts, settings = {}) {
    const st = sanitizeSettings(settings, null).settings;
    const profile = opts.profileGiven && knownProfile(opts.profile) ? opts.profile : (opts.profileGiven ? DEFAULT_PROFILE : (st.profile || DEFAULT_PROFILE));
    const noHooks = opts.noHooks || (!opts.profileGiven && st.noHooks === true);
    const excluded = new Set([...PROFILES[profile].exclude, ...opts.without, ...st.disabled]);
    return { profile, noHooks, contextHooks: PROFILES[profile].contextHooks && !noHooks, excluded, gateOn: st.gate !== 'off' };
}

const isContextCommand = (cmd) => typeof cmd === 'string' && CONTEXT_HOOKS.some((n) => cmd.includes(n));

// Claude-style entries [{ matcher?, hooks: [{ command }] }]: context handlers (or isDropped ones) out, empty entries out.
const dropContextHooks = (entries, isDropped = isContextCommand) => entries
    .map((e) => (e && Array.isArray(e.hooks) ? { ...e, hooks: e.hooks.filter((h) => !isDropped(h && h.command)) } : e))
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
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) {
        if (e.code !== 'ENOENT') warn(`${file} is unreadable (${e.message}); using defaults.`);
        return { disabled: [], updates: DEFAULT_UPDATES };
    }
    const { settings, problems } = sanitizeSettings(raw);
    for (const p of problems) warn(`${file}: ${p}`);
    if (!settings.updates) settings.updates = DEFAULT_UPDATES;
    return settings;
}
function writeSettings(home, s) {
    fs.mkdirSync(path.dirname(settingsFile(home)), { recursive: true, mode: 0o700 });
    fs.writeFileSync(settingsFile(home), JSON.stringify(s, null, 2));
}

function isTestSandbox(home = process.env.HOME || process.env.USERPROFILE) {
    if (process.env.AOS_TEST_SANDBOX === '1') return true;
    if (!home || typeof home !== 'string') return false;
    try {
        const h = path.resolve(home);
        const t = path.resolve(os.tmpdir());
        if (h === t || h.startsWith(t + path.sep)) return true;
        let realH = h, realT = t;
        try { realH = fs.realpathSync(h); } catch (_) {}
        try { realT = fs.realpathSync(t); } catch (_) {}
        if (realH === realT || realH.startsWith(realT + path.sep)) return true;
        if (h.startsWith('/tmp/') || realH.startsWith('/tmp/') || realH.startsWith('/private/tmp/')) return true;
    } catch (_) {
        if (typeof home === 'string' && (home.startsWith('/tmp/') || home.startsWith('/private/tmp/'))) return true;
    }
    return false;
}

module.exports = { BUNDLES, MEMORY_MCPS, ALWAYS_HOOKS, GATE_HOOKS, DEFAULT_GATE, gateOf: (st) => (st && st.gate === 'off' ? 'off' : 'on'), CONTEXT_HOOKS, OTHER_HOOKS, HOOK_SCRIPTS, CLAUDE_MERGE_HOOKS, HOOK_IMPORTS, HARNESS_HOOKS, PROFILES, DEFAULT_PROFILE, DEFAULT_UPDATES, knownProfile, profileOf, excludedIds, parseList, parseOptions, sanitizeSettings, resolve, isContextCommand, dropContextHooks, filterMcpServers, settingsFile, readSettings, writeSettings, OWNED_KEYS, isTestSandbox, knownContextProfile: (x) => require('./context-profiles').knownContextProfile(x), contextProfileOf: (x) => require('./context-profiles').contextProfileOf(x) };
