#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');
const https = require('https');
const { execSync, spawn } = require('child_process');
const pkgPath = path.join(__dirname, 'package.json');
let pkg = { name: '@hybridlabor-api/bdb-dev-optimized-agent-skills', version: '3.0.0' };
if (fs.existsSync(pkgPath)) {
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch (e) {}
}

const colors = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    cyan: "\x1b[36m",
    purple: "\x1b[38;2;157;78;221m",
    purpleBold: "\x1b[1;\x1b[38;2;157;78;221m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    magenta: "\x1b[35m",
    dim: "\x1b[2m"
};

const unsupportedMcpDirs = [
    'adobe_mcp',
    'davinci-mcp-professional',
    'davinci-resolve-mcp',
    'vectorworks-mcp',
    'blender-mcp-server'
];

const unsupportedMcpConfigKeys = [
    'adobe_mcp',
    'bdb_davinci_mcp_fallback',
    'bdb_davinci_mcp_studio',
    'bdb_vectorworks_mcp',
    'bdb_blender_mcp_fallback'
];

// Entries whose command needs a toolchain that is not part of a standard
// installation. The probe runs at install time; when it fails the key joins
// unsupportedMcpConfigKeys and the server is never registered.
const conditionalMcpConfigKeys = [
    { key: 'bdb_after_effects_mcp_fallback', requires: 'go', hint: 'https://go.dev/dl/' }
];

function hasExecutable(binary) {
    try {
        const lookup = process.platform === 'win32' ? `where ${binary}` : `command -v ${binary}`;
        execSync(lookup, { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
}

function resolveUnsupportedMcpConfigKeys() {
    const keys = unsupportedMcpConfigKeys.slice();
    conditionalMcpConfigKeys.forEach(entry => {
        if (hasExecutable(entry.requires)) return;
        console.log(`${colors.dim} -> Skipping MCP '${entry.key}': '${entry.requires}' was not found on PATH (${entry.hint}).${colors.reset}`);
        keys.push(entry.key);
    });
    return keys;
}

function readTextFile(filePath) {
    const buf = fs.readFileSync(filePath);
    if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return buf.toString('utf16le', 2);
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.toString('utf8', 3);
    return buf.toString('utf8');
}

// readJsonFile only reports "null" on failure. Callers that have to explain the
// failure to the user get the underlying parser message from here.
function describeJsonParseError(filePath) {
    try {
        JSON.parse(readTextFile(filePath));
        return '';
    } catch (e) {
        return e.message;
    }
}

function readJsonFile(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        return JSON.parse(readTextFile(filePath));
    } catch (e) {
        try {
            return readJsoncFile(filePath);
        } catch (e2) {
            return null;
        }
    }
}

function readJsoncFile(filePath) {
    if (!fs.existsSync(filePath)) return null;
    let raw = fs.readFileSync(filePath, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    raw = raw.replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
        .replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(raw); } catch (e) { return null; }
}

function isValidInstallDir(dir, markerFiles) {
    if (!fs.existsSync(dir)) return false;
    const leftoverTarballs = fs.readdirSync(dir).filter(f => f.endsWith('.tgz'));
    if (leftoverTarballs.length > 0) return false;
    return markerFiles.every(f => fs.existsSync(path.join(dir, f)));
}

function isNewerVersion(local, remote) {
    const lParts = local.split('.').map(Number);
    const rParts = remote.split('.').map(Number);
    for (let i = 0; i < Math.max(lParts.length, rParts.length); i++) {
        const l = lParts[i] || 0;
        const r = rParts[i] || 0;
        if (r > l) return true;
        if (l > r) return false;
    }
    return false;
}

function checkForUpdates() {
    return new Promise((resolve) => {
        const req = https.get(`https://registry.npmjs.org/${pkg.name}/latest`, { timeout: 1500 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const latest = JSON.parse(data).version;
                    if (latest && isNewerVersion(pkg.version, latest)) {
                        console.log(`${colors.yellow}${colors.bold}╭───────────────────────────────────────────────────────────╮${colors.reset}`);
                        console.log(`${colors.yellow}${colors.bold}│  💡 Update available: ${colors.dim}${pkg.version}${colors.reset}${colors.yellow}${colors.bold} ➔ ${colors.green}${latest}${colors.reset}                   │${colors.reset}`);
                        console.log(`${colors.yellow}${colors.bold}│  Run: ${colors.cyan}npx ${pkg.name}@latest${colors.reset}                       │${colors.reset}`);
                        console.log(`${colors.yellow}${colors.bold}╰───────────────────────────────────────────────────────────╯${colors.reset}\n`);
                    }
                } catch (e) {}
                resolve();
            });
        });
        req.on('error', () => resolve());
        req.on('timeout', () => { req.destroy(); resolve(); });
    });
}

function cleanNpmCacheOnWindows() {
    if (process.platform !== 'win32') return;
    try {
        console.log(`${colors.dim} -> Windows detected: cleaning npm cache before package install...${colors.reset}`);
        execSync('npm cache clean --force', { stdio: 'ignore' });
    } catch (e) {
        console.warn(` -> Warning: npm cache clean failed on Windows: ${e.message}`);
    }
}

function tailOutput(e, maxLines = 12) {
    const raw = (e && (e.stderr || e.stdout) ? e.stderr || e.stdout : '').toString().trim();
    if (!raw) return '';
    const lines = raw.split(/\r?\n/).slice(-maxLines);
    return lines.map(l => `     ${l}`).join('\n');
}

function runNpmWithRetry(cmd, opts, label, attempts = 3) {
    for (let i = 1; i <= attempts; i++) {
        try {
            execSync(cmd, { ...opts, stdio: 'pipe', maxBuffer: 16 * 1024 * 1024 });
            return true;
        } catch (e) {
            if (i === attempts) {
                const firstLine = (e.message || '').split('\n')[0];
                console.warn(`Warning: Failed to ${label}.`);
                if (firstLine) console.warn(`  └─ ${firstLine}`);
                const tail = tailOutput(e);
                if (tail) console.warn(`  └─ Last output:\n${tail}`);
                if (opts && opts.cwd) console.warn(`  └─ Re-run manually: cd "${opts.cwd}" && ${cmd}`);
                return false;
            }
            const waitMs = 1000 * i;
            console.warn(` -> ${label} failed (attempt ${i}/${attempts}), retrying in ${waitMs / 1000}s...`);
            const tail = tailOutput(e, 4);
            if (tail) console.warn(`${colors.dim}  └─ ${tail.trim()}${colors.reset}`);
            execSync(process.platform === 'win32' ? `powershell -NoProfile -Command "Start-Sleep -Seconds ${waitMs / 1000}"` : `sleep ${waitMs / 1000}`, { stdio: 'ignore' });
        }
    }
    return false;
}

function runPipWithRetry(cmd, opts, label, attempts = 2, timeoutMs = 900000) {
    for (let i = 1; i <= attempts; i++) {
        try {
            execSync(cmd, { ...opts, timeout: timeoutMs });
            return true;
        } catch (e) {
            if (i === attempts) {
                console.warn(`Warning: Failed to ${label}: ${e.message}`);
                return false;
            }
            const waitMs = 1000 * i;
            console.warn(` -> ${label} failed (attempt ${i}/${attempts}), retrying in ${waitMs / 1000}s...`);
            execSync(process.platform === 'win32' ? `powershell -NoProfile -Command "Start-Sleep -Seconds ${waitMs / 1000}"` : `sleep ${waitMs / 1000}`, { stdio: 'ignore' });
        }
    }
    return false;
}

const cols = process.stdout.columns || 110;

const headerArt = `
${colors.purple}${colors.bold}    ____  ____  ____     ___   _____________   ________   ____  _____
   / __ )/ __ \\/ __ )   /   | / ____/ ____/ | / /_  __/  / __ \\/ ___/
  / __  / / / / __  |  / /| |/ / __/ __/ /  |/ / / /    / / / /\\__ \\ 
 / /_/ / /_/ / /_/ /  / ___ / /_/ / /___/ /|  / / /    / /_/ /___/ / 
/_____/_____/_____/  /_/  |_\\____/_____/_/ |_/ /_/     \\____//____/${colors.reset}

${colors.cyan}${colors.bold}                  O P T I M I Z E D   A G E N T   S K I L L S${colors.reset}
`;

const divider = '─'.repeat(Math.max(110, cols));

console.log(headerArt);
console.log(`${colors.dim} ${divider}${colors.reset}`);
console.log(`${colors.green}${colors.bold} 🚀 Starting Installation (v${pkg.version})${colors.reset}`);
console.log(`${colors.dim} ${divider}${colors.reset}\n`);

checkForUpdates();

function askTextQuestion(query) {
    return new Promise((resolve) => {
        const rlTemp = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rlTemp.question(query, (answer) => {
            rlTemp.close();
            resolve(answer);
        });
    });
}

const homeDir = os.homedir();
const currentDir = process.cwd();
const scriptDir = __dirname;

let srcDir = scriptDir;
if (!fs.existsSync(path.join(srcDir, 'skills')) && fs.existsSync(path.join(srcDir, '..', 'skills'))) {
    srcDir = path.join(scriptDir, '..');
} else if (!fs.existsSync(path.join(srcDir, 'skills'))) {
    console.error("Error: Cannot find skills payload directory.");
    process.exit(1);
}

const geminiDir = path.join(homeDir, '.gemini');
const globalConfigDir = path.join(geminiDir, 'config', 'skills');
const globalLegacyDir = path.join(geminiDir, 'skills');
const workspaceDir = path.join(currentDir, '.agents', 'skills');

const now = new Date();
const timestamp = now.getFullYear().toString() + 
    (now.getMonth()+1).toString().padStart(2, '0') + 
    now.getDate().toString().padStart(2, '0') + "_" + 
    now.getHours().toString().padStart(2, '0') + 
    now.getMinutes().toString().padStart(2, '0') + 
    now.getSeconds().toString().padStart(2, '0');
    
const backupDir = path.join(geminiDir, `skills_backup_${timestamp}`);

// Auto-accept flags for CI/CD or autonomous agents
const isAutoYes = process.argv.includes('-y') || process.argv.includes('--yes');

// Optional subset selection for scripted runs: --mcps=memb-mcp,open-design
// --mcps=all keeps the --yes default (everything), --mcps=none installs only
// the core module. Without the flag nothing about --yes changes.
const mcpsArgRaw = process.argv.find(a => a === '--mcps' || a.startsWith('--mcps='));
const mcpsArg = (mcpsArgRaw && mcpsArgRaw.startsWith('--mcps=')) ? mcpsArgRaw.slice('--mcps='.length) : null;
if (mcpsArgRaw && mcpsArg === null) {
    console.warn(`${colors.yellow} -> Ignoring '--mcps' without a value. Use --mcps=<name,name>, --mcps=all or --mcps=none.${colors.reset}`);
}

const CORE_MCP = 'memb-mcp';

function resolveMcpsArg(availableMcps) {
    const requested = mcpsArg.split(',').map(s => s.trim()).filter(Boolean);
    const wantsNone = requested.some(r => ['none', 'core', 'core-only'].includes(r.toLowerCase()));
    const wantsAll = requested.some(r => r.toLowerCase() === 'all');

    if (wantsAll && !wantsNone) return availableMcps;

    const matched = [];
    const unknown = [];
    if (!wantsNone) {
        requested.forEach(name => {
            const hit = availableMcps.find(m => m.toLowerCase() === name.toLowerCase());
            if (hit) {
                if (!matched.includes(hit)) matched.push(hit);
            } else if (!['all', 'none', 'core', 'core-only'].includes(name.toLowerCase())) {
                unknown.push(name);
            }
        });
    }

    if (unknown.length > 0) {
        console.warn(`${colors.yellow} -> Unknown or unavailable MCP name(s) in --mcps: ${unknown.join(', ')}${colors.reset}`);
        console.warn(`${colors.dim}    Available for this tier: ${availableMcps.join(', ') || '(none)'}${colors.reset}`);
    }

    // The core module is installed unconditionally, mirroring the interactive picker.
    if (availableMcps.includes(CORE_MCP) && !matched.includes(CORE_MCP)) matched.unshift(CORE_MCP);

    console.log(` -> --mcps selection: ${matched.join(', ') || '(none)'}`);
    return matched;
}

