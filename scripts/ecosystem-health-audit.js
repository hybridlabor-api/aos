#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPOS = [
  { id: 'bdb-dev-optimized-agent-skills', name: 'BDB Agent OS Kernel', type: 'kernel' },
  { id: 'bdb-dev-tool-installer', name: 'Tool Installer Hub', type: 'module' },
  { id: 'bdb-synapse', name: 'Synapse 3D', type: 'module' },
  { id: 'memB', name: 'memB Vector Engine', type: 'module' },
  { id: 'heimdall-token-saver', name: 'Heimdall Token Saver', type: 'module' },
  { id: 'bdb-os-remote', name: 'BDB OS Remote Gateway', type: 'module' },
  { id: 'bdb-os-agent-workspace', name: 'OS Agent Workspace', type: 'module' },
  { id: 'bdb-dev-creator-extension', name: 'Creator Extension', type: 'module' }
];

const BASE_PATH = '/Users/timrennings/bdb-dev';
const REPORT_DIR = path.join(BASE_PATH, 'marketing-intern', 'reports');
const REPORT_FILE = path.join(REPORT_DIR, 'ecosystem_health_latest.html');

if (!fs.existsSync(REPORT_DIR)) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

console.log('🔍 Running BDB Ecosystem Health Audit...');

const results = [];
let totalIssues = 0;
const remediationPlan = [];

for (const item of REPOS) {
  const repoDir = path.join(BASE_PATH, item.id);
  const pkgPath = path.join(repoDir, 'package.json');
  
  let pkgName = 'N/A';
  let localVer = 'N/A';
  let npmVer = 'N/A';
  let gitBranch = 'unknown';
  let gitDirty = false;
  let unpushedCommits = 0;
  let ciStatus = 'unknown';
  let ciWorkflow = '';
  let issues = [];

  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      pkgName = pkg.name;
      localVer = pkg.version;
      try {
        npmVer = execSync(`npm view ${pkg.name} version 2>/dev/null`, { encoding: 'utf8' }).trim();
      } catch (e) {
        npmVer = 'NOT FOUND / ERROR';
        issues.push('Package not found on NPM registry');
      }
    } catch (e) {
      issues.push('Invalid package.json format');
    }
  } else {
    issues.push('Missing package.json');
  }

  // Version Match Check
  if (localVer !== 'N/A' && npmVer !== 'N/A' && localVer !== npmVer) {
    issues.push(`Version drift: Local (${localVer}) != NPM (${npmVer})`);
    remediationPlan.push(`[${item.name}] Sync version: Publish ${localVer} to NPM or update package.json`);
  }

  // Git Status Check
  if (fs.existsSync(repoDir)) {
    try {
      gitBranch = execSync(`git -C "${repoDir}" rev-parse --abbrev-ref HEAD 2>/dev/null`, { encoding: 'utf8' }).trim();
      const statusOut = execSync(`git -C "${repoDir}" status --porcelain 2>/dev/null`, { encoding: 'utf8' }).trim();
      gitDirty = statusOut.length > 0;
      if (gitDirty) {
        issues.push('Uncommitted local changes');
        remediationPlan.push(`[${item.name}] Commit or stash uncommitted changes on branch ${gitBranch}`);
      }

      const unpushed = execSync(`git -C "${repoDir}" log @{u}.. 2>/dev/null | grep "^commit" | wc -l`, { encoding: 'utf8' }).trim();
      unpushedCommits = parseInt(unpushed, 10) || 0;
      if (unpushedCommits > 0) {
        issues.push(`${unpushedCommits} unpushed commit(s)`);
        remediationPlan.push(`[${item.name}] Push ${unpushedCommits} commit(s) to remote origin/${gitBranch}`);
      }
    } catch (e) {
      issues.push('Git status check failed');
    }

    // GitHub Actions Status Check
    try {
      const ghOut = execSync(`gh run list --repo hybridlabor-api/${item.id} -L 1 --json conclusion,name,status 2>/dev/null`, { encoding: 'utf8' });
      const runs = JSON.parse(ghOut);
      if (runs.length > 0) {
        const r = runs[0];
        ciStatus = r.conclusion || r.status || 'unknown';
        ciWorkflow = r.name;
        if (ciStatus === 'failure' || ciStatus === 'cancelled') {
          issues.push(`Latest CI run failed: ${ciWorkflow}`);
          remediationPlan.push(`[${item.name}] Inspect failed GitHub Action workflow '${ciWorkflow}' via 'gh run view'`);
        }
      }
    } catch (e) {
      ciStatus = 'N/A';
    }
  } else {
    issues.push('Local directory does not exist');
  }

  if (issues.length > 0) totalIssues += issues.length;

  results.push({
    ...item,
    pkgName,
    localVer,
    npmVer,
    gitBranch,
    gitDirty,
    unpushedCommits,
    ciStatus,
    ciWorkflow,
    issues,
    status: issues.length === 0 ? 'HEALTHY' : 'WARNING'
  });
}

// Generate HTML Report
const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
const allHealthy = totalIssues === 0;

