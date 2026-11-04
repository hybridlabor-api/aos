'use strict';
// Best-effort install of the bdb-aos plugin into Antigravity (agy) through its own CLI.
//
// Measured with agy 1.2.14: `agy plugin install <dir>` takes a local directory only (no GitHub
// owner/repo, no plugin@marketplace without a registered marketplace), copies it to
// ~/.gemini/config/plugins/<name> (symlinks are followed, so the copy is real files), and records the
// enabled flag in ~/.gemini/config/config.json.
//
// Stage 1 (F1): Install AOS into agy as a global plugin at ~/.gemini/config/plugins/bdb-aos/ with
// plugin.json, selected skills as symlinks to ~/.agents/skills/<name>, agents/, hooks.json,
// mcp_config.json, and rules/AGENTS.md. Loose copies in ~/.gemini/config/skills are retired.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cliSpawn = require('./cli-spawn');
const leanSkills = require('./lean-skills');
const coreSkills = require('./core-skills');

const PLUGIN = 'bdb-aos';
const stateFile = (home) => path.join(home, '.agents', '.bdb-agy-plugin.json');
const pluginDir = (home) => path.join(home, '.gemini', 'config', 'plugins', PLUGIN);
const configFile = (home) => path.join(home, '.gemini', 'config', 'config.json');

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; } };

function defaultRunner(args) {
    const r = cliSpawn.run('agy', args, { timeout: 180000 });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error };
}

// An npx package root is a garbage-collected cache; point the hints at a checkout instead.
const isNpxPath = (p) => /[\\/]_npx[\\/]/.test(String(p || ''));

const manual = (srcDir) => [
    ...(isNpxPath(srcDir)
        ? ['git clone https://github.com/hybridlabor-api/aos.git', 'node aos/lib/agy-plugin-install.js']
        : [`node ${path.join(srcDir, 'lib', 'agy-plugin-install.js')}`]),
    `agy plugin enable ${PLUGIN}`,
];

function validateManifestShape(manifest) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new Error('plugin.json must be a JSON object');
    }
    if (!manifest.name || typeof manifest.name !== 'string') {
        throw new Error('plugin.json missing required string property "name"');
    }
    if (!manifest.version || typeof manifest.version !== 'string') {
        throw new Error('plugin.json missing required string property "version"');
    }
    return true;
}

function findSkillInSource(srcDir, name) {
    const skillsRoot = path.join(srcDir, 'skills');
    if (!fs.existsSync(skillsRoot)) return null;
    const direct = path.join(skillsRoot, name);
    if (fs.existsSync(path.join(direct, 'SKILL.md'))) return direct;
    let found = null;
    const walk = (d) => {
        try {
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                if (!e.isDirectory() || found) continue;
                const sub = path.join(d, e.name);
                if (e.name === name && fs.existsSync(path.join(sub, 'SKILL.md'))) { found = sub; return; }
                walk(sub);
            }
        } catch (_) {}
    };
    walk(skillsRoot);
    return found;
}

function computeSelectedSkills(srcDir, home) {
    let settings = null;
    const settingsPath = path.join(home, '.aos', 'v5-settings.json');
    try {
        if (fs.existsSync(settingsPath)) {
            settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        }
    } catch (_) {}

    const mode = leanSkills.modeOf(settings);
    const opts = leanSkills.optsOf(settings);

    let names = new Set();
    if (mode === 'full') {
        const agentsSkillsDir = path.join(home, '.agents', 'skills');
        if (fs.existsSync(agentsSkillsDir)) {
            try {
                for (const e of fs.readdirSync(agentsSkillsDir, { withFileTypes: true })) {
                    if (e.isDirectory() && !e.name.startsWith('.')) names.add(e.name);
                }
            } catch (_) {}
        }
        if (!names.size) {
            try {
                for (const n of coreSkills.shippedSkills(srcDir)) names.add(n);
            } catch (_) {}
        }
    } else {
        try { names = leanSkills.keepSet(mode, srcDir, opts); } catch (_) { /* package without lean-skills.json: picks only */ }
        if (opts.picks && Array.isArray(opts.picks)) {
            for (const p of opts.picks) names.add(p);
        }
    }
    // If no skills found (e.g. minimal fakePkg in unit tests), scan srcDir/skills
    if (!names.size) {
        const skillsRoot = path.join(srcDir, 'skills');
        if (fs.existsSync(skillsRoot)) {
            const walk = (d) => {
                try {
                    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                        if (!e.isDirectory()) continue;
                        if (fs.existsSync(path.join(d, e.name, 'SKILL.md'))) names.add(e.name);
                        else walk(path.join(d, e.name));
                    }
                } catch (_) {}
            };
            walk(skillsRoot);
        }
    }
    return names;
}