function detectPlatforms() {
    const detections = [];
    
    // Google Antigravity
    if (fs.existsSync(geminiDir)) {
        detections.push({ name: "Google Antigravity", path: geminiDir, key: "antigravity" });
    }

    // Codex CLI / ChatGPT Codex
    const codexDir = path.join(homeDir, '.codex');
    if (fs.existsSync(codexDir) || fs.existsSync(path.join(homeDir, '.codex', 'config.toml'))) {
        detections.push({ name: "ChatGPT Codex CLI", path: codexDir, key: "codex" });
    }

    // Claude Code CLI
    const claudeCodeConfig = path.join(homeDir, '.claude.json');
    const claudeCodeDir = path.join(homeDir, '.claude');
    if (fs.existsSync(claudeCodeConfig) || fs.existsSync(claudeCodeDir)) {
        detections.push({ name: "Claude Code CLI", path: claudeCodeDir, key: "claudecode" });
    }
    
    // Claude Desktop
    const claudePath = process.platform === 'win32' 
        ? path.join(process.env.APPDATA || homeDir, 'Claude')
        : path.join(homeDir, 'Library', 'Application Support', 'Claude');
    if (fs.existsSync(claudePath)) {
        detections.push({ name: "Claude Desktop", path: claudePath, key: "claudedesktop" });
    }
    
    // Cursor IDE
    const cursorPath = process.platform === 'win32' 
        ? path.join(process.env.APPDATA || homeDir, 'Cursor')
        : path.join(homeDir, 'Library', 'Application Support', 'Cursor');
    if (fs.existsSync(cursorPath)) {
        detections.push({ name: "Cursor IDE", path: cursorPath, key: "cursor" });
    }

    // Windsurf IDE
    const windsurfPath = process.platform === 'win32' 
        ? path.join(process.env.APPDATA || homeDir, 'Windsurf')
        : path.join(homeDir, 'Library', 'Application Support', 'Windsurf');
    if (fs.existsSync(windsurfPath)) {
        detections.push({ name: "Windsurf IDE", path: windsurfPath, key: "windsurf" });
    }

    // Roo Code & Cline (VS Code Extensions)
    const vscodePath = process.platform === 'win32' 
        ? path.join(process.env.APPDATA || homeDir, 'Code')
        : path.join(homeDir, 'Library', 'Application Support', 'Code');
    const rooPath = path.join(homeDir, '.roo');
    const clinePath = path.join(homeDir, '.cline');
    if (fs.existsSync(vscodePath) || fs.existsSync(rooPath) || fs.existsSync(clinePath)) {
        detections.push({ name: "Roo Code / Cline / VS Code", path: vscodePath, key: "vscode" });
    }

    // Aider CLI
    const aiderConf = path.join(homeDir, '.aider.conf.yml');
    if (fs.existsSync(aiderConf) || fs.existsSync(path.join(homeDir, '.aider'))) {
        detections.push({ name: "Aider CLI", path: homeDir, key: "aider" });
    }

    // OpenCode CLI
    const opencodeDir = process.platform === 'win32'
        ? path.join(process.env.APPDATA || homeDir, 'opencode')
        : path.join(homeDir, '.config', 'opencode');
    if (fs.existsSync(opencodeDir) || fs.existsSync(path.join(homeDir, '.opencode'))) {
        detections.push({ name: "OpenCode CLI", path: fs.existsSync(opencodeDir) ? opencodeDir : path.join(homeDir, '.opencode'), key: "opencode" });
    }

    return detections;
}

async function promptSingleSelect(title, options, defaultIndex = 0) {
    if (isAutoYes) return options[defaultIndex].value !== undefined ? options[defaultIndex].value : options[defaultIndex];

    return new Promise((resolve) => {
        let cursor = defaultIndex;
        let drawnLines = 0;

        let selectedIndex = defaultIndex;

        const render = () => {
            if (drawnLines > 0) {
                process.stdout.write(`\x1B[${drawnLines}A\x1B[J`);
            }
            let output = `\n${colors.cyan}${colors.bold}${title}${colors.reset}\n`;
            options.forEach((opt, index) => {
                const label = opt.label || opt.name || opt;
                const isSelected = index === selectedIndex ? `${colors.green}x${colors.reset}` : ' ';
                if (index === cursor) {
                    output += `${colors.cyan}${colors.bold} > [${isSelected}] ${label}${colors.reset}\n`;
                } else {
                    output += `   [${isSelected}] ${label}\n`;
                }
            });
            output += `\n${colors.dim}Use UP/DOWN arrows to navigate, SPACE to select, ENTER to confirm.${colors.reset}\n`;

            const lines = output.split('\n');
            drawnLines = lines.length - 1;
            process.stdout.write(output);
        };

        const onKeypress = (str, key) => {
            if (!key) return;
            if (key.name === 'up' || key.name === 'k') {
                cursor = cursor > 0 ? cursor - 1 : options.length - 1;
                render();
            } else if (key.name === 'down' || key.name === 'j') {
                cursor = cursor < options.length - 1 ? cursor + 1 : 0;
                render();
            } else if (key.name === 'space') {
                selectedIndex = cursor;
                render();
            } else if (key.name === 'return' || key.name === 'enter') {
                cleanup();
                console.log("");
                resolve(options[selectedIndex].value !== undefined ? options[selectedIndex].value : options[selectedIndex]);
            } else if (key.ctrl && key.name === 'c') {
                cleanup();
                process.exit(0);
            }
        };

        const cleanup = () => {
            process.stdin.removeListener('keypress', onKeypress);
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(false);
                process.stdin.pause();
            }
        };

        if (process.stdin.isTTY) {
            readline.emitKeypressEvents(process.stdin);
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.on('keypress', onKeypress);
            render();
        } else {
            resolve(options[defaultIndex].value !== undefined ? options[defaultIndex].value : options[defaultIndex]);
        }
    });
}

async function promptMode() {
    if (isAutoYes) {
        return { tier: '1', mode: '1', platform: '1' };
    }

    const tierOptions = [
        { label: 'Pro MEDIA (Full suite of dev-optimized skills and creative MCPs - Default)', value: '1' },
        { label: 'Basic (Essential skills only, lightweight MCPs)', value: '2' }
    ];
    const tier = await promptSingleSelect('Package Tier:', tierOptions, 0);

    const detections = detectPlatforms();
    if (detections.length > 0) {
        console.log(`\n${colors.magenta}${colors.bold}Detected Agent Environments on this system:${colors.reset}`);
        detections.forEach(d => console.log(`  * ${colors.green}${d.name}${colors.reset} (detected at ${d.path})`));
    } else {
        console.log("\nNo active agent config directories auto-detected in standard locations.");
    }

    const detectedNames = detections.length > 0 ? detections.map(d => d.name).join(', ') : 'All Platforms';
    const universalLabel = detections.length > 0
        ? `(0) Universal Agent Harness – Update All Detected Environments [${detectedNames}] (Recommended)`
        : `(0) Universal Agent Harness (Sync rules & MCPs across ALL AI platforms - Recommended)`;

    const platformOptions = [
        { label: universalLabel, value: '0' },
        { label: '(1) Google Antigravity (Default Single Hub)', value: '1' },
        { label: '(2) Claude Desktop / Claude Code', value: '2' },
        { label: '(3) Cursor / Generic IDE (Project-local)', value: '3' },
        { label: '(4) Custom Installation (Specify custom paths manually)', value: '4' },
        { label: '(5) ChatGPT Codex CLI', value: '5' },
        { label: '(6) Windsurf IDE', value: '6' },
        { label: '(7) Roo Code / Cline / VS Code', value: '7' },
        { label: '(8) Aider CLI', value: '8' }
    ];
    const rawPlatform = await promptSingleSelect('Target AI Platform:', platformOptions, 0);
    let platform = rawPlatform;
    const isUniversal = rawPlatform === '0';
    if (isUniversal) platform = '1';

    const modeOptions = [
        { label: 'Merge: Keep your existing skills/MCPs and add/update BDB tools (Recommended)', value: '1' },
        { label: 'Replace: Backup and wipe your existing skills/MCPs, installing ONLY BDB tools', value: '2' }
    ];
    const mode = await promptSingleSelect('Installation Mode:', modeOptions, 0);

    if (rawPlatform === '4') {
        console.log("\n--- Custom Path Configuration ---");
        const skillDir = (await askTextQuestion(`Target directory for global skills [default: ${path.join(homeDir, '.bdb-skills')}]: `)).trim() || path.join(homeDir, '.bdb-skills');
        const legacyDir = (await askTextQuestion(`Target directory for legacy skills [default: ${path.join(skillDir, 'legacy')}]: `)).trim() || path.join(skillDir, 'legacy');
        const workDir = (await askTextQuestion(`Target directory for workspace skills [default: ${workspaceDir}]: `)).trim() || workspaceDir;
        const mcpConf = (await askTextQuestion(`Target path for MCP Config JSON file [default: ${path.join(homeDir, 'mcp_config.json')}]: `)).trim() || path.join(homeDir, 'mcp_config.json');
        return {
            tier,
            mode,
            platform,
            isUniversal,
            customPaths: {
                skillDir,
                legacyDir,
                workspaceDir: workDir,
                mcpConfigPath: mcpConf,
                mcpDir: path.dirname(mcpConf)
            }
        };
    }

    return { tier, mode, platform, isUniversal };
}

async function promptMcpSelection(mcpsDir, tier) {
    let availableMcps = [];
    try { 
        availableMcps = fs.readdirSync(mcpsDir, { withFileTypes: true })
            .filter(d => !d.name.startsWith('.') && d.name !== '__pycache__')
            .map(d => d.name); 
    } catch(e) { return []; }

    if (tier === '2') {
        const basicMcps = ['computer-use-mcp', 'memb-mcp', 'windows-computer-use-mcp'];
        availableMcps = availableMcps.filter(m => basicMcps.includes(m));
    }

    availableMcps = availableMcps.filter(m => !unsupportedMcpDirs.includes(m));

    if (mcpsArg !== null) return resolveMcpsArg(availableMcps);
    if (isAutoYes) return availableMcps;
    if (availableMcps.length === 0) return [];

    
    // Check existing mcp_config.json to pre-select already installed MCPs
    let existingInstalled = [];
    try {
        const homeDir = process.env.HOME || process.env.USERPROFILE;
        const geminiDir = path.join(homeDir, '.gemini');
        const mcpConfigPath = path.join(geminiDir, 'config', 'mcp_config.json');
        if (fs.existsSync(mcpConfigPath)) {
            const parsed = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
            const mcpStr = JSON.stringify(parsed.mcpServers || {});
            existingInstalled = availableMcps.filter(m => mcpStr.includes(m));
        }
    } catch(e) {}

    const selections = availableMcps.filter(m => m !== 'memb-mcp').map(mcp => ({ 
        name: mcp, 
        selected: existingInstalled.includes(mcp) 
    }));

    if (selections.length === 0) return ['memb-mcp'];

    return new Promise((resolve) => {
        let cursor = 0;
        let drawnLines = 0;

        const render = () => {
            if (drawnLines > 0) {
                process.stdout.write(`\x1B[${drawnLines}A\x1B[J`);
            }
            let output = `\n${colors.magenta}${colors.bold}--- Select Optional MCPs to Install ---${colors.reset}\n`;
            output += ` ${colors.green}[x] memb-mcp${colors.reset} ${colors.dim}(Core Module - Always Installed)${colors.reset}\n`;
            
            selections.forEach((mcp, index) => {
                const isSelected = mcp.selected ? `${colors.green}x${colors.reset}` : ' ';
                if (index === cursor) {
                    output += `${colors.cyan}${colors.bold} > [${isSelected}] ${mcp.name}${colors.reset}\n`;
                } else {
                    output += `   [${isSelected}] ${mcp.name}\n`;
                }
            });
            output += `\n${colors.dim}Use UP/DOWN arrows to navigate, SPACE to toggle, 'a' to select all, ENTER to confirm.${colors.reset}\n`;
            
            const lines = output.split('\n');
            drawnLines = lines.length - 1;
            process.stdout.write(output);
        };

        const onKeypress = (str, key) => {
            if (!key) return;
            if (key.name === 'up' || key.name === 'k') {
                cursor = cursor > 0 ? cursor - 1 : selections.length - 1;
                render();
            } else if (key.name === 'down' || key.name === 'j') {
                cursor = cursor < selections.length - 1 ? cursor + 1 : 0;
                render();
            } else if (key.name === 'space') {
                selections[cursor].selected = !selections[cursor].selected;
                render();
            } else if (key.name === 'a') {
                selections.forEach(s => s.selected = true);
                render();
            } else if (key.name === 'return' || key.name === 'enter') {
                cleanup();
                console.log("");
                resolve(['memb-mcp', ...selections.filter(s => s.selected).map(s => s.name)]);
            } else if (key.ctrl && key.name === 'c') {
                cleanup();
                process.exit(0);
            }
        };

        const cleanup = () => {
            process.stdin.removeListener('keypress', onKeypress);
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(false);
                process.stdin.pause();
            }
        };

        if (process.stdin.isTTY) {
            readline.emitKeypressEvents(process.stdin);
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.on('keypress', onKeypress);
            render();
        } else {
            resolve(availableMcps);
        }
    });
}

