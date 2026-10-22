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
    'plan', 'playbooks', 'setup', 'shipping', 'startproject', 'store', 'hub',
].map((c) => `bdb-aos-${c}.md`);
// `aos` is the MCP gateway's single entry: it replaces the per-server entries, so it belongs to the lean set.
const LEAN_MCP = new Set(['aos', 'memb_mcp', 'deja', 'zavora_computer_use']);

// plugin[] entry -> absolute file path (file:// URLs and ~ expanded); null for npm package specs.
function pluginFile(entry, home) {
    const raw = String(Array.isArray(entry) ? entry[0] : entry).trim();
    if (raw.startsWith('file://')) { try { return path.resolve(require('node:url').fileURLToPath(raw)); } catch { return null; } }
    if (raw.startsWith('~/')) return path.resolve(home, raw.slice(2));
    return path.isAbsolute(raw) || /^\.{1,2}[\\/]/.test(raw) ? path.resolve(raw) : null;
}

// Every directory an AOS install ever put plugins/bdb-aos.js in, and whose opencode.json(c)/config.json OpenCode may read:
// the current ~/.config/opencode, the legacy ~/.opencode and, on Windows, %APPDATA%\opencode (Lenovo 5.4.0: a stale legacy
// entry gave a second plugin_origin).
function opencodeDirs(home, platform = process.platform, env = process.env) {
    const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return [...new Set([path.join(home, '.config', 'opencode'), path.join(home, '.opencode'), ...(platform === 'win32' ? [path.join(appData, 'opencode')] : [])])];
}
const OPENCODE_CONFIG_NAMES = ['opencode.jsonc', 'opencode.json', 'config.json'];
const opencodeConfigFiles = (home, platform, env) => opencodeDirs(home, platform, env).flatMap((d) => OPENCODE_CONFIG_NAMES.map((n) => path.join(d, n)));

// A plugin[] entry that names an AOS-installed bdb-aos.js (any spelling): OpenCode auto-loads that file, so the entry only doubles it.
function isAosPluginEntry(entry, home, platform = process.platform, env = process.env) {
    const abs = pluginFile(entry, home);
    if (!abs) return false;
    const key = (p) => { const r = path.resolve(p).replace(/\\/g, '/'); return platform === 'win32' ? r.toLowerCase() : r; };
    return opencodeDirs(home, platform, env).some((d) => key(path.join(d, 'plugins', 'bdb-aos.js')) === key(abs));
}

// Removes AOS bdb-aos.js entries from plugin[] in every OpenCode config file as a textual edit (comments and foreign
// entries stay; a file the edit cannot do safely is left alone). Never deletes a file. Returns the changed files.
function removeAosPluginEntries(home, { platform = process.platform, env = process.env, extraFiles = [], dryRun = false, backup = () => {} } = {}) {
    const { removeJsoncArrayEntries } = require('./jsonc');
    const changed = [];
    for (const file of [...new Set([...opencodeConfigFiles(home, platform, env), ...extraFiles])]) {
        let src;
        try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
        const text = removeJsoncArrayEntries(src, 'plugin', (e) => isAosPluginEntry(e, home, platform, env));
        if (text === null || text === src) continue;
        changed.push(file);
        if (dryRun) continue;
        backup(file);
        fs.writeFileSync(file, text);
    }
    return changed;
}

function onPath(name, { PATH = process.env.PATH || '', platform = process.platform, exists = fs.existsSync } = {}) {
    const exts = platform === 'win32' ? ['', '.cmd', '.exe', '.ps1'] : [''];
    const sep = platform === 'win32' ? ';' : ':';
    for (const dir of PATH.split(sep).filter(Boolean)) {
        for (const ext of exts) if (exists(path.join(dir, name + ext))) return path.join(dir, name + ext);
    }
    return null;
}

// cli-spawn resolves the npm .cmd shim on Windows; execFileSync on the extensionless shim threw ENOENT.
function defaultRun(cmd, args, cwd, env) {
    const r = require('./cli-spawn').run(cmd, args, { timeout: 30000, cwd, env });
    return r.status === 0 ? r.stdout : null;
}

// The bdb-aos plugin targets the OpenCode 1.x plugin API; no 2.x entry point is known yet (#175).
function opencodeVersionWarning(versionText) {
    const m = /(\d+)\.\d+\.\d+/.exec(String(versionText || ''));
    if (!m || Number(m[1]) < 2) return null;
    return `OpenCode ${m[0]} found: the bdb-aos plugin (gate, A2A) needs OpenCode 1.x until a 2.x entry exists. Install opencode-ai@1 to use it.`;
}