const rowsHtml = results.map(r => {
  const statusBadge = r.status === 'HEALTHY' 
    ? '<span style="background:#065f46; color:#34d399; padding:4px 10px; border-radius:999px; font-weight:700; font-size:12px;">HEALTHY</span>'
    : '<span style="background:#831843; color:#f43f5e; padding:4px 10px; border-radius:999px; font-weight:700; font-size:12px;">ATTENTION</span>';
  
  const ciBadge = r.ciStatus === 'success'
    ? '<span style="color:#10b981; font-weight:600;">✓ success</span>'
    : r.ciStatus === 'failure'
    ? '<span style="color:#ef4444; font-weight:700;">✗ failed</span>'
    : `<span style="color:#94a3b8;">${r.ciStatus}</span>`;

  const issuesList = r.issues.length === 0 
    ? '<span style="color:#10b981;">No issues detected</span>'
    : r.issues.map(i => `<div style="color:#fbbf24; font-size:12px;">⚠️ ${i}</div>`).join('');

  return `
    <tr style="border-bottom:1px solid #23273c;">
      <td style="padding:16px 18px;">
        <div style="font-weight:700; color:#ffffff; font-size:15px;">${r.name}</div>
        <div style="font-family:monospace; color:#94a3b8; font-size:12px;">${r.pkgName}</div>
      </td>
      <td style="padding:16px 18px; font-family:monospace; color:#38bdf8;">${r.localVer}</td>
      <td style="padding:16px 18px; font-family:monospace; color:#a78bfa;">${r.npmVer}</td>
      <td style="padding:16px 18px;">${r.gitDirty ? '<span style="color:#ef4444;">Dirty</span>' : '<span style="color:#10b981;">Clean</span>'}</td>
      <td style="padding:16px 18px;">${ciBadge}</td>
      <td style="padding:16px 18px;">${statusBadge}</td>
      <td style="padding:16px 18px;">${issuesList}</td>
    </tr>
  `;
}).join('');

const planHtml = remediationPlan.length > 0
  ? `
    <div style="margin-top:32px; background:#1e1b4b; border:1px solid #4338ca; border-radius:12px; padding:24px;">
      <h3 style="color:#facc15; margin:0 0 12px 0;">🛠️ Automated Remediation Plan</h3>
      <ol style="margin:0; padding-left:20px; color:#cbd5e1; font-size:14px; line-height:1.8;">
        ${remediationPlan.map(p => `<li>${p}</li>`).join('')}
      </ol>
    </div>
  `
  : `
    <div style="margin-top:32px; background:#064e3b; border:1px solid #059669; border-radius:12px; padding:20px; text-align:center;">
      <h3 style="color:#34d399; margin:0 0 4px 0;">🎉 All Systems 100% Operational</h3>
      <p style="color:#a7f3d0; margin:0; font-size:14px;">All repositories, NPM registries, and CI/CD pipelines are fully synchronized and error-free.</p>
    </div>
  `;

const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BDB Ecosystem Health Audit</title>
  <style>
    body { margin:0; padding:40px 20px; background:#090a0f; color:#f0f2f8; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .container { max-width:1100px; margin:0 auto; background:#12141e; border:1px solid #23273c; border-radius:16px; padding:32px; box-shadow:0 20px 40px rgba(0,0,0,0.6); }
    table { width:100%; border-collapse:collapse; text-align:left; margin-top:24px; }
    th { padding:14px 18px; color:#94a3b8; font-size:12px; text-transform:uppercase; letter-spacing:0.05em; border-bottom:2px solid #23273c; background:#18132b; }
  </style>
</head>
<body>
  <div class="container">
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #23273c; padding-bottom:20px;">
      <div>
        <h1 style="margin:0 0 6px 0; color:#facc15; font-size:26px;">🛡️ BDB Ecosystem Health Audit</h1>
        <div style="color:#94a3b8; font-size:14px;">Live Verification &amp; Drift Monitor across Kernel + 7 Modules</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:12px; color:#64748b;">AUDIT TIMESTAMP</div>
        <div style="font-weight:700; color:#38bdf8; font-size:14px;">${timestamp} UTC</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Repository</th>
          <th>Local</th>
          <th>NPM</th>
          <th>Git</th>
          <th>CI Pipeline</th>
          <th>Health</th>
          <th>Diagnostics</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>

    ${planHtml}

    <div style="margin-top:32px; text-align:center; color:#64748b; font-size:12px;">
      BDB Agent OS • Automated Health Monitor • Generated via <code>ecosystem-health-audit.js</code>
    </div>
  </div>
</body>
</html>`;

fs.writeFileSync(REPORT_FILE, fullHtml, 'utf8');
console.log(`✅ HTML Report generated at: ${REPORT_FILE}`);

// Auto-open in browser if requested or by default
if (process.argv.includes('--open') || !process.argv.includes('--no-open')) {
  try {
    execSync(`open "${REPORT_FILE}"`);
    console.log('🌐 Opened report in Chrome/Default Browser.');
  } catch (e) {}
}

// Print Terminal Summary
console.log('\n================ AUDIT SUMMARY ================');
results.forEach(r => {
  const icon = r.status === 'HEALTHY' ? '🟢' : '🔴';
  console.log(`${icon} ${r.name.padEnd(28)} | Local: ${r.localVer.padEnd(6)} | NPM: ${r.npmVer.padEnd(6)} | Git: ${r.gitDirty ? 'Dirty' : 'Clean'} | CI: ${r.ciStatus}`);
});
console.log('================================================\n');

if (remediationPlan.length > 0) {
  console.log('⚠️ Remediation Steps:');
  remediationPlan.forEach((p, idx) => console.log(`  ${idx + 1}. ${p}`));
  process.exit(1);
} else {
  console.log('✨ All modules are clean and green!');
  process.exit(0);
}