function loadExistingEnv(targetMcpDir) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const envPaths = [
        targetMcpDir ? path.join(targetMcpDir, '.env') : null,
        path.join(homeDir, '.gemini', 'config', '.env'),
        path.join(homeDir, '.agents', '.env')
    ].filter(Boolean);

    const envData = {};
    for (const ep of envPaths) {
        if (fs.existsSync(ep)) {
            try {
                const lines = fs.readFileSync(ep, 'utf8').split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                        const idx = trimmed.indexOf('=');
                        const k = trimmed.substring(0, idx).trim();
                        const v = trimmed.substring(idx + 1).trim();
                        if (k && v && !envData[k]) {
                            envData[k] = v;
                        }
                    }
                }
            } catch (e) {}
        }
    }

    for (const k of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'GROQ_API_KEY', 'XAI_API_KEY', 'NVIDIA_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY']) {
        if (process.env[k] && !envData[k]) {
            envData[k] = process.env[k];
        }
    }

    return envData;
}

function maskApiKey(key) {
    if (!key) return '';
    if (key.length <= 8) return '****';
    return key.substring(0, 4) + '...' + key.substring(key.length - 4);
}

async function promptCredentials(targetMcpDir = '') {
    if (isAutoYes) return { gemini: "", github: "", openwikiProvider: "google", openwikiModel: "", openwikiBaseUrl: "" };
    const existingEnv = loadExistingEnv(targetMcpDir);

    const existingGemini = existingEnv['GEMINI_API_KEY'] || existingEnv['GOOGLE_API_KEY'] || existingEnv['OPENWIKI_API_KEY'] || '';
    const existingGithub = existingEnv['GITHUB_PERSONAL_ACCESS_TOKEN'] || existingEnv['GITHUB_TOKEN'] || '';
    const existingProvider = existingEnv['OPENWIKI_PROVIDER'] || 'google';
    const existingModel = existingEnv['OPENWIKI_MODEL'] || '';
    const existingBaseUrl = existingEnv['OPENWIKI_BASE_URL'] || '';

    const hasKeys = Boolean(existingGemini || existingGithub);

    return new Promise((resolve) => {
        (async () => {
            if (hasKeys) {
                console.log(`\n${colors.magenta}${colors.bold}--- Integrations & Credentials ---${colors.reset}`);
                if (existingGemini) console.log(`  * GEMINI/OpenWiki Key: ${colors.green}${maskApiKey(existingGemini)}${colors.reset}`);
                if (existingGithub) console.log(`  * GitHub MCP Token:    ${colors.green}${maskApiKey(existingGithub)}${colors.reset}`);

                const reuseOptions = [
                    { label: 'Keep existing credentials & LLM provider settings (Recommended)', value: 'keep' },
                    { label: 'Re-configure API keys / LLM provider wizard', value: 'update' }
                ];

                const credAction = await promptSingleSelect('Credentials Setup:', reuseOptions, 0);
                if (credAction === 'keep') {
                    console.log(` -> Reusing existing credentials.`);
                    resolve({
                        gemini: existingGemini,
                        github: existingGithub,
                        openwikiProvider: existingProvider,
                        openwikiModel: existingModel,
                        openwikiBaseUrl: existingBaseUrl,
                        keyEnvName: 'GEMINI_API_KEY'
                    });
                    return;
                }
            } else {
                console.log(`\n${colors.magenta}${colors.bold}--- Integrations & Credentials ---${colors.reset}`);
            }

            const provOptions = [
            { label: 'Google AI Studio / Gemini – gemma-4-26b-a4b-it, gemma-4-31b-it, gemini-2.5-pro, gemini-3.5-flash', value: '1' },
            { label: 'Groq – llama-3.3-70b-versatile, llama-3.1-8b-instant', value: '2' },
            { label: 'Grok / xAI – grok-2-latest, grok-3', value: '3' },
            { label: 'NVIDIA NIM – meta/llama-3.3-70b-instruct, nvidia/llama-3.1-nemotron-70b-instruct', value: '4' },
            { label: 'OpenRouter – anthropic/claude-3.5-sonnet, openai/gpt-4o', value: '5' },
            { label: 'OpenAI – gpt-4o-mini, gpt-4o, o1', value: '6' },
            { label: 'Ollama / LM Studio – Local LLM (no API key, no cost)', value: '7' },
            { label: 'Custom OpenAI API / Base URL + API Key + Model', value: '8' }
        ];
        const choice = await promptSingleSelect('Choose OpenWiki LLM Provider:', provOptions, 0);
            let provider = "google", model = "", baseUrl = "", keyEnvName = "GEMINI_API_KEY";
            const c = choice.trim();

            if (c === "2")      { provider = "groq";       model = "llama-3.3-70b-versatile"; keyEnvName = "GROQ_API_KEY"; }
            else if (c === "3") { provider = "grok";       model = "grok-2-latest";           keyEnvName = "XAI_API_KEY"; }
            else if (c === "4") { provider = "nvidia";     model = "meta/llama-3.3-70b-instruct"; keyEnvName = "NVIDIA_API_KEY"; baseUrl = "https://integrate.api.nvidia.com/v1"; }
            else if (c === "5") { provider = "openrouter"; model = "anthropic/claude-3.5-sonnet"; keyEnvName = "OPENROUTER_API_KEY"; }
            else if (c === "6") { provider = "openai";     model = "gpt-4o-mini";            keyEnvName = "OPENAI_API_KEY"; }
            else if (c === "7") { provider = "ollama";     model = "llama3";                 baseUrl = "http://localhost:11434/v1"; }
            else if (c === "8") { provider = "custom";     keyEnvName = "OPENWIKI_API_KEY"; }

            (async () => {
                if (c === "8") {
                    const u = await askTextQuestion(`${colors.yellow}Custom Base URL [e.g. https://integrate.api.nvidia.com/v1]: ${colors.reset}`);
                    baseUrl = u.trim();
                } else if (c === "7") {
                    const u = await askTextQuestion(`${colors.yellow}Ollama Base URL [default: http://localhost:11434/v1]: ${colors.reset}`);
                    if (u.trim()) baseUrl = u.trim();
                }
                const defaultModel = model || (provider === "google"
                    ? "gemma-4-26b-a4b-it"
                    : provider === "groq"
                        ? "llama-3.3-70b-versatile"
                        : provider === "grok"
                            ? "grok-2-latest"
                            : provider === "nvidia"
                                ? "meta/llama-3.3-70b-instruct"
                                : provider === "openai"
                                    ? "gpt-4o-mini"
                                    : provider === "ollama"
                                        ? "llama3"
                                        : "gpt-4o-mini");
                const modelHint = provider === "google"
                    ? "gemma-4-26b-a4b-it | gemma-4-31b-it | gemini-2.5-pro | gemini-3.5-flash"
                    : provider === "groq"
                        ? "llama-3.3-70b-versatile | llama-3.1-8b-instant"
                        : provider === "grok"
                            ? "grok-2-latest | grok-3"
                            : provider === "nvidia"
                                ? "meta/llama-3.3-70b-instruct | nvidia/llama-3.1-nemotron-70b-instruct"
                                : provider === "openrouter"
                                    ? "anthropic/claude-3.5-sonnet | openai/gpt-4o"
                                    : provider === "openai"
                                        ? "gpt-4o-mini | gpt-4o | o1"
                                        : provider === "ollama"
                                            ? "llama3 | gemma-4-e4b:q4_k_m | qwen3-8b-instruct:q4_k_m | qwen3-coder-8b-instruct:q4_k_m | llama-3.1-8b-instruct:q4_k_m | gpt-oss-20b"
                                            : "model name";
                const m = await askTextQuestion(`${colors.yellow}Model name [default: ${defaultModel}] (${modelHint}): ${colors.reset}`);
                if (m.trim()) model = m.trim();

                let apiKey = "";
                if (provider !== "ollama") {
                    const existingKey = existingEnv[keyEnvName] || existingEnv['GEMINI_API_KEY'] || '';
                    const hintText = existingKey ? `${colors.green}(existing detected: ${maskApiKey(existingKey)}, press Enter to keep)${colors.reset}` : `${colors.dim}(leave blank to skip)${colors.reset}`;
                    const entered = await askTextQuestion(`${colors.yellow}Enter your ${keyEnvName} for OpenWiki${colors.reset} ${hintText}: `);
                    apiKey = entered.trim() || existingKey;
                }

                const existingGithub = existingEnv['GITHUB_PERSONAL_ACCESS_TOKEN'] || existingEnv['GITHUB_TOKEN'] || '';
                const ghHint = existingGithub ? `${colors.green}(existing detected: ${maskApiKey(existingGithub)}, press Enter to keep)${colors.reset}` : `${colors.dim}(leave blank to skip)${colors.reset}`;
                const enteredGithub = await askTextQuestion(`${colors.yellow}Enter your GITHUB_PERSONAL_ACCESS_TOKEN for GitHub MCP${colors.reset} ${ghHint}: `);
                const github = enteredGithub.trim() || existingGithub;

                resolve({ gemini: apiKey.trim(), github: github.trim(), openwikiProvider: provider, openwikiModel: model, openwikiBaseUrl: baseUrl, keyEnvName });
            })();
        })();
    });
}

// install_daemon.ps1 exits with this code when it could not register the
// scheduled task and installed the logon-only startup entry instead.
const DAEMON_LOGON_FALLBACK_EXIT_CODE = 10;

