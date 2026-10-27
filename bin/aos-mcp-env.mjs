#!/usr/bin/env node
// Starts an MCP server with only the secrets it declares, read from ~/.aos/secrets.env (mode 0600).
// Usage: aos-mcp-env --vars GITHUB_PERSONAL_ACCESS_TOKEN -- npx -y @modelcontextprotocol/server-github@2025.4.8
// A missing or refused secrets file never blocks the server: it starts without the variables and a hint
// goes to stderr. Variables already set in the environment win. Values are never printed.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';

// The help guard is optional here: the launcher starts every MCP server and may sit next to only its three lib files.
await import('../lib/cli-help-guard.mjs').catch((e) => { if (e?.code !== 'ERR_MODULE_NOT_FOUND') throw e; });

// A missing lib (e.g. ~/.agents/lib removed) must not keep the server from starting.
let lib = null;
try { lib = createRequire(import.meta.url)('../lib/mcp-secrets.js'); } catch { /* hint below */ }

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const vi = argv.indexOf('--vars');
if (sep < 0 || sep === argv.length - 1) {
    console.error('aos-mcp-env: usage: aos-mcp-env --vars A,B -- <command> [args...]');
    process.exit(2);
}
const wanted = (vi >= 0 && vi < sep ? String(argv[vi + 1] || '') : '').split(',').filter((v) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(v));
const [command, ...args] = argv.slice(sep + 1);
const membLlm = argv.slice(0, sep).includes('--memb-llm');

const env = { ...process.env };
const missing = wanted.filter((v) => !env[v]);
if (missing.length && !lib) {
    console.error(`aos-mcp-env: ../lib/mcp-secrets.js not found next to this launcher; starting without ${missing.join(', ')}. Re-run the AOS installer.`);
} else if (missing.length) {
    const { readSecretsFile, secretsPath } = lib;
    const file = secretsPath(os.homedir());
    const s = readSecretsFile(file);
    if (s.state === 'ok') { for (const v of missing) if (s.vars[v]) env[v] = s.vars[v]; }
    else if (s.state === 'refused') console.error(`aos-mcp-env: ${file} ignored: ${s.reason}`);
    const still = missing.filter((v) => !env[v]);
    if (still.length) console.error(`aos-mcp-env: ${still.join(', ')} not set; add ${still.length > 1 ? 'them' : 'it'} to ${file} (KEY=value per line, chmod 600). Starting without.`);
}

// memb_mcp: LLM provider/model/key follow the user's OpenWiki or MEMB_LLM_* choice (lib/memb-llm.js), not just GEMINI_API_KEY.
if (membLlm) {
    try {
        const resolved = createRequire(import.meta.url)('../lib/memb-llm.js').resolveMembLlm({ home: os.homedir(), env });
        for (const [k, v] of Object.entries(resolved)) if (!env[k]) env[k] = v;
        if (env.MEMB_LLM_PROVIDER) console.error(`aos-mcp-env: memB LLM provider ${env.MEMB_LLM_PROVIDER}${env.MEMB_LLM_MODEL ? ` (${env.MEMB_LLM_MODEL})` : ''}`);
    } catch { /* memB keeps its own defaults */ }
}

// Windows: resolve with the entry's own env (PATH x PATHEXT, key case-insensitive, ~/.local/bin and %APPDATA%\npm fallbacks)
// through the shared cli-spawn helper; .cmd shims go through an escaped cmd.exe line, never shell:true.
let cliSpawn = null;
try { cliSpawn = createRequire(import.meta.url)('../lib/cli-spawn.js'); } catch { /* bare spawn below */ }
let file = command;
let spawnArgs = args;
let spawnOpts = {};
if (process.platform === 'win32' && cliSpawn) {
    // A spread of process.env keeps each key's case; two PATH spellings must not disagree about which one wins.
    const pathKeys = Object.keys(env).filter((k) => k.toLowerCase() === 'path');
    if (pathKeys.length > 1) { const keep = pathKeys.includes('PATH') ? 'PATH' : pathKeys[0]; for (const k of pathKeys) if (k !== keep) delete env[k]; }
    const resolved = cliSpawn.resolveCommand(command, { env });
    if (!resolved) {
        console.error(`aos-mcp-env: cannot start ${command}: ENOENT (searched PATH x PATHEXT and the standard install folders)`);
        process.exit(127);
    }
    try { ({ file, args: spawnArgs, options: spawnOpts } = cliSpawn.buildInvocation(resolved, args, { env })); }
    catch (e) { console.error(`aos-mcp-env: cannot start ${command}: ${e.message}`); process.exit(127); }
}
const child = spawn(file, spawnArgs, { stdio: 'inherit', env, windowsHide: true, ...spawnOpts });
const forward = (sig) => () => { try { child.kill(sig); } catch { /* already gone */ } };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, forward(sig));
child.on('error', (e) => { console.error(`aos-mcp-env: cannot start ${command}: ${e.code || e.message}`); process.exit(127); });
child.on('exit', (code, signal) => {
    if (signal) { process.removeAllListeners(signal); process.kill(process.pid, signal); } else process.exit(code ?? 1);
});