function checkOpencode({ home = os.homedir(), platform = process.platform, env = process.env, run = defaultRun, exists = fs.existsSync, readFile = (p) => fs.readFileSync(p, 'utf8'), cwd = os.tmpdir() } = {}) {
    const results = [];
    const add = (name, ok, detail, fix) => results.push({ area: 'harnesses', name, ok, detail, fix, warningOnly: true });
    const tilde = (p) => p.replace(home, '~');
    // OpenCode reads ~/.config/opencode on Windows too (`opencode debug paths`), never %APPDATA%.
    const configDirs = [path.join(home, '.config', 'opencode')];
    const dirs = [...configDirs, path.join(home, '.opencode')];
    const cliPath = onPath('opencode', { PATH: env.PATH, platform, exists });
    if (!cliPath && !configDirs.some(exists)) return results;
    const installFix = 'Run the AOS installer (npx @hybridlabor-api/aos@latest) to wire OpenCode.';

    const pluginDir = dirs.find((d) => exists(path.join(d, 'plugins', 'bdb-aos.js')));
    const pluginFileAbs = pluginDir && path.join(pluginDir, 'plugins', 'bdb-aos.js');
    add('OpenCode plugin file', !!pluginDir, pluginDir ? tilde(pluginFileAbs) : 'bdb-aos.js missing from the OpenCode plugins directory', installFix);
    const hooksOk = !!pluginDir && exists(path.join(pluginDir, 'plugins', 'aos-hooks', 'go-gate.mjs'));
    add('OpenCode plugin hooks', hooksOk, hooksOk ? tilde(path.join(pluginDir, 'plugins', 'aos-hooks')) : 'plugins/aos-hooks/go-gate.mjs missing: the plugin cannot load', installFix);

    // OpenCode auto-loads plugins/*.js and also loads plugin[] paths. On macOS 1.18.30 the same file in plugin[] was
    // deduped, on Windows it loaded twice (two plugin_origins): any bdb-aos.js entry in plugin[] is a double load.
    // Legacy ~/.opencode and %APPDATA%\opencode configs count too: a stale entry there was the second origin on Windows.
    const seen = new Set();
    const listedIn = new Set();
    for (const p of opencodeConfigFiles(home, platform, env)) {
        if (!exists(p)) continue;
        let conf = null;
        try { conf = parseJsonc(readFile(p)); } catch { /* unreadable: ignored */ }
        for (const e of Array.isArray(conf?.plugin) ? conf.plugin : []) {
            const abs = pluginFile(e, home);
            if (abs && /bdb-aos\.js$/.test(abs)) { seen.add(abs); listedIn.add(tilde(p)); }
        }
    }
    const where = ` (listed in ${[...listedIn].join(', ')})`;
    const extra = [...seen].filter((p) => p !== (pluginFileAbs && path.resolve(pluginFileAbs)));
    if (pluginDir) add('OpenCode plugin registration', seen.size === 0,
        extra.length ? `plugin[] names another bdb-aos.js (${extra.map(tilde).join(', ')}): the gate would load twice${where}`
            : seen.size ? `plugin[] also lists the auto-loaded plugins/bdb-aos.js: OpenCode on Windows loads it twice${where}` : 'auto-loaded from plugins/ (no plugin[] entry): loaded once',
        'Re-run the AOS installer (it drops its own entry) or remove the bdb-aos.js entry from plugin[] in opencode.json/opencode.jsonc.');

    const cmdDir = configDirs.map((d) => path.join(d, 'commands')).find(exists) || path.join(configDirs[0], 'commands');
    const missing = COMMANDS.filter((c) => !exists(path.join(cmdDir, c)));
    add('OpenCode commands', missing.length === 0,
        missing.length ? `${COMMANDS.length - missing.length}/${COMMANDS.length} in ${tilde(cmdDir)}; missing ${missing.map((c) => '/' + c.replace(/\.md$/, '')).join(', ')}` : `${COMMANDS.length}/${COMMANDS.length} /bdb-aos-* commands in ${tilde(cmdDir)}`,
        installFix);

    if (cliPath && configDirs.some(exists)) {
        const warn = opencodeVersionWarning(run('opencode', ['--version'], cwd, env));
        if (warn) add('OpenCode version', false, warn, 'npm i -g opencode-ai@1');
    }

    if (!cliPath) {
        add('OpenCode CLI view', false, 'opencode not on PATH: only file checks ran', 'Install OpenCode (https://opencode.ai) or add it to PATH.');
    } else if (!configDirs.some(exists)) {
        // `opencode debug config` creates the config directory and a default opencode.jsonc; a doctor must not.
        add('OpenCode CLI view', false, 'no OpenCode config directory yet: `opencode debug config` not run', installFix);
    } else {
        let conf = null;
        const out = run('opencode', ['debug', 'config'], cwd, env);
        try { conf = out ? JSON.parse(out) : null; } catch { /* not JSON */ }
        if (!conf) {
            add('OpenCode CLI view', false, '`opencode debug config` failed or printed no JSON', 'Run `opencode debug config` yourself to see the error.');
        } else {
            const origins = (Array.isArray(conf.plugin_origins) ? conf.plugin_origins : []).filter((o) => /bdb-aos\.js/.test(String(o.spec)));
            const cmds = Object.keys(conf.command || {}).filter((c) => c.startsWith('bdb-aos-'));
            const enabled = Object.entries(conf.mcp || {}).filter(([, v]) => v && v.enabled !== false).map(([k]) => k);
            const extraMcp = enabled.filter((k) => !LEAN_MCP.has(k));
            add('OpenCode CLI view', origins.length <= 1 && cmds.length === COMMANDS.length,
                `opencode sees ${cmds.length} /bdb-aos-* commands, ${origins.length} bdb-aos.js plugin origin${origins.length === 1 ? '' : 's'} (auto-load included)`,
                'Re-run the AOS installer; it removes its own bdb-aos.js entry from plugin[] (OpenCode auto-loads plugins/bdb-aos.js).');
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

module.exports = { opencodeVersionWarning, COMMANDS, LEAN_MCP, checkOpencode, checkAcpAndGoCheck, onPath, parseJsonc, pluginFile, opencodeDirs, opencodeConfigFiles, isAosPluginEntry, removeAosPluginEntries };