async function installOpenWikiDaemon(apiKey, targetSkillDir, openwikiEnv = {}) {
    const prov = openwikiEnv.provider || "google";
    if (!apiKey && !["ollama", "lmstudio"].includes(prov)) { console.log(' -> Skipping OpenWiki Daemon background installation (no API key provided).'); return; }
    console.log('\nInstalling OpenWiki Daemon...');
    
    const scriptBase = path.join(targetSkillDir, 'openwiki-skill', 'scripts');

    const daemonEnv = Object.assign({}, process.env, {
        OPENWIKI_PROVIDER:  prov,
        OPENWIKI_MODEL:     openwikiEnv.model   || '',
        OPENWIKI_BASE_URL:  openwikiEnv.baseUrl || '',
        OPENWIKI_API_KEY:   apiKey || '',
        GEMINI_API_KEY:     prov === 'google' ? apiKey : (process.env.GEMINI_API_KEY || ''),
        OPENAI_API_KEY:     prov === 'openai' ? apiKey : (process.env.OPENAI_API_KEY || ''),
        GROQ_API_KEY:       prov === 'groq'   ? apiKey : (process.env.GROQ_API_KEY   || ''),
        XAI_API_KEY:        ['grok', 'xai'].includes(prov) ? apiKey : (process.env.XAI_API_KEY || ''),
        NVIDIA_API_KEY:     prov === 'nvidia' ? apiKey : (process.env.NVIDIA_API_KEY || ''),
        OPENROUTER_API_KEY: prov === 'openrouter' ? apiKey : (process.env.OPENROUTER_API_KEY || ''),
    });

    return new Promise((resolve) => {
        let command, args;
        if (os.platform() === 'win32') {
            command = 'powershell.exe';
            args = ['-ExecutionPolicy', 'Bypass', '-File', path.join(scriptBase, 'install_daemon.ps1')];
        } else {
            command = 'sh';
            const scriptPath = path.join(scriptBase, 'install_daemon.sh');
            args = [scriptPath];
            try { fs.chmodSync(scriptPath, '755'); } catch (e) {}
        }
        const child = spawn(command, args, { stdio: 'inherit', env: daemonEnv });
        child.on('close', (code) => {
            const usedLogonFallback = code === DAEMON_LOGON_FALLBACK_EXIT_CODE;
            if (code === 0 || usedLogonFallback) {
                if (usedLogonFallback) {
                    console.log(`${colors.yellow} -> OpenWiki Daemon installed via the logon-only fallback - no periodic schedule.${colors.reset}`);
                    console.log(`${colors.yellow}    Documentation is refreshed once per logon instead of every 2 hours; see the reason above.${colors.reset}`);
                } else {
                    console.log(' -> OpenWiki Daemon installed successfully (scheduled every 2 hours).');
                }
                console.log(' -> Auto-starting OpenWiki Daemon for the first run...');
                try {
                    const pythonCmd = os.platform() === 'win32' ? 'python' : 'python3';
                    const daemonPath = path.join(scriptBase, 'openwiki_daemon.py');
                    const daemonProcess = spawn(pythonCmd, [daemonPath, '--one-shot'], { 
                        detached: true,
                        stdio: 'ignore',
                        env: daemonEnv
                    });
                    daemonProcess.unref();
                    console.log(' -> Daemon auto-started successfully.');
                } catch(e) {
                    console.warn(` -> Could not auto-start daemon: ${e.message}`);
                }
            }
            else console.warn(` -> OpenWiki Daemon background install was skipped or failed (exit code ${code}).\n -> See the output above. The daemon can still be run manually:\n -> python3 "${path.join(scriptBase, 'openwiki_daemon.py')}" --one-shot`);
            resolve();
        });
        child.on('error', (err) => { console.error(' -> Failed to start OpenWiki Daemon script:', err); resolve(); });
    });
}

async function installTokenSaver(platformTarget) {
    const tokenSaverDir = path.join(srcDir, 'vendor', 'token-saver');
    if (!fs.existsSync(tokenSaverDir)) {
        return;
    }
    console.log(`\n${colors.magenta}${colors.bold}--- Installing Heimdall Token Saver Context Optimizer ---${colors.reset}`);
    
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

    try {
        let targetFlag = '--target all';

        console.log(` -> Running Heimdall Token Saver setup (${targetFlag})...`);
        execSync(`${pythonCmd} install.py ${targetFlag}`, {
            cwd: tokenSaverDir,
            stdio: 'inherit',
            env: Object.assign({}, process.env, { PYTHONUTF8: '1' })
        });
        console.log(` -> Heimdall Token Saver successfully registered.`);
    } catch (err) {
        console.warn(` -> Warning: Heimdall Token Saver installation skipped or failed: ${err.message}`);
    }
}

function moveIfExists(src, dest, label) {
    if (fs.existsSync(src)) {
        fs.renameSync(src, dest);
        console.log(` -> Backed up ${label}.`);
    }
}

function copyDirRecursiveSync(source, target, excludeList = []) {
    if (!fs.existsSync(source)) return;
    const sourceStat = fs.lstatSync(source);
    if (sourceStat.isFile()) {
        const targetDir = path.dirname(target);
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        fs.copyFileSync(source, target);
        return;
    }
    
    if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });

    const files = fs.readdirSync(source);
    files.forEach(file => {
        if (excludeList.includes(file)) return;
        const curSource = path.join(source, file);
        const curTarget = path.join(target, file);
        try {
            const stat = fs.lstatSync(curSource);
            if (stat.isSymbolicLink()) {
                try {
                    const linkTarget = fs.readlinkSync(curSource);
                    if (fs.existsSync(curSource)) {
                        if (fs.existsSync(curTarget)) fs.unlinkSync(curTarget);
                        fs.symlinkSync(linkTarget, curTarget);
                    } else {
                        console.warn(`Warning: Skipping broken symlink ${curSource}`);
                    }
                } catch (e) {
                    console.warn(`Warning: Could not copy symlink ${curSource}: ${e.message}`);
                }
            } else if (stat.isDirectory()) {
                copyDirRecursiveSync(curSource, curTarget);
            } else {
                fs.copyFileSync(curSource, curTarget);
            }
        } catch (e) {
            console.warn(`Warning: Failed to copy ${curSource} -> ${curTarget}: ${e.message}`);
        }
    });
}

function syncSkillsToGlobalHarnesses(srcDir, excludeSkills = []) {
    const skillsBase = path.join(srcDir, 'skills');
    if (!fs.existsSync(skillsBase)) return;

    const extraSkillDestinations = [
        path.join(homeDir, '.claude', 'skills'),
        path.join(homeDir, '.agents', 'skills'),
        path.join(homeDir, '.codex', 'skills'),
        path.join(homeDir, '.cursor', 'skills'),
        path.join(homeDir, '.roo', 'skills')
    ];

    for (const dest of extraSkillDestinations) {
        try {
            fs.mkdirSync(dest, { recursive: true });
            const dirs = fs.readdirSync(skillsBase);
            for (const dir of dirs) {
                if (dir === 'global_legacy' || dir === 'workspace_agents') continue;
                const fullPath = path.join(skillsBase, dir);
                if (!fs.statSync(fullPath).isDirectory()) continue;
                copyDirRecursiveSync(fullPath, dest, excludeSkills);
            }
            console.log(` -> Synced BDB skills to ${dest}`);
        } catch (e) {
            console.log(` -> Note: Could not sync skills to ${dest}: ${e.message}`);
        }
    }
}

// The installation runs inside two nested async IIFEs. A throw inside them is an
// unhandled rejection, and Node ends the process on it -- which took down the
// universal sync and the final report as well. Every optional file system step
// therefore goes through installStep(): the step is reported as skipped and the
// run continues. `hint` says what the user loses by the skipped step.
function installStep(what, fn, hint) {
    try {
        return { ok: true, value: fn() };
    } catch (e) {
        console.warn(`${colors.yellow} -> Could not ${what}: ${e.message}${colors.reset}`);
        if (hint) console.warn(`${colors.yellow}    ${hint}${colors.reset}`);
        return { ok: false, error: e };
    }
}

// Last net for everything installStep() does not cover (a throw from a prompt,
// from execSync, from a helper). Prints the reason instead of letting Node die
// with a bare "UnhandledPromiseRejection".
function reportFatal(stage, e) {
    console.error(`\n${colors.red}${colors.bold}The installer stopped during ${stage}.${colors.reset}`);
    console.error(`${colors.red}Reason: ${(e && e.stack) || e}${colors.reset}`);
    console.error(`${colors.red}Nothing was rolled back; re-running the installer is safe.${colors.reset}`);
    process.exitCode = 1;
}

