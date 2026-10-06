#!/usr/bin/env node
// Starts an MCP server with only the secrets it declares, read from ~/.aos/secrets.env (mode 0600).
// Usage: aos-mcp-env --vars GITHUB_PERSONAL_ACCESS_TOKEN -- npx -y @modelcontextprotocol/server-github@2025.4.8
// A missing or refused secrets file never blocks the server: it starts without the variables and a hint
// goes to stderr. Variables already set in the environment win. Values are never printed.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';

const { readSecretsFile, secretsPath } = createRequire(import.meta.url)('../lib/mcp-secrets.js');

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const vi = argv.indexOf('--vars');
if (sep < 0 || sep === argv.length - 1) {
    console.error('aos-mcp-env: usage: aos-mcp-env --vars A,B -- <command> [args...]');
    process.exit(2);
}
const wanted = (vi >= 0 && vi < sep ? String(argv[vi + 1] || '') : '').split(',').filter((v) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(v));
const [command, ...args] = argv.slice(sep + 1);

const env = { ...process.env };
const missing = wanted.filter((v) => !env[v]);
if (missing.length) {
    const file = secretsPath(os.homedir());
    const s = readSecretsFile(file);
    if (s.state === 'ok') { for (const v of missing) if (s.vars[v]) env[v] = s.vars[v]; }
    else if (s.state === 'refused') console.error(`aos-mcp-env: ${file} ignored: ${s.reason}`);
    const still = missing.filter((v) => !env[v]);
    if (still.length) console.error(`aos-mcp-env: ${still.join(', ')} not set; add ${still.length > 1 ? 'them' : 'it'} to ${file} (KEY=value per line, chmod 600). Starting without.`);
}

// npx, uv shims etc. are .cmd files on Windows and need cmd to be spawned.
const win = process.platform === 'win32' && !/\.exe$/i.test(command);
const child = win ? spawn('cmd', ['/c', command, ...args], { stdio: 'inherit', env }) : spawn(command, args, { stdio: 'inherit', env });
const forward = (sig) => () => { try { child.kill(sig); } catch { /* already gone */ } };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, forward(sig));
child.on('error', (e) => { console.error(`aos-mcp-env: cannot start ${command}: ${e.code || e.message}`); process.exit(127); });
child.on('exit', (code, signal) => {
    if (signal) { process.removeAllListeners(signal); process.kill(process.pid, signal); } else process.exit(code ?? 1);
});
