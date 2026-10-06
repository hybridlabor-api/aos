'use strict';
// Install profiles and the options around them. Pure functions: no I/O except the v5 settings file helpers.
const fs = require('fs');
const path = require('path');

// Gate and safety hooks. No profile and no flag ever removes these.
const ALWAYS_HOOKS = ['go-gate.mjs', 'go-token.mjs', 'go-grant.mjs', 'graph-gate.mjs', 'conventional-commits.mjs', 'env-file-protection.mjs'];
// Context-injection hooks: the only ones --no-hooks and the minimal profile skip.
const CONTEXT_HOOKS = ['memb-inject.mjs', 'rules-inject.mjs', 'trail-relay.mjs', 'trail-autostart.mjs'];

// exclude: registry ids (lib/v5/packages.js) skipped by install and update. modules: how optional modules are chosen with -y.
const PROFILES = {
    minimal: { contextHooks: false, skippedHooks: CONTEXT_HOOKS, exclude: ['gateway', 'fleet', 'openwiki', 'token-saver', 'codenotch'], modules: 'none' },
    standard: { contextHooks: true, skippedHooks: [], exclude: [], modules: 'requested' },
    full: { contextHooks: true, skippedHooks: [], exclude: [], modules: 'all' },
};
const DEFAULT_PROFILE = 'standard';

const parseList = (raw) => String(raw || '').split(',').map((x) => x.trim()).filter(Boolean);
const flagValue = (argv, name) => {
    const a = argv.find((x) => x === name || x.startsWith(`${name}=`));
    return a === undefined ? undefined : (a.includes('=') ? a.slice(name.length + 1) : '');
};

// knownIds: registry ids (array or function returning one). Throws Error with a user-facing message.
function parseOptions(argv = process.argv, env = process.env, knownIds = []) {
    const flag = flagValue(argv, '--profile');
    const raw = flag !== undefined ? flag : env.AOS_PROFILE;
    const profileGiven = raw !== undefined && raw !== '';
    if (flag === '') throw new Error('--profile needs a value: --profile=minimal|standard|full');
    const profile = profileGiven ? String(raw).trim().toLowerCase() : DEFAULT_PROFILE;
    if (!PROFILES[profile]) throw new Error(`Unknown profile "${raw}". Valid: ${Object.keys(PROFILES).join(', ')}.`);

    const withoutRaw = flagValue(argv, '--without');
    if (withoutRaw === '') throw new Error('--without needs a value: --without=<id,id>');
    const without = parseList(withoutRaw);
    if (without.length) {
        const known = typeof knownIds === 'function' ? knownIds() : knownIds;
        if (without.includes('kernel')) throw new Error('--without: "kernel" cannot be excluded (skills, agents and the gate hooks live there).');
        const unknown = without.filter((id) => !known.includes(id));
        if (unknown.length) throw new Error(`Unknown id(s) in --without: ${unknown.join(', ')}. Valid: ${known.filter((id) => id !== 'kernel').join(', ')}.`);
    }
    return { profile, profileGiven, noHooks: argv.includes('--no-hooks'), hooksOnly: argv.includes('--hooks-only'), without };
}

// settings = persisted v5 settings. An explicit --profile replaces the persisted profile and --no-hooks setting.
function resolve(opts, settings = {}) {
    const profile = opts.profileGiven ? opts.profile : (PROFILES[settings.profile] ? settings.profile : DEFAULT_PROFILE);
    const noHooks = opts.noHooks || (!opts.profileGiven && settings.noHooks === true);
    const excluded = new Set([...PROFILES[profile].exclude, ...opts.without, ...(settings.disabled || [])]);
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
const readSettings = (home) => { try { return { disabled: [], ...JSON.parse(fs.readFileSync(settingsFile(home), 'utf8')) }; } catch { return { disabled: [] }; } };
function writeSettings(home, s) {
    fs.mkdirSync(path.dirname(settingsFile(home)), { recursive: true, mode: 0o700 });
    fs.writeFileSync(settingsFile(home), JSON.stringify(s, null, 2));
}

module.exports = { ALWAYS_HOOKS, CONTEXT_HOOKS, PROFILES, DEFAULT_PROFILE, parseList, parseOptions, resolve, isContextCommand, dropContextHooks, filterMcpServers, settingsFile, readSettings, writeSettings };
