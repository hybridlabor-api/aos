'use strict';
// Nightly memB ingest job: launchd calendar job (macOS), systemd user timer (Linux). Windows has no job (unverified scheduler).
// The job runs bin/aos-memb-ingest.mjs from ~/.agents/bin, which itself exits when memb is excluded.
const fs = require('fs');
const path = require('path');
const systemdUnits = require('./systemd-units');

const LABEL = 'com.bdb.memb.ingest';
const plistPath = (home) => path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
const scriptPath = (home) => path.join(home, '.agents', 'bin', 'aos-memb-ingest.mjs');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function plistXml({ node, script, logDir, hour = 3, minute = 30 }) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${esc(node)}</string>
        <string>${esc(script)}</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>${hour}</integer>
        <key>Minute</key>
        <integer>${minute}</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>${esc(path.join(logDir, 'ingest.stdout.log'))}</string>
    <key>StandardErrorPath</key>
    <string>${esc(path.join(logDir, 'ingest.stderr.log'))}</string>
</dict>
</plist>
`;
}

// Writes the job files; `run(cmd, args)` loads them (skipped when absent, e.g. in a test sandbox). Returns what was written.
async function install({ home, platform = process.platform, node = process.execPath, run = null }) {
    const logDir = path.join(home, '.memb');
    const script = scriptPath(home);
    fs.mkdirSync(logDir, { recursive: true });
    if (platform === 'darwin') {
        const p = plistPath(home);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, plistXml({ node, script, logDir }));
        if (run) { await run('launchctl', ['unload', p]).catch(() => {}); await run('launchctl', ['load', '-w', p]); }
        return { file: p };
    }
    if (platform === 'linux') {
        const svc = `${LABEL}.service`;
        const timer = `${LABEL}.timer`;
        const sp = systemdUnits.unitPath(home, svc);
        const tp = systemdUnits.unitPath(home, timer);
        fs.mkdirSync(path.dirname(sp), { recursive: true });
        fs.writeFileSync(sp, systemdUnits.buildUserUnit({ description: 'memB nightly ingest', execStart: [node, script], type: 'oneshot', restart: 'no', logOut: path.join(logDir, 'ingest.stdout.log'), logErr: path.join(logDir, 'ingest.stderr.log') }).replace('\n[Install]\nWantedBy=default.target\n', ''));
        fs.writeFileSync(tp, systemdUnits.buildTimerUnit({ description: 'memB nightly ingest', unit: svc, onBootSec: '15min', onUnitActiveSec: '24h' }));
        if (run) await systemdUnits.enableUnit(run, timer);
        return { file: tp };
    }
    return { file: null };
}

module.exports = { LABEL, plistPath, scriptPath, plistXml, install };