function selectedSkillFingerprint(srcDir, home, names = computeSelectedSkills(srcDir, home)) {
    const hash = crypto.createHash('sha256');
    const sorted = [...names].sort();
    for (const name of sorted) {
        hash.update(name).update('\0');
        const dir = path.join(home, '.agents', 'skills', name);
        const root = fs.existsSync(dir) ? dir : findSkillInSource(srcDir, name);
        if (!root) { hash.update('missing\0'); continue; }
        const walk = (current, rel = '') => {
            for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
                const file = path.join(current, entry.name);
                const child = path.join(rel, entry.name);
                if (entry.isDirectory()) walk(file, child);
                else if (entry.isFile()) hash.update(child).update('\0').update(fs.readFileSync(file)).update('\0');
            }
        };
        walk(root);
    }
    return { names: sorted, hash: hash.digest('hex') };
}

// Staging directory for Antigravity plugin: symlinks selected skills to ~/.agents/skills/<name>
function stagePlugin(srcDir, dest, { home = os.homedir() } = {}) {
    const link = (from, to) => {
        if (process.platform === 'win32') {
            try { fs.symlinkSync(from, to, 'junction'); return; } catch (_) {
                fs.cpSync(from, to, { recursive: true, dereference: true }); return;
            }
        }
        try { fs.symlinkSync(from, to, 'dir'); } catch (_) {
            fs.cpSync(from, to, { recursive: true, dereference: true });
        }
    };

    const manifestFile = path.join(srcDir, 'plugin.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    validateManifestShape(manifest);
    if (Array.isArray(manifest.skills)) manifest.skills = [];
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');

    for (const d of ['commands', 'agy-commands']) {
        if (fs.existsSync(path.join(srcDir, d))) link(path.join(srcDir, d), path.join(dest, d));
    }

    // agents/
    const srcAgents = fs.existsSync(path.join(srcDir, '.claude', 'agents'))
        ? path.join(srcDir, '.claude', 'agents')
        : (fs.existsSync(path.join(srcDir, 'agents')) ? path.join(srcDir, 'agents') : null);
    if (srcAgents) {
        fs.cpSync(srcAgents, path.join(dest, 'agents'), { recursive: true });
    } else {
        fs.mkdirSync(path.join(dest, 'agents'), { recursive: true });
    }

    // hooks.json
    const srcHooks = path.join(srcDir, 'hooks.json');
    if (fs.existsSync(srcHooks)) {
        fs.copyFileSync(srcHooks, path.join(dest, 'hooks.json'));
    } else {
        const defaultHooks = {
            hooks: {
                PreToolUse: [
                    {
                        matcher: 'run_command|Bash',
                        hooks: [{ type: 'command', command: 'node "hooks/go-gate.mjs"', timeout: 10 }]
                    }
                ]
            }
        };
        fs.writeFileSync(path.join(dest, 'hooks.json'), JSON.stringify(defaultHooks, null, 2) + '\n');
    }

    // mcp_config.json
    const srcMcp = path.join(srcDir, 'mcp_config.json');
    if (fs.existsSync(srcMcp)) {
        fs.copyFileSync(srcMcp, path.join(dest, 'mcp_config.json'));
    } else {
        fs.writeFileSync(path.join(dest, 'mcp_config.json'), '{\n  "mcpServers": {}\n}\n');
    }

    // rules/AGENTS.md
    fs.mkdirSync(path.join(dest, 'rules'), { recursive: true });
    const srcRules = path.join(srcDir, 'AGENTS.md');
    if (fs.existsSync(srcRules)) {
        fs.copyFileSync(srcRules, path.join(dest, 'rules', 'AGENTS.md'));
    } else {
        fs.writeFileSync(path.join(dest, 'rules', 'AGENTS.md'), '# Rules\n');
    }

    // skills/<name> as symlinks to ~/.agents/skills/<name> with copy fallback
    const skillsDest = path.join(dest, 'skills');
    fs.mkdirSync(skillsDest, { recursive: true });
    const selected = computeSelectedSkills(srcDir, home);
    const fingerprint = selectedSkillFingerprint(srcDir, home, selected);
    const stagedManifest = readJson(path.join(dest, 'plugin.json'));
    if (stagedManifest) {
        stagedManifest.aosSelectedSkills = fingerprint.names;
        stagedManifest.aosSkillsHash = fingerprint.hash;
        fs.writeFileSync(path.join(dest, 'plugin.json'), JSON.stringify(stagedManifest, null, 2) + '\n');
    }
    for (const name of selected) {
        const canonical = path.join(home, '.agents', 'skills', name);
        const target = fs.existsSync(canonical) ? canonical : findSkillInSource(srcDir, name);
        if (target) {
            link(target, path.join(skillsDest, name));
        }
    }

    return 0;
}

// Retires older non-symlink bundled skills from plugin dir to backup.
// Symlinked skills created by the current plugin version are preserved.
function retirePluginSkills({ home, dryRun = false, now = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z') } = {}) {
    // agy follows staged symlinks; the installed plugin's skills are real directories.
    // They are plugin-owned content, never legacy loose copies, so leave them for atomic refresh.
    return { status: 'none' };
}

function run({ srcDir, home = os.homedir(), mode = 'on', runner = defaultRunner, log = {} } = {}) {
    const step = log.step || ((m) => console.log(`  ${m}`));
    const warn = log.warn || ((m) => console.warn(`  ${m}`));
    const result = { status: 'skipped', lines: [] };
    const say = (fn, m) => { result.lines.push(m); fn(m); };
    const fail = (what) => {
        result.status = 'failed';
        say(warn, `agy plugin: ${what}. Run manually: ${manual(srcDir).join('  &&  ')}`);
        return result;
    };
    if (mode === 'off') { say(step, 'agy plugin: skipped (AOS_PLUGIN_MIGRATION=off).'); return result; }

    try {
        const pkgJson = readJson(path.join(srcDir, 'plugin.json'));
        validateManifestShape(pkgJson);
        const want = pkgJson.version;

        const probe = runner(['plugin', 'list']);
        if (probe.error && probe.error.code === 'ENOENT') {
            say(step, `agy plugin: agy CLI not found, skipped. Once agy is installed, run: ${manual(srcDir).join('  &&  ')}`);
            return result;
        }
        if (probe.error || probe.status !== 0) return fail(`\`agy plugin list\` failed (${(probe.error && probe.error.message) || probe.stderr.trim() || `exit ${probe.status}`})`);

        let imports = [];
        try { imports = JSON.parse(probe.stdout).imports || []; } catch { /* "No imported plugins." */ }
        const cfg0 = readJson(configFile(home));
        if (cfg0 && cfg0.plugins && cfg0.plugins[PLUGIN] && cfg0.plugins[PLUGIN].enabled === false && imports.some((p) => p.name === PLUGIN)) {
            say(step, `agy plugin: ${PLUGIN} is disabled in agy; leaving it disabled (enable it with: agy plugin enable ${PLUGIN}).`);
            result.status = 'disabled';
            return result;
        }
        const installed = imports.some((p) => p.name === PLUGIN) && fs.existsSync(path.join(pluginDir(home), 'plugin.json'));
        const installedManifest = installed ? (readJson(path.join(pluginDir(home), 'plugin.json')) || {}) : {};
        const have = installed ? installedManifest.version : null;
        const fingerprint = selectedSkillFingerprint(srcDir, home);
        // An install without a recorded fingerprint has nothing to compare against: not a refresh trigger.
        const recorded = Array.isArray(installedManifest.aosSelectedSkills);
        const skillsChanged = recorded && (JSON.stringify(installedManifest.aosSelectedSkills) !== JSON.stringify(fingerprint.names) || installedManifest.aosSkillsHash !== fingerprint.hash);
        const dry = mode === 'check';
        if (!installed || have !== want || skillsChanged) {
            const what = installed ? `update ${PLUGIN} ${have || '?'} -> ${want}${skillsChanged ? ' (skills changed)' : ''}` : `install ${PLUGIN} ${want}`;
            if (dry) { say(step, `agy plugin: would ${what} (check mode, nothing changed).`); result.status = 'would-install'; return result; }
            const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-agy-'));
            try {
                stagePlugin(srcDir, stage, { home });

                // Check agy plugin validate --strict if supported by agy on PATH
                const valProbe = runner(['plugin', 'validate', '--strict', stage]);
                if (valProbe && !valProbe.error && valProbe.status !== 0) {
                    say(warn, `agy plugin validate warning: ${(valProbe.stderr || valProbe.stdout || '').trim() || `exit ${valProbe.status}`}`);
                }

                const r = runner(['plugin', 'install', stage]);
                if (r.error || r.status !== 0) return fail(`${what} failed (${(r.error && r.error.message) || (r.stderr || r.stdout).trim().split('\n').pop() || `exit ${r.status}`})`);
                say(step, `agy plugin: ${installed ? `updated ${PLUGIN} ${have || '?'} -> ${want}` : `installed ${PLUGIN} ${want}`} (commands as /${PLUGIN}:<cmd>).`);
                result.status = installed ? 'updated' : 'installed';
                fs.mkdirSync(path.dirname(stateFile(home)), { recursive: true });
                fs.writeFileSync(stateFile(home), JSON.stringify({ plugin: PLUGIN, version: want, installedAt: new Date().toISOString() }, null, 2) + '\n');
            } finally {
                fs.rmSync(stage, { recursive: true, force: true });
            }
        } else {
            say(step, `agy plugin: ${PLUGIN} ${want} already installed.`);
            result.status = 'current';
        }
    } catch (e) {
        return fail(e.message);
    }
    return result;
}

// Removes only what run() recorded.
function uninstall({ home = os.homedir(), dryRun = false, runner = defaultRunner, log = {} } = {}) {
    const step = log.step || ((m) => console.log(`  ${m}`));
    const warn = log.warn || ((m) => console.warn(`  ${m}`));
    if (!readJson(stateFile(home))) return { status: 'none' };
    if (dryRun) { step(`agy plugin: would run \`agy plugin uninstall ${PLUGIN}\`.`); return { status: 'would-uninstall' }; }
    const r = runner(['plugin', 'uninstall', PLUGIN]);
    if (r.error && r.error.code === 'ENOENT') { warn(`agy plugin: agy not found; run \`agy plugin uninstall ${PLUGIN}\` yourself.`); return { status: 'failed' }; }
    if (r.error || r.status !== 0) { warn(`agy plugin: uninstall failed; run \`agy plugin uninstall ${PLUGIN}\` yourself.`); return { status: 'failed' }; }
    fs.rmSync(stateFile(home), { force: true });
    step(`agy plugin: uninstalled ${PLUGIN}.`);
    return { status: 'uninstalled' };
}

module.exports = {
    retirePluginSkills, run, uninstall, stagePlugin, stateFile, PLUGIN, validateManifestShape, computeSelectedSkills, selectedSkillFingerprint };


if (require.main === module) {
    const dry = process.argv.includes('--dry-run');
    const r = run({ srcDir: path.join(__dirname, '..'), mode: dry ? 'check' : 'on' });
    process.exitCode = r.status === 'failed' ? 1 : 0;
}
