#!/usr/bin/env node

/**
 * 🥋 BDB SaaS Host Workstation Setup Installer
 * Powered by @clack/prompts
 * 
 * Features:
 * - Browser 2FA Login Handshake (gh auth / step ssh style - ZERO manual API keys)
 * - Step-CA 2FA Bootstrap (Dynamic Discovery)
 * - Atomic ~/.ssh/config Patching with Fleet Host Rules
 * - Auto-Detection & Token Injection for Cursor, Google Antigravity, Claude Desktop & Roo Code
 * - Local Sync of the /bdbsaastraining Skill
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execSync, execFileSync, spawn } from 'node:child_process';
import {
  intro,
  outro,
  note,
  text,
  spinner,
  isCancel,
  cancel,
  log
} from '@clack/prompts';
import p from 'picocolors';

function handleCancel(value) {
  if (isCancel(value)) {
    cancel(p.yellow('Setup durch Benutzer abgebrochen.'));
    process.exit(0);
  }
  return value;
}

function hasCommand(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function openBrowser(url) {
  const platform = os.platform();
  if (platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' });
  } else if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', url], { detached: true, stdio: 'ignore' });
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  }
}

function ensureStepCli() {
  if (hasCommand('step')) return true;

  const platform = os.platform();
  if (platform === 'darwin') {
    if (hasCommand('brew')) {
      try {
        execSync('brew install step', { stdio: 'ignore' });
        return true;
      } catch {}
    }
  } else if (platform === 'linux') {
    if (hasCommand('apt-get')) {
      try {
        execSync('sudo apt-get update && sudo apt-get install -y step-cli', { stdio: 'ignore' });
        return true;
      } catch {}
    }
  }
  return false;
}

function bootstrapStepCa(caUrl, fingerprint) {
  // execFileSync with an args array: caUrl/fingerprint arrive as gateway
  // callback query params -- inside an execSync shell string, `$(...)` would
  // execute (audit SEC-1).
  try {
    const args = ['ca', 'bootstrap', '--ca-url', caUrl];
    if (fingerprint) {
      args.push('--fingerprint', fingerprint);
    } else {
      args.push('--install');
    }
    args.push('--force');
    execFileSync('step', args, { stdio: 'ignore' });
    return true;
  } catch (err) {
    return false;
  }
}

// Whitelist-validate callback params before they land in ~/.ssh/config: an
// indented keyword there is a directive (ProxyCommand = shell execution on
// the next ssh), so newlines/quotes/$ in user, host pattern or IPs are an
// injection vector (audit SEC-2). Fail closed with a clear error instead of
// writing a half-valid config.
function assertSshSafe(label, value, pattern) {
  if (!pattern.test(value)) {
    throw new Error(`Ungültige Zeichen in '${label}' -- SSH-Config-Patch abgebrochen.`);
  }
}

// Returns whether the CertificateFile line was actually included, so the
// caller can warn the user rather than silently shipping a degraded config
// (audit ROB-1: bootstrapStepCa()'s result used to be discarded entirely,
// so a failed CA bootstrap still got a CertificateFile line pointed at a
// cert that was never created). Checking the cert file's own existence,
// not just the bootstrap call's return value, is the more direct signal --
// a bootstrap can report success while writing the cert somewhere step's
// own config expects but this script doesn't, or vice-versa.
function patchSshConfig(username, hostPattern, hostIps = '') {
  assertSshSafe('User', username, /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
  assertSshSafe('Host-Pattern', hostPattern, /^[A-Za-z0-9._*?!, -]{1,200}$/);
  assertSshSafe('Host-IPs', hostIps, /^[A-Za-z0-9., -]{0,400}$/);

  const homeDir = os.homedir();
  const sshDir = path.join(homeDir, '.ssh');
  if (!fs.existsSync(sshDir)) {
    fs.mkdirSync(sshDir, { mode: 0o700, recursive: true });
  }

  const sshConfigFile = path.join(sshDir, 'config');
  let currentContent = '';
  if (fs.existsSync(sshConfigFile)) {
    currentContent = fs.readFileSync(sshConfigFile, 'utf8');
  }

  const certFile = path.join(homeDir, '.step', 'ssh', 'id_ecdsa-cert.pub');
  const certReady = fs.existsSync(certFile);

  const markerBegin = '# --- BEGIN BDB SAAS HOST FLEET RULES ---';
  const markerEnd = '# --- END BDB SAAS HOST FLEET RULES ---';

  const hostRuleBlock = `${markerBegin}
Host ${hostPattern}${hostIps ? ' ' + hostIps : ''}
    User ${username}
${certReady ? '    CertificateFile ~/.step/ssh/id_ecdsa-cert.pub\n' : ''}    IdentityFile ~/.step/ssh/id_ecdsa
    IdentityFile ~/.ssh/id_ed25519
    IdentityFile ~/.ssh/id_rsa
    ServerAliveInterval 60
${markerEnd}`;

  let newContent = '';
  if (currentContent.includes(markerBegin)) {
    const regex = new RegExp(`${markerBegin}[\\s\\S]*?${markerEnd}`, 'g');
    newContent = currentContent.replace(regex, hostRuleBlock);
  } else {
    newContent = currentContent ? `${currentContent.trim()}\n\n${hostRuleBlock}\n` : `${hostRuleBlock}\n`;
  }

  const tempFile = path.join(sshDir, `config.tmp.${Date.now()}`);
  fs.writeFileSync(tempFile, newContent, { mode: 0o600 });
  fs.renameSync(tempFile, sshConfigFile);

  return certReady;
}

function detectInstalledEditors() {
  const homeDir = os.homedir();
  const detected = [];

  // Cursor
  if (
    fs.existsSync(path.join(homeDir, '.cursor')) ||
    fs.existsSync(path.join(homeDir, 'Library', 'Application Support', 'Cursor')) ||
    fs.existsSync('/Applications/Cursor.app') ||
    hasCommand('cursor')
  ) {
    detected.push({ id: 'cursor', name: 'Cursor IDE' });
  }

  // Antigravity (AGY)
  if (
    fs.existsSync(path.join(homeDir, '.gemini', 'antigravity-cli')) ||
    fs.existsSync(path.join(homeDir, '.gemini')) ||
    hasCommand('agy')
  ) {
    detected.push({ id: 'antigravity', name: 'Google Antigravity (AGY)' });
  }

  // Claude Desktop
  if (
    fs.existsSync(path.join(homeDir, 'Library', 'Application Support', 'Claude')) ||
    fs.existsSync('/Applications/Claude.app')
  ) {
    detected.push({ id: 'claude', name: 'Claude Desktop' });
  }

  // OpenCode / Roo Code
  if (
    fs.existsSync(path.join(homeDir, '.config', 'opencode')) ||
    hasCommand('opencode') ||
    fs.existsSync(path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline'))
  ) {
    detected.push({ id: 'opencode', name: 'OpenCode / Roo Code' });
  }

  // Fallback
  if (detected.length === 0) {
    detected.push({ id: 'cursor', name: 'Cursor IDE (Standard)' });
    detected.push({ id: 'antigravity', name: 'Google Antigravity (Standard)' });
  }

  return detected;
}

// Every MCP config below carries the injected FastMCP API key -- 0600, not
// the umask default (audit SEC-4 class, found separately from installer.js's
// instance of the same issue). writeFileSync's `mode` option only applies
// when the file is CREATED, so an existing 0644 config from a prior run
// would otherwise keep it -- chmod explicitly either way.
function writeMcpConfigSecure(filePath, config) {
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), { mode: 0o600 });
  try { fs.chmodSync(filePath, 0o600); } catch {}
}

function configureCursorMcp(apiKey, gatewaySseUrl) {
  const homeDir = os.homedir();
  const cursorDir = path.join(homeDir, '.cursor');
  if (!fs.existsSync(cursorDir)) fs.mkdirSync(cursorDir, { recursive: true });

  const mcpFile = path.join(cursorDir, 'mcp.json');
  let config = { mcpServers: {} };
  if (fs.existsSync(mcpFile)) {
    try { config = JSON.parse(fs.readFileSync(mcpFile, 'utf8')); } catch {}
  }
  config.mcpServers = config.mcpServers || {};
  config.mcpServers['bdb-remoteos'] = {
    url: gatewaySseUrl,
    headers: { 'X-API-Key': apiKey }
  };
  writeMcpConfigSecure(mcpFile, config);
}

function configureClaudeDesktopMcp(apiKey, gatewaySseUrl) {
  const homeDir = os.homedir();
  let claudeDir = '';
  if (os.platform() === 'darwin') {
    claudeDir = path.join(homeDir, 'Library', 'Application Support', 'Claude');
  } else {
    claudeDir = path.join(homeDir, '.config', 'Claude');
  }

  if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });

  const mcpFile = path.join(claudeDir, 'claude_desktop_config.json');
  let config = { mcpServers: {} };
  if (fs.existsSync(mcpFile)) {
    try { config = JSON.parse(fs.readFileSync(mcpFile, 'utf8')); } catch {}
  }
  config.mcpServers = config.mcpServers || {};
  config.mcpServers['bdb-remoteos'] = {
    url: gatewaySseUrl,
    headers: { 'X-API-Key': apiKey }
  };
  writeMcpConfigSecure(mcpFile, config);
}

function configureAntigravityMcp(apiKey, gatewaySseUrl) {
  const homeDir = os.homedir();
  const mcpDir = path.join(homeDir, '.gemini', 'antigravity-cli', 'mcp', 'bdb_remoteos_gateway');
  fs.mkdirSync(mcpDir, { recursive: true });

  const schemaFile = path.join(mcpDir, 'config.json');
  const config = {
    name: 'bdb_remoteos_gateway',
    transport: 'sse',
    url: gatewaySseUrl,
    headers: { 'X-API-Key': apiKey }
  };
  writeMcpConfigSecure(schemaFile, config);
}

function configureRooCodeMcp(apiKey, gatewaySseUrl) {
  const homeDir = os.homedir();
  const rooDir = path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings');
  if (fs.existsSync(rooDir)) {
    const mcpFile = path.join(rooDir, 'cline_mcp_settings.json');
    let config = { mcpServers: {} };
    if (fs.existsSync(mcpFile)) {
      try { config = JSON.parse(fs.readFileSync(mcpFile, 'utf8')); } catch {}
    }
    config.mcpServers = config.mcpServers || {};
    config.mcpServers['bdb-remoteos'] = {
      url: gatewaySseUrl,
      headers: { 'X-API-Key': apiKey }
    };
    writeMcpConfigSecure(mcpFile, config);
  }
}

function syncTrainingSkill() {
  const homeDir = os.homedir();
  const targetSkillDir = path.join(homeDir, '.agents', 'skills', 'bdbsaastraining');
  fs.mkdirSync(targetSkillDir, { recursive: true });

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoSkillDir = path.join(__dirname, '..', 'skills', 'bdbsaastraining');
  if (fs.existsSync(repoSkillDir)) {
    fs.cpSync(repoSkillDir, targetSkillDir, { recursive: true });
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Starts a temporary local HTTP loopback server and opens the browser
 * to complete the 2FA handshake with Authelia on the dynamic gateway.
 */