(async () => {
    const { tier, mode, platform, isUniversal, customPaths } = await promptMode();
    installStep(
        `create the backup directory ${backupDir}`,
        () => fs.mkdirSync(backupDir, { recursive: true }),
        'The installation continues, but existing files are not backed up.'
    );

    let targetSkillDir = globalConfigDir;
    let targetLegacyDir = globalLegacyDir;
    let targetWorkspaceDir = workspaceDir;
    let targetMcpDir = path.join(geminiDir, 'config');
    let mcpConfigPath = path.join(targetMcpDir, 'mcp_config.json');
    
    if (platform === '2') {
        // Claude Desktop / Claude Code
        console.log("\n[Platform: Claude Desktop / Claude Code] Adapting installation paths...");
        targetSkillDir = path.join(homeDir, '.claude', 'skills');
        targetLegacyDir = path.join(homeDir, '.claude', 'skills', 'legacy');
        
        let claudeAppSupport = process.platform === 'win32' 
            ? path.join(process.env.APPDATA || homeDir, 'Claude')
            : path.join(homeDir, 'Library', 'Application Support', 'Claude');
            
        targetMcpDir = claudeAppSupport;
        mcpConfigPath = path.join(claudeAppSupport, 'claude_desktop_config.json');
    } else if (platform === '3') {
        // Cursor / Generic
        console.log("\n[Platform: Cursor / Generic IDE] Adapting installation paths...");
        targetSkillDir = path.join(currentDir, '.cursor', 'bdb-skills');
        targetLegacyDir = path.join(currentDir, '.cursor', 'bdb-skills', 'legacy');
        targetWorkspaceDir = path.join(currentDir, '.cursor', 'workspace_skills');
        targetMcpDir = path.join(currentDir, '.cursor');
        mcpConfigPath = path.join(targetMcpDir, 'mcp.json');
    } else if (platform === '5') {
        // Codex
        console.log("\n[Platform: ChatGPT Codex CLI] Adapting installation paths...");
        targetSkillDir = path.join(homeDir, '.codex', 'skills');
        targetLegacyDir = path.join(homeDir, '.codex', 'skills', 'legacy');
        targetMcpDir = path.join(homeDir, '.codex');
        mcpConfigPath = path.join(targetMcpDir, 'config.toml');
    } else if (platform === '6') {
        // Windsurf
        console.log("\n[Platform: Windsurf IDE] Adapting installation paths...");
        targetSkillDir = path.join(homeDir, '.windsurf', 'bdb-skills');
        targetLegacyDir = path.join(homeDir, '.windsurf', 'bdb-skills', 'legacy');
        targetMcpDir = path.join(homeDir, '.windsurf');
        mcpConfigPath = path.join(targetMcpDir, 'mcp.json');
    } else if (platform === '7') {
        // Roo / Cline / VS Code
        console.log("\n[Platform: Roo Code / Cline] Adapting installation paths...");
        targetSkillDir = path.join(homeDir, '.roo', 'bdb-skills');
        targetLegacyDir = path.join(homeDir, '.roo', 'bdb-skills', 'legacy');
        targetMcpDir = path.join(homeDir, '.roo');
        mcpConfigPath = path.join(targetMcpDir, 'mcp.json');
    } else if (platform === '8') {
        // Aider
        console.log("\n[Platform: Aider CLI] Adapting installation paths...");
        targetSkillDir = path.join(homeDir, '.aider', 'bdb-skills');
        targetLegacyDir = path.join(homeDir, '.aider', 'bdb-skills', 'legacy');
        targetMcpDir = path.join(homeDir, '.aider');
        mcpConfigPath = path.join(targetMcpDir, 'mcp.json');
    } else if (platform === '4' && customPaths) {
        // Custom paths
        console.log("\n[Platform: Custom Path] Applying custom paths...");
        targetSkillDir = customPaths.skillDir;
        targetLegacyDir = customPaths.legacyDir;
        targetWorkspaceDir = customPaths.workspaceDir;
        targetMcpDir = customPaths.mcpDir;
        mcpConfigPath = customPaths.mcpConfigPath;
    }

    if (mode === '2') {
        console.log(`\n[Replace Mode] Creating backup of current skills in ${backupDir}...`);
        moveIfExists(targetSkillDir, path.join(backupDir, 'config_skills_backup'), 'global config skills');
        moveIfExists(targetLegacyDir, path.join(backupDir, 'legacy_skills_backup'), 'global legacy skills');
        moveIfExists(targetWorkspaceDir, path.join(backupDir, 'workspace_skills_backup'), 'workspace skills');
    } else {
        console.log(`\n[Merge Mode] Installing over existing directories. Existing skills will not be deleted.`);
    }

    const excludeSkills = tier === '2' ? [
        'bdb-adobe-suite-mcp.md',
        'bdb-after-effects-mcp.md',
        'bdb-blender-mcp.md',
        'bdb-davinci-mcp.md',
        'bdb-grandma3-mcp.md',
        'bdb-resolume-mcp.md',
        'bdb-rhino-mcp.md',
        'bdb-touchdesigner-mcp.md',
        'bdb-unreal-mcp.md',
        'bdb-vectorworks-mcp.md',
        'bdbmediastorm'
    ] : [];

    console.log(`\nInstalling optimized skills (140 curated skills)${tier === '2' ? ' [Basic Tier]' : ''}...`);
    installStep('create the skill target directories', () => {
        fs.mkdirSync(targetSkillDir, { recursive: true });
        fs.mkdirSync(targetLegacyDir, { recursive: true });
        fs.mkdirSync(targetWorkspaceDir, { recursive: true });
    }, 'The skill copy below will most likely be skipped as well.');

    // Copy all subfolders in skills/ to their respective destinations
    const skillsBase = path.join(srcDir, 'skills');
    if (fs.existsSync(skillsBase)) {
        installStep('install the skills', () => {
            const dirs = fs.readdirSync(skillsBase);
            for (const dir of dirs) {
                const fullPath = path.join(skillsBase, dir);
                if (!fs.statSync(fullPath).isDirectory()) continue;

                if (dir === 'global_legacy') {
                    copyDirRecursiveSync(fullPath, targetLegacyDir, excludeSkills);
                    console.log(" -> Installed global legacy skills.");
                } else if (dir === 'workspace_agents') {
                    copyDirRecursiveSync(fullPath, targetWorkspaceDir, excludeSkills);
                    console.log(" -> Installed workspace skills.");
                } else {
                    // Copy all other skill folders (global_config, basic, bdbmediastorm, etc.) into targetSkillDir
                    copyDirRecursiveSync(fullPath, targetSkillDir, excludeSkills);
                }
            }
            console.log(" -> Installed all global config & core skills.");
        }, 'The skills are missing or incomplete; the rest of the installation continues.');
    }

    // Sync all BDB skills across Claude Code, Codex, Cursor, Roo, and ~/.agents/
    syncSkillsToGlobalHarnesses(srcDir, excludeSkills);

    console.log("\nInstalling Godmode/Harness configurations to local workspace & global environment...");
    const harnessDirs = ['.agents', '.cursor/rules', '.claude', '.github', '.codex-plugin'];
    harnessDirs.forEach(dir => {
        const sourcePath = path.join(srcDir, dir);
        if (fs.existsSync(sourcePath)) {
            const targetPath = path.join(currentDir, dir);
            installStep(`copy ${dir} to ${targetPath}`, () => {
                copyDirRecursiveSync(sourcePath, targetPath);
                console.log(` -> Copied ${dir} to ${targetPath}`);
            }, 'The remaining harness directories are still copied.');
        }
    });

    // Global ~/.agents/ sync
    const globalAgentsDir = path.join(os.homedir(), '.agents');
    const agentsDirSrc = path.join(srcDir, '.agents');
    if (fs.existsSync(agentsDirSrc)) {
        installStep(`sync global .agents/ to ${globalAgentsDir}`, () => {
            copyDirRecursiveSync(agentsDirSrc, globalAgentsDir);
            console.log(` -> Synced global .agents/ (agents.md, workflows/startcycle.md) to ${globalAgentsDir}`);
        }, 'agents.md and workflows/startcycle.md are missing there.');
    }

    // Roo Code / Custom Modes sync (.roomodes)
    const agentsMdSrc = path.join(srcDir, '.agents', 'agents.md');
    if (fs.existsSync(agentsMdSrc)) {
        const rooModesPath = path.join(currentDir, '.roomodes');
        const rooModesData = {
            customModes: [
                {
                    slug: "planner-orchestrator",
                    name: "Planner Orchestrator",
                    roleDefinition: "Lead System Planner & Task Decomposer. Analyzes prompts, /bdbrainstorm, and orchestrates /startcycle.",
                    groups: ["read", "browser", "command"]
                },
                {
                    slug: "godmode-ui-ux",
                    name: "Godmode UI/UX",
                    roleDefinition: "Lead Frontend Designer & UI Engineer. Anti-Slop, DTCG design tokens, fluid motion, React/Tailwind.",
                    groups: ["read", "edit", "browser", "command"]
                },
                {
                    slug: "godmode-engineering",
                    name: "Godmode Engineering",
                    roleDefinition: "Senior Fullstack & Backend Engineer. DDD, Clean Architecture, TDD, TypeScript/Python.",
                    groups: ["read", "edit", "browser", "command"]
                },
                {
                    slug: "godmode-eventtech",
                    name: "Godmode EventTech",
                    roleDefinition: "Architectural Authority for Real-Time Performance, Signal Flow, and Hardware Limits in live environments. TouchDesigner, grandMA3, Resolume.",
                    groups: ["read", "edit", "mcp", "command"]
                },
                {
                    slug: "godmode-media-creation",
                    name: "Godmode Media Creation",
                    roleDefinition: "AI Video Production & Pipeline Orchestrator. Master of OpenMontage and Palmier Pro MCPs.",
                    groups: ["read", "edit", "mcp", "command"]
                },
                {
                    slug: "godmode-3d-creation",
                    name: "Godmode 3D Creation",
                    roleDefinition: "AI 3D Generation & Asset Architect. Master of TRELLIS, TripoSR, and Text-to-CAD MCPs.",
                    groups: ["read", "edit", "mcp", "command"]
                },
                {
                    slug: "godmode-shipping",
                    name: "Godmode Shipping",
                    roleDefinition: "Release Gatekeeper & Quality Auditor. Webapp testing, WCAG, SEO, release validation.",
                    groups: ["read", "command"]
                }
            ]
        };
        installStep(`write ${rooModesPath}`, () => {
            fs.writeFileSync(rooModesPath, JSON.stringify(rooModesData, null, 2));
            console.log(` -> Synced Roo Code custom modes to ${rooModesPath}`);
        }, 'Roo Code keeps its existing custom modes.');
    }

    const geminiMdSrc = path.join(srcDir, 'GEMINI.md');
    if (fs.existsSync(geminiMdSrc)) {
        // 1. Antigravity Global config
        installStep(`install GEMINI.md to ${path.join(geminiDir, 'GEMINI.md')}`, () => {
            fs.copyFileSync(geminiMdSrc, path.join(geminiDir, 'GEMINI.md'));
            console.log(` -> Installed GEMINI.md to ${path.join(geminiDir, 'GEMINI.md')}`);
        }, 'The harness injection below still runs.');

        // 2. Universal Harness Injection
        // Reading the sources is the precondition for every injection below, so a
        // failure here skips them all instead of injecting an empty rule set.
        const startcycleWorkflowSrc = path.join(srcDir, '.agents', 'workflows', 'startcycle.md');
        const sources = installStep('read the global rule sources', () => ({
            globalRules: fs.readFileSync(geminiMdSrc, 'utf8'),
            startcycleContent: fs.existsSync(startcycleWorkflowSrc) ? fs.readFileSync(startcycleWorkflowSrc, 'utf8') : '',
            agentsMdContent: fs.existsSync(agentsMdSrc) ? fs.readFileSync(agentsMdSrc, 'utf8') : ''
        }), 'Cursor, Claude, Copilot and Codex keep their current instruction files.');

        if (sources.ok) {
            const { globalRules, startcycleContent, agentsMdContent } = sources.value;

            // Cursor Rules
            const cursorRulesDir = path.join(currentDir, '.cursor', 'rules');
            installStep(`write the Cursor rules to ${cursorRulesDir}`, () => {
                fs.mkdirSync(cursorRulesDir, { recursive: true });
                const cursorRulePath = path.join(cursorRulesDir, '000_global_rules.mdc');
                fs.writeFileSync(cursorRulePath, `---\nname: global-rules\ndescription: Global BDB Agent Rules\n---\n\n${globalRules}`);
                if (startcycleContent) {
                    fs.writeFileSync(path.join(cursorRulesDir, 'startcycle.mdc'), `---\nname: startcycle\ndescription: Autonomous Multi-Agent Development Pipeline (/startcycle)\n---\n\n${startcycleContent}`);
                }
                if (agentsMdContent) {
                    fs.writeFileSync(path.join(cursorRulesDir, 'bdb_agents.mdc'), `---\nname: bdb-agents\ndescription: BDB Multi-Agent Team Specifications\n---\n\n${agentsMdContent}`);
                }
                console.log(` -> Injected Cursor Rules (global_rules, startcycle, bdb_agents) to ${cursorRulesDir}`);
            }, 'Cursor keeps its existing rules.');

            // Claude Code
            const claudeMdPath = path.join(currentDir, 'CLAUDE.md');
            installStep(`sync ${claudeMdPath}`, () => {
                let claudeContent = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, 'utf8') : '';
                if (!claudeContent.includes("Global Agent Instructions")) {
                    claudeContent = `${claudeContent}\n\n${globalRules}`.trim();
                }
                if (startcycleContent && !claudeContent.includes("Autonomous Development Cycle Workflow")) {
                    claudeContent = `${claudeContent}\n\n---\n\n${startcycleContent}`.trim();
                }
                fs.writeFileSync(claudeMdPath, claudeContent);
                console.log(` -> Synced CLAUDE.md with Global Rules and /startcycle workflow`);
            }, 'CLAUDE.md is unchanged.');

            // GitHub Copilot
            const copilotPath = path.join(currentDir, '.github', 'copilot-instructions.md');
            if (fs.existsSync(path.dirname(copilotPath))) {
                installStep(`inject the global rules into ${copilotPath}`, () => {
                    const copilotContent = fs.existsSync(copilotPath) ? fs.readFileSync(copilotPath, 'utf8') : '';
                    if (!copilotContent.includes("Global Agent Instructions")) {
                        fs.appendFileSync(copilotPath, `\n\n${globalRules}`);
                        console.log(` -> Injected Global Rules to ${copilotPath}`);
                    }
                }, 'copilot-instructions.md is unchanged.');
            }

            // Codex Plugin
            const codexDir = path.join(currentDir, '.codex-plugin');
            installStep(`sync ${path.join(codexDir, 'system.md')}`, () => {
                fs.mkdirSync(codexDir, { recursive: true });
                const codexPath = path.join(codexDir, 'system.md');
                let codexContent = fs.existsSync(codexPath) ? fs.readFileSync(codexPath, 'utf8') : '';
                if (!codexContent.includes("Global Agent Instructions")) {
                    codexContent = `${codexContent}\n\n${globalRules}`.trim();
                }
                if (startcycleContent && !codexContent.includes("Autonomous Development Cycle Workflow")) {
                    codexContent = `${codexContent}\n\n---\n\n${startcycleContent}`.trim();
                }
                fs.writeFileSync(codexPath, codexContent);
                console.log(` -> Synced .codex-plugin/system.md with Global Rules and /startcycle workflow`);
            }, '.codex-plugin/system.md is unchanged.');
        }
    }

    (async () => {
        const mcpSrcDir = path.join(srcDir, 'mcps');
        const mcpCodeTarget = path.join(targetMcpDir, 'mcps');
        const selectedMcps = await promptMcpSelection(mcpSrcDir, tier);
        let creds = {};
        
        if (selectedMcps.length > 0) {
            installStep(`create ${targetMcpDir}`, () => {
                fs.mkdirSync(targetMcpDir, { recursive: true });
                if (!fs.existsSync(mcpCodeTarget)) fs.mkdirSync(mcpCodeTarget, { recursive: true });
            }, 'The MCP steps below will most likely fail as well and are reported individually.');

            console.log(`\nInstalling ${selectedMcps.length} selected MCPs...`);
            selectedMcps.forEach(mcp => {
                installStep(`copy the MCP server ${mcp}`, () => {
                    copyDirRecursiveSync(path.join(mcpSrcDir, mcp), path.join(mcpCodeTarget, mcp));
                }, 'The remaining MCP servers are still installed.');
            });
            console.log(` -> Installed selected MCP servers to ${mcpCodeTarget}`);

            
            const nodeMcps = ['adobe_uxp_mcp', 'unreal_mcp', 'tdmcp', 'touchdesigner-mcp', 'davinci-resolve-mcp', 'after-effects-mcp', 'computer-use-mcp'];
            nodeMcps.filter(m => selectedMcps.includes(m)).forEach(mcpFolder => {
                const targetFolder = path.join(mcpCodeTarget, mcpFolder);
                if (fs.existsSync(path.join(targetFolder, 'package.json'))) {
                    console.log(` -> Setting up Node dependencies for ${mcpFolder}...`);
                    const ok = runNpmWithRetry('npm install --no-audit --no-fund', { cwd: targetFolder, stdio: 'ignore' }, `npm install for ${mcpFolder}`);
                    if (ok && (fs.existsSync(path.join(targetFolder, 'tsconfig.json')) || fs.existsSync(path.join(targetFolder, 'tsconfig.build.json')))) {
                        console.log(` -> Compiling TypeScript for ${mcpFolder}...`);
                        runNpmWithRetry('npm run build', { cwd: targetFolder, stdio: 'ignore' }, `npm run build for ${mcpFolder}`);
                    }
                }
            });

            if (selectedMcps.includes('davinci-resolve-mcp')) {
                const davinciFolder = path.join(mcpCodeTarget, 'davinci-resolve-mcp');
                if (fs.existsSync(davinciFolder)) {
                    console.log(` -> Bootstrapping Python virtual environment for DaVinci Resolve MCP Studio...`);
                    try {
                        execSync('node bin/davinci-resolve-mcp.mjs setup --clients manual', { cwd: davinciFolder, stdio: 'ignore' });
                    } catch (e) {
                        console.warn(`Warning: Failed to setup DaVinci Python env: ${e.message}`);
                    }
                }
            }

            if (selectedMcps.includes('memb-mcp')) {
                const membMcpFolder = path.join(mcpCodeTarget, 'memb-mcp');
                if (fs.existsSync(membMcpFolder)) {
                    console.log(` -> Bootstrapping Python virtual environment for memB MCP...`);
                    try {
                        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
                        try {
                            execSync(`uv venv --seed .venv`, { cwd: membMcpFolder, stdio: 'ignore' });
                        } catch (e1) {
                            execSync(`${pythonCmd} -m venv .venv`, { cwd: membMcpFolder, stdio: 'ignore' });
                        }
                        const venvPython = process.platform === 'win32'
                            ? path.join(membMcpFolder, '.venv', 'Scripts', 'python.exe')
                            : path.join(membMcpFolder, '.venv', 'bin', 'python');
                        const pipViaPython = `"${venvPython}" -m pip`;
                        console.log(` -> Installing Python dependencies for memB MCP...`);
                        runPipWithRetry(`${pipViaPython} install --upgrade setuptools --timeout 30 --no-input`, { cwd: membMcpFolder, stdio: 'ignore' }, 'pip setuptools upgrade for memB MCP', 2, 120000);
                        runPipWithRetry(`${pipViaPython} install -r requirements.txt --timeout 30 --no-input`, { cwd: membMcpFolder, stdio: 'inherit' }, 'pip install for memB MCP', 2, 900000);
                        console.log(` -> memB MCP setup completed successfully.`);
                    } catch (e) { console.warn(`Warning: Failed to set up Python virtual environment for memB: ${e.message}`); }
                }
            }

            const pythonMcps = [
                { folder: 'golem-rhino-mcp', cmd: 'uv run -m mcp_server --help' },
                { folder: 'davinci-mcp-professional', cmd: 'uv run main.py --help' },
                { folder: 'davinci-resolve-mcp-free', cmd: 'uv run -r requirements.txt src/resolve_mcp_bridge.py --help' },
                { folder: 'blender-mcp', cmd: 'uv run -m blender_mcp.server --help' },
                { folder: 'blender-mcp-server', cmd: 'uv run -m blender_mcp_server --help' },
                { folder: 'vectorworks-mcp', cmd: 'uv run -r requirements.txt app/mcp_server.py --help' },
                { folder: 'windows-computer-use-mcp', cmd: 'uv run run_server.py --help' }
            ];
            pythonMcps.filter(m => selectedMcps.includes(m.folder)).forEach(mcp => {
                const targetFolder = path.join(mcpCodeTarget, mcp.folder);
                if (fs.existsSync(targetFolder)) {
                    console.log(` -> Pre-warming Python dependencies for ${mcp.folder}...`);
                    try { execSync(mcp.cmd, { cwd: targetFolder, stdio: 'ignore' }); } catch (e) {}
                }
            });

            // The backup runs before every branch below, so an unprotected throw here
            // (a directory in place of the config file -> EISDIR, an unreadable file
            // -> EACCES) killed the run one line ahead of the merge region that was
            // hardened for exactly that case. A missing backup costs the safety copy,
            // not the installation.
            if (fs.existsSync(mcpConfigPath)) {
                installStep(`back up ${path.basename(mcpConfigPath)}`, () => {
                    fs.copyFileSync(mcpConfigPath, path.join(backupDir, 'mcp_config_backup.json'));
                    console.log(` -> Backed up existing ${path.basename(mcpConfigPath)}`);
                }, 'The installation continues without a backup copy of this file.');
            }

            // Our own template. Without it there is nothing to write, so the config
            // branches below are skipped -- but the credential prompt, the .env, the
            // OpenWiki daemon, the universal sync and the final report still run.
            const mcpTemplatePath = path.join(srcDir, 'mcp_config.json');
            const mcpTemplate = installStep(
                `read the MCP template ${mcpTemplatePath}`,
                () => fs.readFileSync(mcpTemplatePath, 'utf8'),
                'No MCP config is generated; the existing config stays untouched.'
            );
            let mcpConfigStr = mcpTemplate.ok ? mcpTemplate.value : '';
            const skippedMcpConfigKeys = resolveUnsupportedMcpConfigKeys();
            try {
                const parsedMcpConfig = JSON.parse(mcpConfigStr);
                const finalMcpServers = {};
                const availableFolders = fs.readdirSync(mcpSrcDir);
                for (const [key, val] of Object.entries(parsedMcpConfig.mcpServers)) {
                    let keep = !skippedMcpConfigKeys.includes(key);
                    for (const available of availableFolders) {
                        if (!selectedMcps.includes(available) && JSON.stringify(val).includes(available)) {
                            keep = false;
                            break;
                        }
                    }
                    if (keep) finalMcpServers[key] = val;
                }
                parsedMcpConfig.mcpServers = finalMcpServers;
                mcpConfigStr = JSON.stringify(parsedMcpConfig, null, 2);
            } catch(e) {}

            const jsonEscapePath = (p) => String(p).replace(/\\/g, '\\\\');
            mcpConfigStr = mcpConfigStr.replace(/__MCPS_DIR__/g, () => jsonEscapePath(mcpCodeTarget));
            mcpConfigStr = mcpConfigStr.replace(/\{\{HOME\}\}/g, () => jsonEscapePath(homeDir));

            let uvPath = 'uv';
            try {
                const whichCmd = process.platform === 'win32' ? 'where uv' : 'which uv';
                uvPath = execSync(whichCmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split(/\r?\n/)[0];
            } catch(e) {
                if (fs.existsSync(path.join(homeDir, '.local', 'bin', 'uv'))) uvPath = path.join(homeDir, '.local', 'bin', 'uv');
                else if (fs.existsSync(path.join(homeDir, '.cargo', 'bin', 'uv'))) uvPath = path.join(homeDir, '.cargo', 'bin', 'uv');
            }
            mcpConfigStr = mcpConfigStr.replace(/"command":\s*"uv"/g, `"command": "${uvPath.replace(/\\/g, '/')}"`);

            creds = await promptCredentials(targetMcpDir);

            if (selectedMcps.includes('memb-mcp')) {
                const pythonBinPath = process.platform === 'win32'
                    ? path.join(mcpCodeTarget, 'memb-mcp', '.venv', 'Scripts', 'python.exe')
                    : path.join(mcpCodeTarget, 'memb-mcp', '.venv', 'bin', 'python');
                // Both placeholders sit inside JSON string literals, and both are
                // substituted through a replacer function: in a replacement *string*
                // String.replace() reads $&, $1, $` as backreferences, so a key like
                // "AIza$&injected" used to inject the placeholder back into itself.
                // The value additionally goes through JSON.stringify(...).slice(1, -1),
                // i.e. exactly the JSON escaping the GitHub token gets below, so a
                // quote or a backslash in it cannot break the surrounding JSON.
                const pythonBinValue = pythonBinPath.split('\\').join('/');
                const geminiKeyValue = creds.gemini || process.env.GEMINI_API_KEY || '';
                mcpConfigStr = mcpConfigStr.replace(/__PYTHON_BIN__/g, () => JSON.stringify(pythonBinValue).slice(1, -1));
                mcpConfigStr = mcpConfigStr.replace(/__GEMINI_API_KEY__/g, () => JSON.stringify(geminiKeyValue).slice(1, -1));
            }

            // @modelcontextprotocol/server-github reads the token from its own process
            // environment, so the .env we write next to the config never reaches it.
            // Injected after parsing (not via placeholder) because JSON.stringify escapes
            // the token for us. With an empty token nothing is written here at all:
            // an empty env value would authenticate worse than no env value at all.
            // That alone does not protect a token the user configured themselves --
            // the merge below replaces whole server entries, so it is the env carry-
            // over there that keeps an existing github.env.GITHUB_PERSONAL_ACCESS_TOKEN.
            const githubToken = (creds.github || process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '').trim();
            if (githubToken) {
                try {
                    const tokenizedConfig = JSON.parse(mcpConfigStr);
                    if (tokenizedConfig.mcpServers && tokenizedConfig.mcpServers.github) {
                        tokenizedConfig.mcpServers.github.env = Object.assign(
                            {},
                            tokenizedConfig.mcpServers.github.env,
                            { GITHUB_PERSONAL_ACCESS_TOKEN: githubToken }
                        );
                        mcpConfigStr = JSON.stringify(tokenizedConfig, null, 2);
                        console.log(` -> Passed the GitHub token to the github MCP server entry.`);
                    }
                } catch (e) {
                    console.warn(`${colors.yellow} -> Warning: could not attach the GitHub token to the github MCP entry: ${e.message}${colors.reset}`);
                }
            }


            // Only consulted on the merge path -- replace mode overwrites the file and
            // never has to read it. readTextFile() throws for a directory (EISDIR) and
            // for an unreadable file (EACCES), and the async IIFE around this code has
            // neither try/catch nor .catch(), so an escaping error became an unhandled
            // rejection that killed the process before the universal sync and the final
            // report could run.
            const existingConfigIsEmpty = () => {
                try {
                    return readTextFile(mcpConfigPath).trim().length === 0;
                } catch (e) {
                    return false;
                }
            };

            const configName = path.basename(mcpConfigPath);
            const isTomlConfig = mcpConfigPath.toLowerCase().endsWith('.toml');

            if (!mcpTemplate.ok) {
                // Nothing to write: writing the empty fallback would wipe the servers
                // the user already has in there.
                console.warn(`${colors.yellow} -> No MCP config was written: the template could not be read.${colors.reset}`);
                console.warn(`${colors.yellow}    ${configName} was left untouched.${colors.reset}`);
            } else if (isTomlConfig) {
                // Codex keeps its MCP servers in config.toml. This installer only
                // produces JSON and has no TOML parser available, so the file is
                // neither read as JSON nor written: overwriting it with JSON destroyed
                // the whole Codex configuration, and running it through the JSON error
                // path produced a fresh .corrupt_<timestamp>.bak plus a .bdb-new.json
                // on every single run while reporting "is not valid JSON" about a file
                // that was never meant to be JSON. The servers are written next to it
                // as a ready-to-paste TOML snippet under a fixed name, so a re-run
                // overwrites that one file instead of piling up more.
                const snippetPath = `${mcpConfigPath}.bdb-mcp-servers.toml`;
                const tomlKey = (k) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k));
                // JSON.stringify emits only escapes that are valid in a TOML basic
                // string as well (\", \\, \b, \f, \n, \r, \t, \uXXXX) and never \/.
                const tomlValue = (v) => {
                    if (Array.isArray(v)) return `[${v.map(tomlValue).join(', ')}]`;
                    if (v && typeof v === 'object') {
                        const pairs = Object.entries(v).map(([k, x]) => `${tomlKey(k)} = ${tomlValue(x)}`);
                        return `{ ${pairs.join(', ')} }`;
                    }
                    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
                    return JSON.stringify(String(v));
                };
                try {
                    const servers = JSON.parse(mcpConfigStr).mcpServers || {};
                    const tables = Object.entries(servers).map(([name, cfg]) => {
                        const rows = [`[mcp_servers.${tomlKey(name)}]`];
                        Object.entries(cfg || {}).forEach(([k, v]) => rows.push(`${tomlKey(k)} = ${tomlValue(v)}`));
                        return rows.join('\n');
                    });
                    const snippet = [
                        '# BDB MCP servers for Codex, generated by installer.js.',
                        `# Append these tables to ${configName}; if you ran the installer`,
                        '# before, replace the [mcp_servers.*] tables of the same name',
                        '# instead of adding them a second time.',
                        '',
                        tables.join('\n\n'),
                        ''
                    ].join('\n');
                    fs.writeFileSync(snippetPath, snippet);
                    console.warn(`\n${colors.yellow}${colors.bold} -> ${configName} is TOML; this installer cannot write TOML.${colors.reset}`);
                    console.warn(`${colors.yellow}    ${configName} was left untouched - nothing overwritten, no backup copies.${colors.reset}`);
                    console.warn(`${colors.yellow}    MCP servers as a TOML snippet: ${snippetPath}${colors.reset}`);
                    console.warn(`${colors.yellow}    Next step: append that snippet to ${configName} (replacing same-named`);
                    console.warn(`    [mcp_servers.*] tables from an earlier run) and restart Codex.${colors.reset}\n`);
                } catch (e) {
                    console.warn(`${colors.yellow} -> Could not write the Codex TOML snippet: ${e.message}${colors.reset}`);
                    console.warn(`${colors.yellow}    ${configName} was left untouched.${colors.reset}`);
                }
            } else if (mode === '1' && fs.existsSync(mcpConfigPath) && !existingConfigIsEmpty()) {
                const oldConfig = readJsonFile(mcpConfigPath);
                if (!oldConfig) {
                    // Merge mode promises to keep what is already there. Overwriting an
                    // unreadable file would silently drop every non-BDB server entry, so
                    // the original is left alone and the user gets a copy plus the reason.
                    const parseError = describeJsonParseError(mcpConfigPath) || 'file could not be decoded as JSON';
                    const backupCopy = `${mcpConfigPath}.corrupt_${timestamp}.bak`;
                    const sideCarPath = `${mcpConfigPath}.bdb-new.json`;
                    let backupWritten = true;
                    try {
                        fs.copyFileSync(mcpConfigPath, backupCopy);
                    } catch (copyError) {
                        backupWritten = false;
                        console.warn(`${colors.yellow} -> Could not create the backup copy: ${copyError.message}${colors.reset}`);
                    }
                    try {
                        fs.writeFileSync(sideCarPath, mcpConfigStr);
                    } catch (writeError) {
                        console.warn(`${colors.yellow} -> Could not write ${path.basename(sideCarPath)}: ${writeError.message}${colors.reset}`);
                    }
                    console.warn(`\n${colors.yellow}${colors.bold} -> ${configName} is not valid JSON - merge skipped, nothing was overwritten.${colors.reset}`);
                    console.warn(`${colors.yellow}    Reason: ${parseError}${colors.reset}`);
                    if (backupWritten) console.warn(`${colors.yellow}    Backup copy:  ${backupCopy}${colors.reset}`);
                    console.warn(`${colors.yellow}    BDB config:   ${sideCarPath}${colors.reset}`);
                    console.warn(`${colors.yellow}    Next step: repair ${configName} (or replace it with the BDB config above,`);
                    console.warn(`    copying your own server entries back in) and re-run this installer.${colors.reset}\n`);
                } else {
                    try {
                        if (oldConfig.mcpServers) {
                            // Only the statically unsupported keys are pruned from
                            // the *existing* config. The conditional keys in
                            // skippedMcpConfigKeys are left out of what we write (see
                            // the filter above), but deleting them here as well would
                            // remove an entry the user configured themselves - an own
                            // bdb_after_effects_mcp_fallback with an absolute Go path
                            // would disappear the moment `where go` fails.
                            unsupportedMcpConfigKeys.forEach(key => delete oldConfig.mcpServers[key]);
                        }
                        const newConfig = JSON.parse(mcpConfigStr);
                        const oldServers = oldConfig.mcpServers || {};
                        const newServers = newConfig.mcpServers || {};
                        // Object.assign replaces a server entry as a whole. Where our
                        // entry brings no env of its own, an env the user configured on
                        // the existing entry (their own GITHUB_PERSONAL_ACCESS_TOKEN,
                        // for instance) is carried over first so the merge cannot drop
                        // it. An env we do bring still wins.
                        Object.keys(newServers).forEach(key => {
                            const previous = oldServers[key];
                            const incoming = newServers[key];
                            if (!previous || typeof previous !== 'object') return;
                            if (!incoming || typeof incoming !== 'object') return;
                            if (!incoming.env && previous.env) incoming.env = previous.env;
                        });
                        oldConfig.mcpServers = Object.assign({}, oldServers, newServers);
                        fs.writeFileSync(mcpConfigPath, JSON.stringify(oldConfig, null, 2));
                        console.log(` -> Merged BDB MCPs into existing ${configName}`);
                    } catch (e) {
                        console.warn(`${colors.yellow} -> Could not merge into ${configName}: ${e.message}${colors.reset}`);
                        console.warn(`${colors.yellow}    ${configName} was left unchanged; the backup from this run is in ${backupDir}.${colors.reset}`);
                    }
                }
            } else {
                // Same reason as the read above: this runs inside an async IIFE with
                // no catch, so a failing write (EISDIR, EACCES, read-only volume)
                // would end the run as an unhandled rejection instead of a message.
                try {
                    if ((platform === '2' || platform === '4') && !fs.existsSync(mcpConfigPath)) {
                        const wrapper = { mcpServers: JSON.parse(mcpConfigStr).mcpServers };
                        fs.writeFileSync(mcpConfigPath, JSON.stringify(wrapper, null, 2));
                    } else {
                        fs.writeFileSync(mcpConfigPath, mcpConfigStr);
                    }
                    console.log(` -> Installed optimized MCP config to ${targetMcpDir}`);
                } catch (e) {
                    console.warn(`${colors.yellow} -> Could not write ${configName}: ${e.message}${colors.reset}`);
                    console.warn(`${colors.yellow}    The MCP servers were NOT registered; fix the path and re-run the installer.${colors.reset}`);
                }
            }
        } else {
            console.log(" -> Skipping MCP installation.");
        }

        if (creds.gemini || creds.github || creds.keyEnvName) {
            const envPath = path.join(targetMcpDir, '.env');
            let envContent = '';
            // An unreadable .env (EACCES, or a directory under that name -> EISDIR)
            // must not end the run. Starting from empty would silently drop foreign
            // entries on the write below, so the write is skipped in that case too.
            let envReadable = true;
            if (fs.existsSync(envPath)) {
                const existingEnv = installStep(
                    `read ${envPath}`,
                    () => fs.readFileSync(envPath, 'utf8'),
                    'The credentials are not written; entries already in the file stay as they are.'
                );
                if (existingEnv.ok) envContent = existingEnv.value + '\n';
                else envReadable = false;
            }

            const updateOrAppend = (key, val) => {
                if (!val) return;
                const lineRegex = new RegExp(`^${key}=.*$`, 'm');
                if (lineRegex.test(envContent)) {
                    envContent = envContent.replace(lineRegex, `${key}=${val}`);
                } else {
                    envContent += `${key}=${val}\n`;
                }
            };

            if (creds.gemini) updateOrAppend('GEMINI_API_KEY', creds.gemini);
            if (creds.github) updateOrAppend('GITHUB_PERSONAL_ACCESS_TOKEN', creds.github);
            if (creds.keyEnvName && creds.gemini) updateOrAppend(creds.keyEnvName, creds.gemini);

            if (envReadable && envContent.trim().length > 0) {
                installStep(`save the credentials to ${envPath}`, () => {
                    fs.writeFileSync(envPath, envContent.trim() + '\n');
                    console.log(` -> Saved credentials to ${envPath}`);
                }, 'Set GEMINI_API_KEY / GITHUB_PERSONAL_ACCESS_TOKEN yourself, or fix the path and re-run the installer.');
            }
        }

async function promptMemBIngestion(mcpCodeTarget) {
    if (isAutoYes) return;
    
    console.log(`\n${colors.cyan}${colors.bold}🧠 memB Deep Memory Ingestion${colors.reset}`);
    const doIngest = await promptSingleSelect('Would you like to scan & ingest a project directory into memB memory?', [{label:'Yes', value:true}, {label:'No, skip it', value:false}], 1);

    if (!doIngest) return;

    const answerDir = await askTextQuestion(`${colors.yellow}Enter project directory path to scan [default: current workspace]: ${colors.reset}`);
    const targetDir = answerDir.trim() || process.cwd();

    const includeTranscripts = await promptSingleSelect('Include past conversation logs/transcripts?', [{label:'Yes', value:true}, {label:'No', value:false}], 1);

    const pythonBin = process.platform === 'win32'
        ? path.join(mcpCodeTarget, 'memb-mcp', '.venv', 'Scripts', 'python.exe')
        : path.join(mcpCodeTarget, 'memb-mcp', '.venv', 'bin', 'python');
        
    const ingestScript = path.join(mcpCodeTarget, 'memb-mcp', 'memb_ingest.py');

    if (fs.existsSync(ingestScript) && fs.existsSync(pythonBin)) {
        console.log(` -> Running memB deep ingestion on: ${targetDir}...`);
        try {
            
            const cmd = `"${pythonBin}" "${ingestScript}" "${targetDir}"${includeTranscripts ? ' --transcripts' : ''}`;
            execSync(cmd, { stdio: 'inherit' });
        } catch (e) {
            console.log(` -> Failed to run ingestion script: ${e.message}`);
        }
    } else {
        console.log(` -> Ingestion script or python environment not found.`);
    }
}

async function promptCreatorExtension(mcpConfigPath) {
    if (isAutoYes) return;
    
    console.log(`\n${colors.magenta}${colors.bold}🎬 BDB Creator Extension (Generative 3D, Video & ComfyUI)${colors.reset}`);
    const doInstall = await promptSingleSelect("Install 'BDB Creator Extension' (3D, Video & ComfyUI MCP Engines)?", [{label:'Yes', value:true}, {label:'No, skip it', value:false}], 1);

    if (!doInstall) return;

    // Use user's home directory config path for stability if running via npx, or alongside current dir
    const basePath = __dirname.includes('_npx') ? path.join(os.homedir(), '.agents') : path.dirname(srcDir);
    const creatorDir = path.join(basePath, 'bdb-dev-creator-extension');
    const installerScript = path.join(creatorDir, 'installer.js');

    if (!isValidInstallDir(creatorDir, ['installer.js', 'package.json'])) {
        console.log(` -> BDB Creator Extension wird über NPM nach ${creatorDir} geladen...`);
        try {
            fs.mkdirSync(creatorDir, { recursive: true });
            const ok = runNpmWithRetry(`npm pack @hybridlabor-api/bdb-dev-creator-extension`, { stdio: 'ignore', cwd: creatorDir }, 'creator extension download');
            cleanNpmCacheOnWindows();
            const tarball = ok ? fs.readdirSync(creatorDir).find(f => f.endsWith('.tgz')) : null;
            if (tarball) {
                execSync(`tar -xzf "${tarball}" --strip-components=1`, { stdio: 'ignore', cwd: creatorDir });
                fs.unlinkSync(path.join(creatorDir, tarball));
                console.log(` -> Erfolgreich heruntergeladen!`);
            } else {
                throw new Error("NPM pack lieferte kein Archiv.");
            }
        } catch (e) {
            console.log(` -> Fehler beim Herunterladen der Creator Extension: ${e.message}`);
            return;
        }
    }

    if (fs.existsSync(installerScript)) {
        console.log(` -> Starte Setup der BDB Creator Extension...`);
        try {
            execSync(`node "${installerScript}" --auto`, { stdio: 'inherit', cwd: creatorDir });
        } catch (e) {
            console.log(` -> Hinweis beim Ausführen des Creator Extension Setups: ${e.message}`);
        }
    }
}

async function promptSynapse() {
    console.log(`\n${colors.cyan}${colors.bold}\xF0\x9F\xA7\xA0 BDB Synapse (3D Codebase Visualizer)${colors.reset}`);
    if (!isAutoYes) {
        const doInstall = await promptSingleSelect("Install 'BDB Synapse' (Lightweight 3D Workspace Engine)?", [{label:'Yes', value:true}, {label:'No, skip it', value:false}], 0);
        if (!doInstall) return;
    }

    const basePath = __dirname.includes('_npx') ? path.join(os.homedir(), '.agents') : path.dirname(srcDir);
    const synapseDir = path.join(basePath, 'bdb-synapse');

    const isWin = process.platform === 'win32';
    const binaryName = isWin ? 'synapse.exe' : 'synapse';
    const hasBinary = fs.existsSync(path.join(synapseDir, 'bin', binaryName)) ||
                      fs.existsSync(path.join(synapseDir, 'bin', 'synapse')) ||
                      fs.existsSync(path.join(synapseDir, 'bin', 'synapse.exe'));

    if (!isValidInstallDir(synapseDir, ['package.json']) || !hasBinary) {
        console.log(` -> BDB Synapse wird über NPM nach ${synapseDir} geladen...`);
        try {
            if (fs.existsSync(synapseDir) && !hasBinary) {
                try { fs.rmSync(synapseDir, { recursive: true, force: true }); } catch (e) {}
            }
            fs.mkdirSync(synapseDir, { recursive: true });
            const ok = runNpmWithRetry(`npm pack @hybridlabor-api/bdb-synapse@latest`, { stdio: 'ignore', cwd: synapseDir }, 'synapse download');
            cleanNpmCacheOnWindows();
            const tarball = ok ? fs.readdirSync(synapseDir).find(f => f.endsWith('.tgz')) : null;
            if (tarball) {
                execSync(`tar -xzf "${tarball}" --strip-components=1`, { stdio: 'ignore', cwd: synapseDir });
                fs.unlinkSync(path.join(synapseDir, tarball));
                console.log(` -> Erfolgreich heruntergeladen!`);
            } else {
                throw new Error("NPM pack lieferte kein Archiv.");
            }
        } catch (e) {
            console.log(` -> Fehler beim Herunterladen von Synapse: ${e.message}`);
            return;
        }
    } else {
        console.log(` -> BDB Synapse existiert bereits unter ${synapseDir}.`);
    }

    let binaryPath = path.join(synapseDir, 'bin', binaryName);
    if (!fs.existsSync(binaryPath)) {
        if (process.platform === 'darwin' && fs.existsSync(path.join(synapseDir, 'bin', 'synapse-darwin-arm64'))) {
            binaryPath = path.join(synapseDir, 'bin', 'synapse-darwin-arm64');
        } else if (process.platform === 'linux' && fs.existsSync(path.join(synapseDir, 'bin', 'synapse-linux-amd64'))) {
            binaryPath = path.join(synapseDir, 'bin', 'synapse-linux-amd64');
        }
    }

    if (fs.existsSync(binaryPath)) {
        if (!isWin) {
            try { fs.chmodSync(binaryPath, 0o755); } catch (e) {}
        }
        const localBin = path.join(os.homedir(), '.local', 'bin');
        if (!isWin && fs.existsSync(localBin)) {
            const symlinkPath = path.join(localBin, 'synapse');
            try { fs.unlinkSync(symlinkPath); } catch (e) {}
            try {
                fs.symlinkSync(binaryPath, symlinkPath);
                console.log(` -> ✅ Synapse Binary verlinkt nach ~/.local/bin/synapse`);
            } catch (e) {
                console.log(` -> ✅ Synapse Binary verfügbar unter ${binaryPath}`);
            }
        } else {
            console.log(` -> ✅ Synapse Binary verfügbar unter ${binaryPath}`);
        }
    } else {
        console.log(` -> Hinweis: Kein Pre-built Binary für diese Plattform. Kompiliere mit: cd "${synapseDir}" && go build -o ${binaryName} ./cmd/synapse/`);
    }
}

async function promptOSAgentWorkspace() {
    if (isAutoYes) return;
    
    console.log(`\n${colors.magenta}${colors.bold}🧠 BDB OS Agent Workspace (AI Orchestrator)${colors.reset}`);
    const doInstall = await promptSingleSelect("Install 'BDB OS Agent Workspace' (Orchestration Layer)?", [{label:'Yes', value:true}, {label:'No, skip it', value:false}], 1);

    if (!doInstall) return;

    const basePath = __dirname.includes('_npx') ? path.join(os.homedir(), '.agents') : path.dirname(srcDir);
    const osAgentDir = path.join(basePath, 'bdb-os-agent-workspace');

    if (!isValidInstallDir(osAgentDir, ['package.json'])) {
        console.log(` -> BDB OS Agent Workspace wird über NPM nach ${osAgentDir} geladen...`);
        try {
            fs.mkdirSync(osAgentDir, { recursive: true });
            const ok = runNpmWithRetry(`npm pack @hybridlabor-api/bdb-os-agent-workspace`, { stdio: 'ignore', cwd: osAgentDir }, 'OS agent workspace download');
            cleanNpmCacheOnWindows();
            const tarball = ok ? fs.readdirSync(osAgentDir).find(f => f.endsWith('.tgz')) : null;
            if (tarball) {
                execSync(`tar -xzf "${tarball}" --strip-components=1`, { stdio: 'ignore', cwd: osAgentDir });
                fs.unlinkSync(path.join(osAgentDir, tarball));
                console.log(` -> Erfolgreich heruntergeladen! (CD in ${osAgentDir} für die OS-Steuerung)`);
            } else {
                throw new Error("NPM pack lieferte kein Archiv.");
            }
        } catch (e) {
            console.log(` -> Fehler beim Herunterladen des OS Agent Workspaces: ${e.message}`);
        }
    } else {
        console.log(` -> BDB OS Agent Workspace existiert bereits unter ${osAgentDir}.`);
    }
}

        await installOpenWikiDaemon(creds.gemini, targetSkillDir, { provider: creds.openwikiProvider, model: creds.openwikiModel, baseUrl: creds.openwikiBaseUrl });
        await installTokenSaver(platform);
        await promptCreatorExtension(mcpConfigPath);
        await promptSynapse();
        await promptOSAgentWorkspace();
        await promptMemBIngestion(mcpCodeTarget);
        
        if (isUniversal) {
            console.log(`\n${colors.magenta}${colors.bold}🌐 Universal Agent Harness Sync...${colors.reset}`);
            const detections = detectPlatforms();
            let masterMcpData = {};
            try { masterMcpData = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8')); } catch(e) {}
            
            const syncMcpConfig = (targetPath) => {
                try {
                    let data = { mcpServers: {} };
                    const existing = readJsonFile(targetPath);
                    if (existing) {
                        data = existing;
                        if (!data.mcpServers) data.mcpServers = {};
                    }
                    if (masterMcpData.mcpServers) {
                        for (const [key, val] of Object.entries(masterMcpData.mcpServers)) {
                            data.mcpServers[key] = val;
                        }
                    }
                    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                    fs.writeFileSync(targetPath, JSON.stringify(data, null, 2));
                } catch(e) {
                    console.log(`    Failed to sync MCP to ${targetPath}: ${e.message}`);
                }
            };

            const syncOpencodeConfig = (targetPath) => {
                try {
                    const existing = readJsoncFile(targetPath);
                    const data = existing && existing.mcp ? existing : Object.assign({}, existing || {}, { mcp: {} });
                    if (masterMcpData.mcpServers) {
                        for (const [key, val] of Object.entries(masterMcpData.mcpServers)) {
                            const cmd = Array.isArray(val.command) ? val.command : [val.command];
                            const args = Array.isArray(val.args) ? val.args : [];
                            data.mcp[key] = {
                                type: "local",
                                command: [...cmd, ...args],
                                enabled: true,
                                ...(val.environment || val.env ? { environment: val.environment || val.env } : {})
                            };
                        }
                    }
                    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                    fs.writeFileSync(targetPath, JSON.stringify(data, null, 2));
                } catch(e) {
                    console.log(`    Failed to sync MCP to ${targetPath}: ${e.message}`);
                }
            };

            for (const d of detections) {
                console.log(` -> Injecting MCP engines into ${d.name}...`);
                if (d.key === 'claudedesktop') {
                    syncMcpConfig(path.join(d.path, 'claude_desktop_config.json'));
                } else if (d.key === 'claudecode') {
                    syncMcpConfig(path.join(homeDir, '.claude.json'));
                } else if (d.key === 'cursor') {
                    syncMcpConfig(path.join(homeDir, '.cursor', 'mcp.json'));
                    syncMcpConfig(path.join(d.path, 'User', 'globalStorage', 'mcp.json'));
                    syncMcpConfig(path.join(d.path, 'User', 'mcp.json'));
                    syncMcpConfig(path.join(d.path, 'mcp.json'));
                    syncMcpConfig(path.join(currentDir, '.cursor', 'mcp.json'));
                } else if (d.key === 'vscode') {
                    // VS Code User settings MCP
                    syncMcpConfig(path.join(d.path, 'User', 'mcp.json'));
                    syncMcpConfig(path.join(d.path, 'mcp.json'));
                    // Roo Code global settings
                    syncMcpConfig(path.join(homeDir, '.roo', 'mcp_settings.json'));
                    syncMcpConfig(path.join(d.path, 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json'));
                    // Cline global settings
                    syncMcpConfig(path.join(homeDir, '.cline', 'mcp_settings.json'));
                    syncMcpConfig(path.join(d.path, 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'));
                } else if (d.key === 'windsurf') {
                    syncMcpConfig(path.join(homeDir, '.windsurf', 'mcp.json'));
                    syncMcpConfig(path.join(d.path, 'User', 'mcp.json'));
                    syncMcpConfig(path.join(d.path, 'mcp.json'));
                } else if (d.key === 'aider') {
                    syncMcpConfig(path.join(homeDir, '.aider', 'mcp.json'));
                } else if (d.key === 'opencode') {
                    syncOpencodeConfig(path.join(d.path, 'opencode.jsonc'));
                }
            }
            console.log(` -> Universal Sync Complete!`);
        }
        
        console.log(`\n${colors.green}${colors.bold}=========================================================${colors.reset}`);
        console.log(`${colors.green}${colors.bold} 🎉 Installation complete! The environment now has the ${colors.reset}`);
        console.log(`${colors.green}${colors.bold}    optimized skill configuration.${colors.reset}`);
        console.log(`${colors.green}${colors.bold}=========================================================${colors.reset}`);

    })().catch(e => reportFatal('the MCP and extension installation', e));
})().catch(e => reportFatal('the skill installation', e));
