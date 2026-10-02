'use strict';
// Best-effort install of the bdb-aos plugin into Antigravity (agy) through its own CLI.
//
// Measured with agy 1.2.14: `agy plugin install <dir>` takes a local directory only (no GitHub
// owner/repo, no plugin@marketplace without a registered marketplace), copies it to
// ~/.gemini/config/plugins/<name> (symlinks are followed, so the copy is real files), and records the
// enabled flag in ~/.gemini/config/config.json. agy ignores the manifest's "skills" array and counts
// only the first level under skills/, so the nested skills/<category>/<name> layout yields 9 skills
// instead of 261. The installer therefore stages a flat plugin dir (skills/<name>) per run.
// Config entries alone never install anything, so every step goes through the CLI.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PLUGIN = 'bdb-aos';
const stateFile = (home) => path.join(home, '.agents', '.bdb-agy-plugin.json');
const pluginDir = (home) => path.join(home, '.gemini', 'config', 'plugins', PLUGIN);
const configFile = (home) => path.join(home, '.gemini', 'config', 'config.json');

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

function defaultRunner(args) {
    const r = spawnSync('agy', args, { encoding: 'utf8', timeout: 180000, shell: process.platform === 'win32' });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}

const manual = (srcDir) => [
    `node ${path.join(srcDir, 'lib', 'agy-plugin-install.js')}`,
    `agy plugin enable ${PLUGIN}`,
];

// Flat, symlink-light plugin dir: agy copies it with symlinks resolved.
function stagePlugin(srcDir, dest) {
    const link = (from, to) => {
        try { fs.symlinkSync(from, to, 'junction'); } catch { fs.cpSync(from, to, { recursive: true, dereference: true }); }
    };
    fs.copyFileSync(path.join(srcDir, 'plugin.json'), path.join(dest, 'plugin.json'));
    for (const d of ['commands', 'agy-commands']) {
        if (fs.existsSync(path.join(srcDir, d))) link(path.join(srcDir, d), path.join(dest, d));
    }
    fs.cpSync(path.join(srcDir, '.claude', 'agents'), path.join(dest, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(dest, 'skills'));
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory() || e.isSymbolicLink()) {
                if (fs.existsSync(path.join(full, 'SKILL.md'))) link(full, path.join(dest, 'skills', e.name));
                else if (e.isDirectory()) walk(full);
            }
        }
    };
    walk(path.join(srcDir, 'skills'));
    return fs.readdirSync(path.join(dest, 'skills')).length;
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
        const want = (readJson(path.join(srcDir, 'plugin.json')) || {}).version;
        if (!want) return fail('plugin.json with a version not found in the AOS package');

        const probe = runner(['plugin', 'list']);
        if (probe.error && probe.error.code === 'ENOENT') {
            say(step, `agy plugin: agy CLI not found, skipped. Once agy is installed, run: ${manual(srcDir).join('  &&  ')}`);
            return result;
        }
        if (probe.error || probe.status !== 0) return fail(`\`agy plugin list\` failed (${(probe.error && probe.error.message) || probe.stderr.trim() || `exit ${probe.status}`})`);

        let imports = [];
        try { imports = JSON.parse(probe.stdout).imports || []; } catch { /* "No imported plugins." */ }
        const installed = imports.some((p) => p.name === PLUGIN) && fs.existsSync(path.join(pluginDir(home), 'plugin.json'));
        const have = installed ? (readJson(path.join(pluginDir(home), 'plugin.json')) || {}).version : null;
        const dry = mode === 'check';

        if (!installed || have !== want) {
            const what = installed ? `update ${PLUGIN} ${have || '?'} -> ${want}` : `install ${PLUGIN} ${want}`;
            if (dry) { say(step, `agy plugin: would ${what} (check mode, nothing changed).`); result.status = 'would-install'; return result; }
            const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-agy-'));
            try {
                const n = stagePlugin(srcDir, stage);
                const r = runner(['plugin', 'install', stage]);
                if (r.error || r.status !== 0) return fail(`${what} failed (${(r.error && r.error.message) || (r.stderr || r.stdout).trim().split('\n').pop() || `exit ${r.status}`})`);
                say(step, `agy plugin: ${installed ? `updated ${PLUGIN} ${have || '?'} -> ${want}` : `installed ${PLUGIN} ${want}`} (${n} skills, commands as /${PLUGIN}:<cmd>).`);
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

        const cfg = readJson(configFile(home));
        if (cfg && cfg.plugins && cfg.plugins[PLUGIN] && cfg.plugins[PLUGIN].enabled === false) {
            if (dry) { say(step, 'agy plugin: would enable bdb-aos (check mode, nothing changed).'); return result; }
            const r = runner(['plugin', 'enable', PLUGIN]);
            if (r.error || r.status !== 0) return fail('enable failed');
            say(step, 'agy plugin: enabled bdb-aos.');
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

module.exports = { run, uninstall, stagePlugin, stateFile, PLUGIN };

if (require.main === module) {
    const dry = process.argv.includes('--dry-run');
    const r = run({ srcDir: path.join(__dirname, '..'), mode: dry ? 'check' : 'on' });
    process.exitCode = r.status === 'failed' ? 1 : 0;
}
