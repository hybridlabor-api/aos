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
    magenta: "\x1b[35m",
    dim: "\x1b[2m"
};

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

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

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

    return detections;
}

function promptMode(callback) {
    if (isAutoYes) {
        return callback({ tier: '1', mode: '1', platform: '1' });
    }

    const askTier = (next) => {
        console.log("\nPackage Tier:");
        console.log(" (1) Pro MEDIA (Full suite of dev-optimized skills and creative MCPs - Default)");
        console.log(" (2) Basic (Essential skills only, lightweight MCPs)");
        rl.question("\nSelect tier [1/2, default: 1]: ", (tierAns) => {
            const tier = tierAns.trim() === '2' ? '2' : '1';
            next(tier);
        });
    };

    askTier((tier) => {
        const detections = detectPlatforms();
        if (detections.length > 0) {
            console.log("\nDetected Agent Environments on this system:");
            detections.forEach(d => console.log("  * " + d.name + " (detected at " + d.path + ")"));
        } else {
            console.log("\nNo active agent config directories auto-detected in standard locations.");
        }

        console.log("\nTarget AI Platform:");
        console.log(" (0) Universal Agent Harness (Inject rules & MCPs into ALL detected platforms - Recommended)");
        console.log(" (1) Google Antigravity (Default Single)");
        console.log(" (2) Claude Desktop / Claude Code");
        console.log(" (3) Cursor / Generic IDE (Project-local)");
        console.log(" (4) Custom Installation (Specify custom paths manually)");
        console.log(" (5) ChatGPT Codex CLI");
        console.log(" (6) Windsurf IDE");
        console.log(" (7) Roo Code / Cline / VS Code");
        console.log(" (8) Aider CLI");
        
        rl.question("\nSelect platform [0-8, default: 0]: ", (platformAns) => {
            let platform = platformAns.trim() || '0';
            const isUniversal = platform === '0';
            if (isUniversal) platform = '1'; // Default to Antigravity as the Master Hub
            
            console.log("\nInstallation Mode:");
            console.log(" (1) Merge: Keep your existing skills/MCPs and add/update BDB tools.");
            console.log(" (2) Replace: Backup and wipe your existing skills/MCPs, installing ONLY BDB tools.");
            rl.question("\nSelect mode [1/2]: ", (modeAns) => {
                const mode = modeAns.trim() === '2' ? '2' : '1';
                
                if (platform === '4') {
                    // Prompt for custom paths
                    console.log("\n--- Custom Path Configuration ---");
                    rl.question("Target directory for global skills [default: " + path.join(homeDir, '.bdb-skills') + "]: ", (skillDir) => {
                        const customSkillDir = skillDir.trim() || path.join(homeDir, '.bdb-skills');
                        rl.question("Target directory for legacy skills [default: " + path.join(customSkillDir, 'legacy') + "]: ", (legacyDir) => {
                            const customLegacyDir = legacyDir.trim() || path.join(customSkillDir, 'legacy');
                            rl.question("Target directory for workspace skills [default: " + workspaceDir + "]: ", (workDir) => {
                                const customWorkspaceDir = workDir.trim() || workspaceDir;
                                rl.question("Target path for MCP Config JSON file [default: " + path.join(homeDir, 'mcp_config.json') + "]: ", (mcpConf) => {
                                    const customMcpConfigPath = mcpConf.trim() || path.join(homeDir, 'mcp_config.json');
                                    callback({
                                        tier,
                                        mode,
                                        platform,
                                        isUniversal,
                                        customPaths: {
                                            skillDir: customSkillDir,
                                            legacyDir: customLegacyDir,
                                            workspaceDir: customWorkspaceDir,
                                            mcpConfigPath: customMcpConfigPath,
                                            mcpDir: path.dirname(customMcpConfigPath)
                                        }
                                    });
                                });
                            });
                        });
                    });
                } else {
                    callback({ tier, mode, platform, isUniversal });
                }
            });
        });
    });
}

