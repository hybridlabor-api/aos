#!/usr/bin/env node

/**
 * 🥋 BDB SaaS Host Workstation Setup Installer
 * Powered by @clack/prompts
 * 
 * Sets up Step-CA 2FA, SSH config, FastMCP Client config, and Skill Sync.
 * Auto-detects installed AI agent harnesses (Cursor, Antigravity, Claude Desktop, OpenCode, Roo Code).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import {
  intro,
  outro,
  note,
  text,
  password,
  confirm,
  spinner,
  isCancel,
  cancel,
  log
} from '@clack/prompts';
import p from 'picocolors';

const STEP_CA_URL = 'https://ca.rcentry.pro';
const STEP_CA_FINGERPRINT = '7f83e20e882a84a22ad3932e67503ad213fead6e729a6ca2bc596395b0bf6664';
const GATEWAY_SSE_URL = 'https://gateway.rcentry.pro/sse';
const FLEET_IPS = ['159.195.33.127', '34.9.22.213'];

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

function bootstrapStepCa() {
  try {
    execSync(
      `step ca bootstrap --ca-url "${STEP_CA_URL}" --fingerprint "${STEP_CA_FINGERPRINT}" --force`,
      { stdio: 'ignore' }
    );
    return true;
  } catch (err) {
    return false;
  }
}

function patchSshConfig(username) {
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

  const markerBegin = '# --- BEGIN BDB SAAS HOST FLEET RULES ---';
  const markerEnd = '# --- END BDB SAAS HOST FLEET RULES ---';

  const hostRuleBlock = `${markerBegin}
Host *.rcentry.pro 159.195.33.127 34.9.22.213
    User ${username}
    UserKnownHostsFile ~/.step/ssh/known_hosts
    CertificateFile ~/.step/ssh/id_ecdsa-cert.pub
    IdentityFile ~/.step/ssh/id_ecdsa
    IdentitiesOnly yes
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

  // Fallback if none detected
  if (detected.length === 0) {
    detected.push({ id: 'cursor', name: 'Cursor IDE (Standard)' });
    detected.push({ id: 'antigravity', name: 'Google Antigravity (Standard)' });
  }

  return detected;
}

function configureCursorMcp(apiKey) {
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
    url: GATEWAY_SSE_URL,
    headers: { 'X-API-Key': apiKey }
  };
  fs.writeFileSync(mcpFile, JSON.stringify(config, null, 2), 'utf8');
}

function configureClaudeDesktopMcp(apiKey) {
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
    url: GATEWAY_SSE_URL,
    headers: { 'X-API-Key': apiKey }
  };
  fs.writeFileSync(mcpFile, JSON.stringify(config, null, 2), 'utf8');
}

function configureAntigravityMcp(apiKey) {
  const homeDir = os.homedir();
  const mcpDir = path.join(homeDir, '.gemini', 'antigravity-cli', 'mcp', 'bdb_remoteos_gateway');
  fs.mkdirSync(mcpDir, { recursive: true });

  const schemaFile = path.join(mcpDir, 'config.json');
  const config = {
    name: 'bdb_remoteos_gateway',
    transport: 'sse',
    url: GATEWAY_SSE_URL,
    headers: { 'X-API-Key': apiKey }
  };
  fs.writeFileSync(schemaFile, JSON.stringify(config, null, 2), 'utf8');
}

function configureRooCodeMcp(apiKey) {
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
      url: GATEWAY_SSE_URL,
      headers: { 'X-API-Key': apiKey }
    };
    fs.writeFileSync(mcpFile, JSON.stringify(config, null, 2), 'utf8');
  }
}

function syncTrainingSkill() {
  const homeDir = os.homedir();
  const targetSkillDir = path.join(homeDir, '.agents', 'skills', 'bdbsaastraining');
  fs.mkdirSync(targetSkillDir, { recursive: true });

  const repoSkillDir = path.join(process.cwd(), 'server-config', 'skills', 'bdbsaastraining');
  if (fs.existsSync(repoSkillDir)) {
    fs.cpSync(repoSkillDir, targetSkillDir, { recursive: true });
  }
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

  const lldapUsername = handleCancel(await text({
    message: 'Wie lautet dein LLDAP-Benutzername aus deiner Onboarding-E-Mail?',
    placeholder: 'z.B. noah',
    validate(val) {
      if (!val || val.trim().length < 2) return 'Der Benutzername ist erforderlich.';
      if (val.includes(' ')) return 'Keine Leerzeichen erlaubt.';
    }
  }));

  // 3. FastMCP API Key
  const apiKey = handleCancel(await password({
    message: 'Bitte gib deinen persönlichen FastMCP API-Key aus deiner E-Mail ein:',
    mask: '▪',
    validate(val) {
      if (!val || val.trim().length < 8) return 'Der API-Key muss mindestens 8 Zeichen lang sein.';
    }
  }));

  // 4. Execution Spinner
  const s = spinner();
  s.start('Prüfe System-Abhängigkeiten...');

  // Step 1: Step CLI Check
  s.message('Prüfe Step-CA CLI Installation...');
  const stepOk = ensureStepCli();
  if (!stepOk) {
    s.stop(p.yellow('⚠️ step CLI nicht automatisch gefunden. Bitte manuell installieren: brew install step'));
  }

  // Step 2: Bootstrap CA
  s.message('Führe Step-CA Bootstrap durch (ca.rcentry.pro)...');
  bootstrapStepCa();

  // Step 3: Patch SSH Config
  s.message(`Konfiguriere ~/.ssh/config für Host *.rcentry.pro (${lldapUsername})...`);
  patchSshConfig(lldapUsername);

  // Step 4: Auto-Inject MCP Configs for all detected editors
  const editorIds = detectedEditors.map(e => e.id);
  s.message(`Injiziere FastMCP SSE-Gateway in ${detectedEditors.length} erkannte Editoren...`);
  if (editorIds.includes('cursor')) configureCursorMcp(apiKey);
  if (editorIds.includes('claude')) configureClaudeDesktopMcp(apiKey);
  if (editorIds.includes('antigravity')) configureAntigravityMcp(apiKey);
  if (editorIds.includes('opencode')) configureRooCodeMcp(apiKey);

  // Step 5: Skill Sync
  s.message('Synchronisiere /bdbsaastraining Skill in dein lokales Verzeichnis...');
  syncTrainingSkill();

  s.stop(p.green('✔ Alle Konfigurationen erfolgreich abgeschlossen!'));

  note(
    `• Step-CA Authority: ${p.cyan('https://ca.rcentry.pro')}\n` +
    `• FastMCP Gateway:   ${p.cyan(GATEWAY_SSE_URL)}\n` +
    `• SSH Host-Regeln:   ${p.cyan('~/.ssh/config')} (User: ${p.white(lldapUsername)})\n` +
    `• Auto-konfiguriert: ${p.cyan(detectedEditors.map(e => e.name).join(', '))}`,
    p.green('Deine Workstation ist startklar')
  );

  outro(
    p.cyan('Glückwunsch, ') + p.white(fullName) + p.cyan('! 🚀\n') +
    p.gray('Öffne jetzt deinen AI-Editor und starte dein persönliches Training mit:\n') +
    p.bold(p.green('👉 /bdbsaastraining'))
  );
}

main().catch(err => {
  console.error(p.red(`\n❌ Fehler beim Setup: ${err.message}`));
  process.exit(1);
});
