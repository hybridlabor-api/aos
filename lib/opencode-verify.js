'use strict';
// Verifies what the AOS installer promises for OpenCode and aos-acp. Pure: every
// dependency (fs, PATH, the opencode CLI) is injectable, so tests never touch the
// real machine. Used by bin/aos-doctor.mjs. Every result is a warning, never critical:
// OpenCode is optional.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseJsonc } = require('./jsonc');

const COMMANDS = [
    'brainstorm', 'doctor', 'graph', 'init', 'loop', 'mastersession', 'memb', 'orchestrator',
    'plan', 'playbooks', 'setup', 'shipping', 'startproject', 'store',
].map((c) => `bdb-aos-${c}.md`);
const LEAN_MCP = new Set(['memb_mcp', 'deja', 'zavora_computer_use']);

// plugin[] entry -> absolute file path (file:// URLs and ~ expanded); null for npm package specs.
function pluginFile(entry, home) {
    const raw = String(Array.isArray(entry) ? entry[0] : entry).trim();
    if (raw.startsWith('file://')) { try { return path.resolve(decodeURIComponent(new URL(raw).pathname)); } catch { return null; } }
    if (raw.startsWith('~/')) return path.resolve(home, raw.slice(2));
    return path.isAbsolute(raw) || /^\.{1,2}[\\/]/.test(raw) ? path.resolve(raw) : null;
}

function onPath(name, { PATH = process.env.PATH || '', platform = process.platform, exists = fs.existsSync } = {}) {
    const exts = platform === 'win32' ? ['', '.cmd', '.exe', '.ps1'] : [''];
    const sep = platform === 'win32' ? ';' : ':';
    for (const dir of PATH.split(sep).filter(Boolean)) {
        for (const ext of exts) if (exists(path.join(dir, name + ext))) return path.join(dir, name + ext);
    }
    return null;
}