async function promptMcpSelection(mcpsDir, tier) {
    let availableMcps = [];
    try { 
        availableMcps = fs.readdirSync(mcpsDir, { withFileTypes: true })
            .filter(d => !d.name.startsWith('.') && d.name !== '__pycache__')
            .map(d => d.name); 
    } catch(e) { return []; }

    if (tier === '2') {
        const basicMcps = ['computer-use-mcp', 'memb-mcp', 'windows-computer-use-mcp', 'bdb-remoteos-mcp'];
        availableMcps = availableMcps.filter(m => basicMcps.includes(m));
    }

    if (isAutoYes) return availableMcps;
    if (availableMcps.length === 0) return [];

    const selections = availableMcps.filter(m => m !== 'memb-mcp').map(mcp => ({ name: mcp, selected: false }));
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

        const onKeypress = (chunk, key) => {
            if (!key) return;
            if (key.name === 'up') {
                cursor = cursor > 0 ? cursor - 1 : selections.length - 1;
                render();
            } else if (key.name === 'down') {
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
            if (process.stdin.isTTY) process.stdin.setRawMode(false);
            rl.resume();
        };

        if (process.stdin.isTTY) {
            rl.pause();
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

async function promptCredentials() {
    if (isAutoYes) return { gemini: "", github: "", openwikiProvider: "google", openwikiModel: "", openwikiBaseUrl: "" };
    return new Promise((resolve) => {
        console.log(`\n${colors.magenta}${colors.bold}--- Integrations & Credentials ---${colors.reset}`);

        // Step 1: LLM Provider for OpenWiki
        console.log(`\n${colors.cyan}${colors.bold}OpenWiki Documentation Engine - LLM Provider${colors.reset}`);
        console.log(`  ${colors.dim}[1] Gemma 4 12B / Gemini   – Google AI Studio (FREE, default)${colors.reset}`);
        console.log(`  ${colors.dim}[2] Groq                   – Ultra-Fast Llama 3.3 70B (Groq API)${colors.reset}`);
        console.log(`  ${colors.dim}[3] Grok / xAI            – Grok 2 (api.x.ai)${colors.reset}`);
        console.log(`  ${colors.dim}[4] Nvidia NIM            – Llama 3.3 70B (integrate.api.nvidia.com)${colors.reset}`);
        console.log(`  ${colors.dim}[5] OpenRouter            – Claude 3.5, Qwen, Kimi, Llama (openrouter.ai)${colors.reset}`);
        console.log(`  ${colors.dim}[6] OpenAI                – GPT-4o-mini / GPT-4o (api.openai.com)${colors.reset}`);
        console.log(`  ${colors.dim}[7] Ollama / LM Studio    – Local LLM (no API key, no cost)${colors.reset}`);
        console.log(`  ${colors.dim}[8] Custom OpenAI API     – Custom Base URL + API Key + Model${colors.reset}`);

        rl.question(`${colors.yellow}Choose provider [1-8, default: 1]: ${colors.reset}`, (choice) => {
            let provider = "google", model = "", baseUrl = "", keyEnvName = "GEMINI_API_KEY";
            const c = choice.trim();

            if (c === "2")      { provider = "groq";       model = "llama-3.3-70b-versatile"; keyEnvName = "GROQ_API_KEY"; }
            else if (c === "3") { provider = "grok";       model = "grok-2-latest";           keyEnvName = "XAI_API_KEY"; }
            else if (c === "4") { provider = "nvidia";     model = "meta/llama-3.3-70b-instruct"; keyEnvName = "NVIDIA_API_KEY"; baseUrl = "https://integrate.api.nvidia.com/v1"; }
            else if (c === "5") { provider = "openrouter"; model = "anthropic/claude-3.5-sonnet"; keyEnvName = "OPENROUTER_API_KEY"; }
            else if (c === "6") { provider = "openai";     model = "gpt-4o-mini";            keyEnvName = "OPENAI_API_KEY"; }
            else if (c === "7") { provider = "ollama";     model = "llama3";                 baseUrl = "http://localhost:11434/v1"; }
            else if (c === "8") { provider = "custom";     keyEnvName = "OPENWIKI_API_KEY"; }

            const askBaseUrl = (afterUrl) => {
                if (c === "8") {
                    rl.question(`${colors.yellow}Custom Base URL [e.g. https://integrate.api.nvidia.com/v1]: ${colors.reset}`, (u) => {
                        baseUrl = u.trim();
                        afterUrl();
                    });
                } else if (c === "7") {
                    rl.question(`${colors.yellow}Ollama Base URL [default: http://localhost:11434/v1]: ${colors.reset}`, (u) => {
                        if (u.trim()) baseUrl = u.trim();
                        afterUrl();
                    });
                } else {
                    afterUrl();
                }
            };

            const askModel = (afterModel) => {
                const defaultModel = model || (provider === "google" ? "gemma-4-12b-it" : "gpt-4o-mini");
                rl.question(`${colors.yellow}Model name [default: ${defaultModel}]: ${colors.reset}`, (m) => {
                    if (m.trim()) model = m.trim();
                    afterModel();
                });
            };

            const askApiKey = (afterKey) => {
                if (provider === "ollama") { afterKey(""); return; }
                rl.question(`${colors.yellow}Enter your ${keyEnvName} for OpenWiki${colors.reset} ${colors.dim}(leave blank to skip):${colors.reset} `, afterKey);
            };

            const askGitHub = (apiKey) => {
                rl.question(`${colors.yellow}Enter your GITHUB_PERSONAL_ACCESS_TOKEN for GitHub MCP${colors.reset} ${colors.dim}(leave blank to skip):${colors.reset} `, (github) => {
                    resolve({ gemini: apiKey.trim(), github: github.trim(), openwikiProvider: provider, openwikiModel: model, openwikiBaseUrl: baseUrl });
                });
            };

            askBaseUrl(() => askModel(() => askApiKey((apiKey) => askGitHub(apiKey))));
        });
    });
}

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
            if (code === 0) {
                console.log(' -> OpenWiki Daemon installed successfully.');
                console.log(' -> Auto-starting OpenWiki Daemon for the first run...');
                try {
                    const pythonCmd = os.platform() === 'win32' ? 'python' : 'python3';
                    const daemonPath = path.join(scriptBase, 'openwiki_daemon.py');
                    execSync(`${pythonCmd} "${daemonPath}" --one-shot`, { stdio: 'ignore', env: daemonEnv });
                    console.log(' -> Daemon auto-started successfully.');
                } catch(e) {
                    console.warn(` -> Could not auto-start daemon: ${e.message}`);
                }
            }
            else console.error(` -> OpenWiki Daemon installation failed with code ${code}.`);
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
            stdio: 'inherit'
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

promptMode(({ tier, mode, platform, isUniversal, customPaths }) => {
    fs.mkdirSync(backupDir, { recursive: true });
    
    let targetSkillDir = globalConfigDir;
    let targetLegacyDir = globalLegacyDir;
    let targetWorkspaceDir = workspaceDir;
    let targetMcpDir = path.join(geminiDir, 'config');
    let mcpConfigPath = path.join(targetMcpDir, 'mcp_config.json');
    
    if (platform === '2') {
        // Claude Desktop
        console.log("\n[Platform: Claude Desktop] Adapting installation paths...");
        targetSkillDir = path.join(homeDir, '.bdb-skills');
        targetLegacyDir = path.join(homeDir, '.bdb-skills', 'legacy');
        
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
    fs.mkdirSync(targetSkillDir, { recursive: true });
    fs.mkdirSync(targetLegacyDir, { recursive: true });
    fs.mkdirSync(targetWorkspaceDir, { recursive: true });

    copyDirRecursiveSync(path.join(srcDir, 'skills', 'global_config'), targetSkillDir, excludeSkills);
    console.log(" -> Installed global config skills.");

    copyDirRecursiveSync(path.join(srcDir, 'skills', 'global_legacy'), targetLegacyDir, excludeSkills);
    console.log(" -> Installed global legacy skills.");

    copyDirRecursiveSync(path.join(srcDir, 'skills', 'workspace_agents'), targetWorkspaceDir, excludeSkills);
    console.log(" -> Installed workspace skills.");

    console.log("\nInstalling Godmode/Harness configurations to local workspace...");
    const harnessDirs = ['.cursor/rules', '.claude', '.github', '.codex-plugin'];
    harnessDirs.forEach(dir => {
        const sourcePath = path.join(srcDir, dir);
        if (fs.existsSync(sourcePath)) {
            const targetPath = path.join(currentDir, dir);
            copyDirRecursiveSync(sourcePath, targetPath);
            console.log(` -> Copied ${dir} to ${targetPath}`);
        }
    });

    const geminiMdSrc = path.join(srcDir, 'GEMINI.md');
    if (fs.existsSync(geminiMdSrc)) {
        // 1. Antigravity Global config
        fs.copyFileSync(geminiMdSrc, path.join(geminiDir, 'GEMINI.md'));
        console.log(` -> Installed GEMINI.md to ${path.join(geminiDir, 'GEMINI.md')}`);
        
        // 2. Universal Harness Injection
        const globalRules = fs.readFileSync(geminiMdSrc, 'utf8');
        
        // Cursor
        const cursorRulePath = path.join(currentDir, '.cursor', 'rules', '000_global_rules.mdc');
        if (fs.existsSync(path.dirname(cursorRulePath))) {
            fs.writeFileSync(cursorRulePath, `---\nname: global-rules\ndescription: Global BDB Agent Rules\n---\n\n${globalRules}`);
            console.log(` -> Injected Global Rules to ${cursorRulePath}`);
        }
        
        // Claude Code
        const claudeMdPath = path.join(currentDir, 'CLAUDE.md');
        if (fs.existsSync(claudeMdPath)) {
            const claudeContent = fs.readFileSync(claudeMdPath, 'utf8');
            if (!claudeContent.includes("Global Agent Instructions")) {
                fs.appendFileSync(claudeMdPath, `\n\n${globalRules}`);
                console.log(` -> Appended Global Rules to ${claudeMdPath}`);
            }
        } else {
            fs.writeFileSync(claudeMdPath, globalRules);
            console.log(` -> Created ${claudeMdPath} with Global Rules`);
        }
        
        // GitHub Copilot
        const copilotPath = path.join(currentDir, '.github', 'copilot-instructions.md');
        if (fs.existsSync(path.dirname(copilotPath))) {
            const copilotContent = fs.existsSync(copilotPath) ? fs.readFileSync(copilotPath, 'utf8') : '';
            if (!copilotContent.includes("Global Agent Instructions")) {
                fs.appendFileSync(copilotPath, `\n\n${globalRules}`);
                console.log(` -> Injected Global Rules to ${copilotPath}`);
            }
        }
        
        // Codex Plugin
        const codexPath = path.join(currentDir, '.codex-plugin', 'system.md');
        if (fs.existsSync(path.dirname(codexPath))) {
            const codexContent = fs.existsSync(codexPath) ? fs.readFileSync(codexPath, 'utf8') : '';
            if (!codexContent.includes("Global Agent Instructions")) {
                fs.appendFileSync(codexPath, `\n\n${globalRules}`);
                console.log(` -> Injected Global Rules to ${codexPath}`);
            }
        }
    }

    (async () => {
        const mcpSrcDir = path.join(srcDir, 'mcps');
        const mcpCodeTarget = path.join(targetMcpDir, 'mcps');
        const selectedMcps = await promptMcpSelection(mcpSrcDir, tier);
        
        if (selectedMcps.length > 0) {
            fs.mkdirSync(targetMcpDir, { recursive: true });
            if (!fs.existsSync(mcpCodeTarget)) fs.mkdirSync(mcpCodeTarget, { recursive: true });

            console.log(`\nInstalling ${selectedMcps.length} selected MCPs...`);
            selectedMcps.forEach(mcp => {
                copyDirRecursiveSync(path.join(mcpSrcDir, mcp), path.join(mcpCodeTarget, mcp));
            });
            console.log(` -> Installed selected MCP servers to ${mcpCodeTarget}`);

            
            const nodeMcps = ['adobe_uxp_mcp', 'unreal_mcp', 'tdmcp', 'touchdesigner-mcp', 'davinci-resolve-mcp', 'after-effects-mcp', 'computer-use-mcp'];
            nodeMcps.filter(m => selectedMcps.includes(m)).forEach(mcpFolder => {
                const targetFolder = path.join(mcpCodeTarget, mcpFolder);
                if (fs.existsSync(path.join(targetFolder, 'package.json'))) {
                    console.log(` -> Setting up Node dependencies for ${mcpFolder}...`);
                    try {
                        execSync('npm install --no-audit --no-fund', { cwd: targetFolder, stdio: 'ignore' });
                        if (fs.existsSync(path.join(targetFolder, 'tsconfig.json')) || fs.existsSync(path.join(targetFolder, 'tsconfig.build.json'))) {
                            console.log(` -> Compiling TypeScript for ${mcpFolder}...`);
                            execSync('npm run build', { cwd: targetFolder, stdio: 'ignore' });
                        }
                    } catch (e) { console.warn(`Warning: Failed to set up ${mcpFolder}: ${e.message}`); }
                }
            });

            if (selectedMcps.includes('memb-mcp')) {
                const membMcpFolder = path.join(mcpCodeTarget, 'memb-mcp');
                if (fs.existsSync(membMcpFolder)) {
                    console.log(` -> Bootstrapping Python virtual environment for memB MCP...`);
                    try {
                        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
                        execSync(`${pythonCmd} -m venv .venv`, { cwd: membMcpFolder, stdio: 'ignore' });
                        const pipPath = process.platform === 'win32' ? '.venv\\Scripts\\pip.exe' : '.venv/bin/pip';
                        console.log(` -> Installing Python dependencies for memB MCP...`);
                        execSync(`"${pipPath}" install --upgrade pip`, { cwd: membMcpFolder, stdio: 'ignore' });
                        execSync(`"${pipPath}" install -r requirements.txt`, { cwd: membMcpFolder, stdio: 'ignore' });
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

            if (fs.existsSync(mcpConfigPath)) {
                fs.copyFileSync(mcpConfigPath, path.join(backupDir, 'mcp_config_backup.json'));
                console.log(` -> Backed up existing ${path.basename(mcpConfigPath)}`);
            }
            
            let mcpConfigStr = fs.readFileSync(path.join(srcDir, 'mcp_config.json'), 'utf8');
            try {
                const parsedMcpConfig = JSON.parse(mcpConfigStr);
                const finalMcpServers = {};
                const availableFolders = fs.readdirSync(mcpSrcDir);
                for (const [key, val] of Object.entries(parsedMcpConfig.mcpServers)) {
                    let keep = true;
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

            mcpConfigStr = mcpConfigStr.replace(/__MCPS_DIR__/g, mcpCodeTarget);
            mcpConfigStr = mcpConfigStr.replace(/\{\{HOME\}\}/g, homeDir);

            if (selectedMcps.includes('memb-mcp')) {
                const pythonBinPath = process.platform === 'win32'
                    ? path.join(mcpCodeTarget, 'memb-mcp', '.venv', 'Scripts', 'python.exe')
                    : path.join(mcpCodeTarget, 'memb-mcp', '.venv', 'bin', 'python');
                mcpConfigStr = mcpConfigStr.replace(/__PYTHON_BIN__/g, pythonBinPath.replace(/\\/g, '/'));
            }
            
            if (mode === '1' && fs.existsSync(mcpConfigPath)) {
                try {
                    const oldConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
                    const newConfig = JSON.parse(mcpConfigStr);
                    oldConfig.mcpServers = Object.assign({}, oldConfig.mcpServers || {}, newConfig.mcpServers || {});
                    fs.writeFileSync(mcpConfigPath, JSON.stringify(oldConfig, null, 2));
                    console.log(` -> Merged BDB MCPs into existing ${path.basename(mcpConfigPath)}`);
                } catch (e) {
                    console.log(` -> Failed to parse existing JSON, overwriting ${path.basename(mcpConfigPath)}`);
                    fs.writeFileSync(mcpConfigPath, mcpConfigStr);
                }
            } else {
                if ((platform === '2' || platform === '4') && !fs.existsSync(mcpConfigPath)) {
                     const wrapper = { mcpServers: JSON.parse(mcpConfigStr).mcpServers };
                     fs.writeFileSync(mcpConfigPath, JSON.stringify(wrapper, null, 2));
                } else {
                     fs.writeFileSync(mcpConfigPath, mcpConfigStr);
                }
                console.log(` -> Installed optimized MCP config to ${targetMcpDir}`);
            }
        } else {
            console.log(" -> Skipping MCP installation.");
        }

        const creds = await promptCredentials();
        
        if (creds.gemini || creds.github) {
            const envPath = path.join(targetMcpDir, '.env');
            let envContent = '';
            if (fs.existsSync(envPath)) envContent = fs.readFileSync(envPath, 'utf8') + '\n';
            if (creds.gemini && !envContent.includes('GEMINI_API_KEY=')) envContent += `GEMINI_API_KEY=${creds.gemini}\n`;
            if (creds.github && !envContent.includes('GITHUB_PERSONAL_ACCESS_TOKEN=')) envContent += `GITHUB_PERSONAL_ACCESS_TOKEN=${creds.github}\n`;
            if (envContent.trim().length > 0) fs.writeFileSync(envPath, envContent.trim() + '\n');
            console.log(` -> Saved credentials to ${envPath}`);
        }

async function promptMemBIngestion(mcpCodeTarget) {
    if (isAutoYes) return;
    
    console.log(`\n${colors.cyan}${colors.bold}🧠 memB Deep Memory Ingestion${colors.reset}`);
    const doIngest = await new Promise((resolve) => {
        rl.question(`${colors.yellow}Would you like to scan & ingest a project directory into memB memory? (y/N): ${colors.reset}`, (answer) => {
            resolve(answer.trim().toLowerCase() === 'y');
        });
    });

    if (!doIngest) return;

    const targetDir = await new Promise((resolve) => {
        rl.question(`${colors.yellow}Enter project directory path to scan [default: current workspace]: ${colors.reset}`, (answer) => {
            resolve(answer.trim() || process.cwd());
        });
    });

    const includeTranscripts = await new Promise((resolve) => {
        rl.question(`${colors.yellow}Include past conversation logs/transcripts? (y/N): ${colors.reset}`, (answer) => {
            resolve(answer.trim().toLowerCase() === 'y');
        });
    });

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
    const doInstall = await new Promise((resolve) => {
        rl.question(`${colors.yellow}Möchtest du das Plugin 'BDB Creator Extension' (3D, Video & ComfyUI MCP Engines) installieren? (y/N): ${colors.reset}`, (answer) => {
            resolve(answer.trim().toLowerCase() === 'y');
        });
    });

    if (!doInstall) return;

    // Use user's home directory config path for stability if running via npx, or alongside current dir
    const basePath = __dirname.includes('_npx') ? path.join(os.homedir(), '.gemini') : path.dirname(srcDir);
    const creatorDir = path.join(basePath, 'bdb-dev-creator-extension');
    const installerScript = path.join(creatorDir, 'installer.js');

    if (!fs.existsSync(creatorDir)) {
        console.log(` -> BDB Creator Extension wird nach ${creatorDir} geklont...`);
        try {
            execSync(`git clone https://github.com/hybridlabor-api/bdb-dev-creator-extension.git "${creatorDir}"`, { stdio: 'inherit' });
        } catch (e) {
            console.log(` -> Fehler beim Klonen der Creator Extension: ${e.message}`);
            return;
        }
    }

    if (fs.existsSync(installerScript)) {
        console.log(` -> Starte Setup der BDB Creator Extension...`);
        try {
            execSync(`node "${installerScript}"`, { stdio: 'inherit', cwd: creatorDir });
        } catch (e) {
            console.log(` -> Hinweis beim Ausführen des Creator Extension Setups: ${e.message}`);
        }
    }
}

async function promptOSAgentWorkspace() {
    if (isAutoYes) return;
    
    console.log(`\n${colors.magenta}${colors.bold}🧠 BDB OS Agent Workspace (AI Orchestrator)${colors.reset}`);
    const doInstall = await new Promise((resolve) => {
        rl.question(`${colors.yellow}Möchtest du den 'BDB OS Agent Workspace' (Orchestration Layer für parallele AI Agents) installieren? (y/N): ${colors.reset}`, (answer) => {
            resolve(answer.trim().toLowerCase() === 'y');
        });
    });

    if (!doInstall) return;

    const basePath = __dirname.includes('_npx') ? path.join(os.homedir(), '.gemini') : path.dirname(srcDir);
    const osAgentDir = path.join(basePath, 'bdb-os-agent-workspace');

    if (!fs.existsSync(osAgentDir)) {
        console.log(` -> BDB OS Agent Workspace wird nach ${osAgentDir} geklont...`);
        try {
            execSync(`git clone https://github.com/hybridlabor-api/bdb-os-agent-workspace.git "${osAgentDir}"`, { stdio: 'inherit' });
            console.log(` -> Erfolgreich geklont! (CD in ${osAgentDir} für die OS-Steuerung)`);
        } catch (e) {
            console.log(` -> Fehler beim Klonen des OS Agent Workspaces: ${e.message}`);
        }
    } else {
        console.log(` -> BDB OS Agent Workspace existiert bereits unter ${osAgentDir}.`);
    }
}

        await installOpenWikiDaemon(creds.gemini, targetSkillDir, { provider: creds.openwikiProvider, model: creds.openwikiModel, baseUrl: creds.openwikiBaseUrl });
        await installTokenSaver(platform);
        await promptCreatorExtension(mcpConfigPath);
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
                    if (fs.existsSync(targetPath)) {
                        data = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
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

            for (const d of detections) {
                console.log(` -> Injecting MCP engines into ${d.name}...`);
                if (d.key === 'claude') syncMcpConfig(path.join(d.path, 'claude_desktop_config.json'));
                else if (d.key === 'cursor' || d.key === 'windsurf' || d.key === 'vscode' || d.key === 'aider') syncMcpConfig(path.join(d.path, 'mcp.json'));
            }
            console.log(` -> Universal Sync Complete!`);
        }
        
        console.log(`\n${colors.green}${colors.bold}=========================================================${colors.reset}`);
        console.log(`${colors.green}${colors.bold} 🎉 Installation complete! The environment now has the ${colors.reset}`);
        console.log(`${colors.green}${colors.bold}    optimized skill configuration.${colors.reset}`);
        console.log(`${colors.green}${colors.bold}=========================================================${colors.reset}`);
        rl.close();
    })();
});