function performBrowserAuthHandshake(gatewayBaseUrl, port = 8123) {
  return new Promise((resolve, reject) => {
    const stateToken = crypto.randomBytes(16).toString('hex');
    let server;

    const timeout = setTimeout(() => {
      if (server) server.close();
      reject(new Error('Zeitüberschreitung beim 2FA Browser-Login (5 Minuten).'));
    }, 300000);

    server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, `http://127.0.0.1:${port}`);
      
      if (parsedUrl.pathname === '/callback') {
        // CSRF guard: the legit gateway echoes our state_token back. A
        // mismatched echo is a forged/foreign request -- refuse it and keep
        // waiting for the real callback (the 5-minute timeout still bounds
        // this). An absent echo means an older backend; accepted for
        // backward compatibility.
        const stateEcho = parsedUrl.searchParams.get('state_token');
        if (stateEcho && stateEcho !== stateToken) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Ungültiger state_token.');
          return;
        }

        const token = parsedUrl.searchParams.get('token');
        const user = parsedUrl.searchParams.get('user') || 'user';

        const stepCaUrl = parsedUrl.searchParams.get('step_ca_url');
        const stepCaFingerprint = parsedUrl.searchParams.get('step_ca_fingerprint');
        const sshHostPattern = parsedUrl.searchParams.get('ssh_host_pattern');
        const sshHostIps = parsedUrl.searchParams.get('ssh_host_ips') || '';

        // no-store + replaceState keep the token out of browser history and
        // disk cache; no-referrer keeps it away from cross-origin referrers.
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer'
        });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Authentifizierung Erfolgreich</title>
            <style>
              body { background: #080c14; color: #f8fafc; font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
              .card { background: #12141e; border: 1px solid #23273c; border-radius: 16px; padding: 40px; text-align: center; max-width: 420px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
              h1 { color: #34d399; font-size: 22px; }
              p { color: #94a3b8; font-size: 14px; line-height: 1.6; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>✔ Authentifizierung Erfolgreich!</h1>
              <p>Hallo <b>${escapeHtml(user)}</b>. Dein FastMCP Token wurde an das Terminal übertragen.<br><br>Du kannst dieses Browser-Tab jetzt schließen.</p>
            </div>
            <script>history.replaceState(null, '', '/done');</script>
          </body>
          </html>
        `);

        clearTimeout(timeout);
        server.close();

        if (token) {
          resolve({ token, user, stepCaUrl, stepCaFingerprint, sshHostPattern, sshHostIps });
        } else {
          reject(new Error('Kein Token im Callback empfangen.'));
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(port, '127.0.0.1', () => {
      const authUrl = `${gatewayBaseUrl}/api/cli-auth?port=${port}&state_token=${stateToken}`;
      openBrowser(authUrl);
    });

    server.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function main() {
  console.clear();

  intro(p.bgCyan(p.black(' 🥋 BDB SaaS Host Workstation Setup ')));

  note(
    'Dieses Setup konfiguriert Step-CA 2FA, SSH-Zertifikate, FastMCP\n' +
    'sowie den /bdbsaastraining Skill für dein persönliches Onboarding.',
    p.cyan('Willkommen im BDB Agent OS')
  );

  // 1. Auto-Detect Installed Editors
  const detectedEditors = detectInstalledEditors();
  const detectedNames = detectedEditors.map(e => p.green(e.name)).join(', ');
  log.info(`Erkannte AI-Agenten auf dieser Workstation: ${detectedNames}`);

  // 2. User Information
  const fullName = handleCancel(await text({
    message: 'Wie lautet dein vollständiger Name? (für Zertifikate)',
    placeholder: 'z.B. Noah Becker',
    validate(val) {
      if (!val || val.trim().length < 2) return 'Bitte gib deinen Vor- und Nachnamen ein.';
    }
  }));

  // Parse CLI args for gateway
  const args = process.argv.slice(2);
  let gatewayArg = null;
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--gateway' || args[i] === '--domain') && args[i + 1]) {
      gatewayArg = args[i + 1];
      break;
    }
  }

  let gatewayDomain = gatewayArg;
  if (!gatewayDomain) {
    gatewayDomain = handleCancel(await text({
      message: 'Wie lautet die Gateway-URL deiner Organisation? (z.B. https://gateway.deinedomain.com)',
      placeholder: 'gateway.example.com',
      validate(val) {
        if (!val || val.trim().length < 5) return 'Bitte gib eine gültige Domain oder URL ein.';
      }
    }));
  }

  // derive domain
  let gatewayUrl = gatewayDomain.startsWith('http') ? gatewayDomain : `https://${gatewayDomain}`;
  let baseDomain = '';
  try {
    baseDomain = new URL(gatewayUrl).hostname.replace(/^gateway\./, '');
  } catch (e) {
    baseDomain = gatewayDomain.replace(/^gateway\./, '').replace(/^https?:\/\//, '');
  }
  let gatewaySseUrl = `${gatewayUrl}/sse`;

  // 3. Browser 2FA Login Handshake
  const s = spinner();
  s.start(`Öffne Webbrowser für 2FA Login auf ${gatewayUrl}...`);

  let authResult;
  try {
    authResult = await performBrowserAuthHandshake(gatewayUrl, 8123);
    s.stop(p.green(`✔ 2FA Login erfolgreich verifiziert für User: ${p.bold(authResult.user)}!`));
  } catch (err) {
    s.stop(p.red(`❌ 2FA Login fehlgeschlagen: ${err.message}`));
    process.exit(1);
  }

  const { token, user: lldapUsername, stepCaUrl, stepCaFingerprint, sshHostPattern, sshHostIps } = authResult;

  // Dynamische Fallbacks
  const finalStepCaUrl = stepCaUrl || `https://ca.${baseDomain}`;
  const finalSshHostPattern = sshHostPattern || `*.${baseDomain}`;

  // 4. Execution Spinner for System Tasks
  s.start('Konfiguriere System-Dienste & Keys...');

  // Step 1: Step CLI Check
  s.message('Prüfe Step-CA CLI Installation...');
  const stepOk = ensureStepCli();
  if (!stepOk) {
    s.stop(p.yellow('⚠️ step CLI nicht automatisch gefunden. Bitte manuell installieren: brew install step'));
    s.start('Setze Setup fort...');
  }

  // Step 2: Bootstrap CA
  s.message(`Führe Step-CA Bootstrap durch (${finalStepCaUrl})...`);
  const stepCaOk = bootstrapStepCa(finalStepCaUrl, stepCaFingerprint);
  if (!stepCaOk) {
    s.stop(p.yellow(`⚠️ Step-CA Bootstrap fehlgeschlagen (${finalStepCaUrl}) -- SSH-Zertifikat wird übersprungen.`));
    s.start('Setze Setup fort...');
  }

  // Step 3: Patch SSH Config
  s.message(`Konfiguriere ~/.ssh/config für Host ${finalSshHostPattern} (${lldapUsername})...`);
  const certIncluded = patchSshConfig(lldapUsername, finalSshHostPattern, sshHostIps);
  if (!certIncluded) {
    s.stop(p.yellow('⚠️ Kein Step-CA-Zertifikat gefunden -- SSH-Eintrag angelegt ohne CertificateFile (Fallback: SSH-Keys).'));
    s.start('Setze Setup fort...');
  }

  // Step 4: Auto-Inject MCP Configs for all detected editors
  const editorIds = detectedEditors.map(e => e.id);
  s.message(`Injiziere FastMCP SSE-Gateway in ${detectedEditors.length} erkannte Editoren...`);
  if (editorIds.includes('cursor')) configureCursorMcp(token, gatewaySseUrl);
  if (editorIds.includes('claude')) configureClaudeDesktopMcp(token, gatewaySseUrl);
  if (editorIds.includes('antigravity')) configureAntigravityMcp(token, gatewaySseUrl);
  if (editorIds.includes('opencode')) configureRooCodeMcp(token, gatewaySseUrl);

  // Step 5: Skill Sync
  s.message('Synchronisiere /bdbsaastraining Skill in dein lokales Verzeichnis...');
  syncTrainingSkill();

  s.stop(p.green('✔ Alle Konfigurationen erfolgreich abgeschlossen!'));

  note(
    `• Authentifizierter User: ${p.bold(p.white(lldapUsername))}\\n` +
    `• Step-CA Authority:      ${p.cyan(finalStepCaUrl)}\\n` +
    `• FastMCP Gateway:        ${p.cyan(gatewaySseUrl)}\\n` +
    `• SSH Host-Regeln:        ${p.cyan('~/.ssh/config')} (User: ${p.white(lldapUsername)})\\n` +
    `• Auto-konfiguriert:      ${p.cyan(detectedEditors.map(e => e.name).join(', '))}`,
    p.green('Deine Workstation ist startklar')
  );

  outro(
    p.cyan('Glückwunsch, ') + p.white(fullName) + p.cyan('! 🚀\\n') +
    p.gray('Öffne jetzt deinen AI-Editor und starte dein persönliches Training mit:\\n') +
    p.bold(p.green('👉 /bdbsaastraining'))
  );
}

main().catch(err => {
  console.error(p.red(`\\n❌ Fehler beim Setup: ${err.message}`));
  process.exit(1);
});