function defaultRun(cmd, args, cwd, env) {
    try {
        return require('node:child_process').execFileSync(cmd, args, { encoding: 'utf8', timeout: 30000, cwd, env, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    } catch { return null; }
}

function checkOpencode({ home = os.homedir(), platform = process.platform, env = process.env, run = defaultRun, exists = fs.existsSync, readFile = (p) => fs.readFileSync(p, 'utf8'), cwd = os.tmpdir() } = {}) {
    const results = [];
    const add = (name, ok, detail, fix) => results.push({ area: 'harnesses', name, ok, detail, fix, warningOnly: true });
    const tilde = (p) => p.replace(home, '~');
    const configDirs = [...new Set([
        path.join(home, '.config', 'opencode'),
        ...(platform === 'win32' ? [path.join(env.APPDATA || home, 'opencode')] : []),
    ])];
    const dirs = [...configDirs, path.join(home, '.opencode')];
    const cliPath = onPath('opencode', { PATH: env.PATH, platform, exists });
    if (!cliPath && !configDirs.some(exists)) return results;
    const installFix = 'Run the AOS installer (npx @hybridlabor-api/aos@latest) to wire OpenCode.';

    const pluginDir = dirs.find((d) => exists(path.join(d, 'plugins', 'bdb-aos.js')));
    const pluginFileAbs = pluginDir && path.join(pluginDir, 'plugins', 'bdb-aos.js');
    add('OpenCode plugin file', !!pluginDir, pluginDir ? tilde(pluginFileAbs) : 'bdb-aos.js missing from the OpenCode plugins directory', installFix);
    const hooksOk = !!pluginDir && exists(path.join(pluginDir, 'plugins', 'aos-hooks', 'go-gate.mjs'));
    add('OpenCode plugin hooks', hooksOk, hooksOk ? tilde(path.join(pluginDir, 'plugins', 'aos-hooks')) : 'plugins/aos-hooks/go-gate.mjs missing: the plugin cannot load', installFix);

    // OpenCode auto-loads plugins/*.js and also plugin[] paths and dedupes by file. Verified with
    // a probe plugin on 1.18.30: auto-load plus the same file as absolute path, file:// URL or
    // path with `..` loads once. A different file named bdb-aos.js loads twice (double gate).
    const seen = new Set();
    for (const d of configDirs) {
        for (const f of ['config.json', 'opencode.json', 'opencode.jsonc']) {
            const p = path.join(d, f);
            if (!exists(p)) continue;
            let conf = null;
            try { conf = parseJsonc(readFile(p)); } catch { /* unreadable: ignored */ }
            for (const e of Array.isArray(conf?.plugin) ? conf.plugin : []) {
                const abs = pluginFile(e, home);
                if (abs && /bdb-aos\.js$/.test(abs)) seen.add(abs);
            }
        }
    }
    const extra = [...seen].filter((p) => p !== (pluginFileAbs && path.resolve(pluginFileAbs)));
    if (pluginDir) add('OpenCode plugin registration', extra.length === 0,
        extra.length ? `plugin[] names another bdb-aos.js (${extra.map(tilde).join(', ')}): the gate would load twice`
            : seen.size ? 'plugin[] entry resolves to the installed file: loaded once' : 'auto-loaded from plugins/ (no plugin[] entry): loaded once',
        'Remove the extra bdb-aos.js entry from plugin[] in opencode.json/opencode.jsonc.');

    const cmdDir = configDirs.map((d) => path.join(d, 'commands')).find(exists) || path.join(configDirs[0], 'commands');
    const missing = COMMANDS.filter((c) => !exists(path.join(cmdDir, c)));
    add('OpenCode commands', missing.length === 0,
        missing.length ? `${COMMANDS.length - missing.length}/${COMMANDS.length} in ${tilde(cmdDir)}; missing ${missing.map((c) => '/' + c.replace(/\.md$/, '')).join(', ')}` : `${COMMANDS.length}/${COMMANDS.length} /bdb-aos-* commands in ${tilde(cmdDir)}`,
        installFix);

    if (!cliPath) {
        add('OpenCode CLI view', false, 'opencode not on PATH: only file checks ran', 'Install OpenCode (https://opencode.ai) or add it to PATH.');
    } else if (!configDirs.some(exists)) {
        // `opencode debug config` creates the config directory and a default opencode.jsonc; a doctor must not.
        add('OpenCode CLI view', false, 'no OpenCode config directory yet: `opencode debug config` not run', installFix);
    } else {
        let conf = null;
        const out = run(cliPath, ['debug', 'config'], cwd, env);
        try { conf = out ? JSON.parse(out) : null; } catch { /* not JSON */ }
        if (!conf) {
            add('OpenCode CLI view', false, '`opencode debug config` failed or printed no JSON', 'Run `opencode debug config` yourself to see the error.');
        } else {
            const origins = (Array.isArray(conf.plugin_origins) ? conf.plugin_origins : []).filter((o) => /bdb-aos\.js/.test(String(o.spec)));
            const cmds = Object.keys(conf.command || {}).filter((c) => c.startsWith('bdb-aos-'));
            const enabled = Object.entries(conf.mcp || {}).filter(([, v]) => v && v.enabled !== false).map(([k]) => k);
            const extraMcp = enabled.filter((k) => !LEAN_MCP.has(k));
            add('OpenCode CLI view', origins.length <= 1 && cmds.length === COMMANDS.length,
                `opencode sees ${cmds.length} /bdb-aos-* commands, ${origins.length} bdb-aos.js entr${origins.length === 1 ? 'y' : 'ies'} in plugin[] (plus auto-load)`,
                'Re-run the AOS installer; if plugin[] lists bdb-aos.js more than once, remove the extras.');
            add('OpenCode MCP set', extraMcp.length === 0,
                extraMcp.length ? `enabled beyond the lean set (${[...LEAN_MCP].join(', ')}): ${extraMcp.join(', ')}` : `lean: ${enabled.join(', ') || 'none enabled'}`,
                'Set "enabled": false for those servers in opencode.jsonc (long tool names and context hurt OpenCode providers).');
        }
    }
    return results;
}

function checkAcpAndGoCheck({ home = os.homedir(), platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
    const results = [];
    const add = (name, ok, detail, fix) => results.push({ area: 'harnesses', name, ok, detail, fix, warningOnly: true });
    const tilde = (p) => p.replace(home, '~');
    const acp = onPath('aos-acp', { PATH: env.PATH, platform, exists });
    const launcher = path.join(home, '.local', 'bin', platform === 'win32' ? 'aos-acp.cmd' : 'aos-acp');
    const target = path.join(home, '.agents', 'bin', 'aos-acp.mjs');
    const broken = !!acp && path.resolve(acp) === launcher && !exists(target);
    add('aos-acp', !!acp && !broken,
        acp ? `${tilde(acp)}${broken ? ` -> ${tilde(target)} missing` : ''}`
            : exists(launcher) ? `${tilde(launcher)} exists but ${tilde(path.dirname(launcher))} is not on PATH` : 'aos-acp launcher not installed',
        exists(launcher) ? `Add ${tilde(path.dirname(launcher))} to PATH.` : 'Run the AOS installer to install the aos-acp launcher.');
    const bin = path.join(home, '.aos', 'bin');
    const files = ['go-check.mjs', 'go-gate.mjs', 'guarded-patterns.json'];
    const gone = files.filter((f) => !exists(path.join(bin, f)));
    add('go-check', gone.length === 0, gone.length ? `${tilde(bin)} lacks ${gone.join(', ')}` : `${tilde(path.join(bin, 'go-check.mjs'))} (+ go-gate.mjs, guarded-patterns.json)`,
        'Run the AOS installer to install go-check.');
    return results;
}

module.exports = { COMMANDS, LEAN_MCP, checkOpencode, checkAcpAndGoCheck, onPath, parseJsonc, pluginFile };
