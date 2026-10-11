'use strict';

// systemd user units for the AOS background services, mirroring the launchd
// plists installer.js writes on macOS: same program, args, env and log files.
// The gateway's own unit lives in lib/v5/pkg-gateway.js (buildUnit) and stays
// there -- this helper is for the hub's four services.

const path = require('path');

// systemd ExecStart quoting: wrap in double quotes, escape backslash and quote.
const q = (s) => `"${String(s).replace(/["\\]/g, '\\$&')}"`;

function buildUserUnit({ description, execStart, workingDirectory, env = {}, restart = 'always', type, logOut, logErr }) {
    const lines = ['[Unit]', `Description=${description}`, '', '[Service]'];
    if (type) lines.push(`Type=${type}`);
    lines.push(`ExecStart=${execStart.map(q).join(' ')}`);
    for (const [k, v] of Object.entries(env)) lines.push(`Environment=${q(`${k}=${v}`)}`);
    if (workingDirectory) lines.push(`WorkingDirectory=${workingDirectory}`);
    lines.push(`Restart=${restart}`);
    if (logOut) lines.push(`StandardOutput=append:${logOut}`);
    if (logErr) lines.push(`StandardError=append:${logErr}`);
    lines.push('', '[Install]', 'WantedBy=default.target', '');
    return lines.join('\n');
}

// Timer units pair with a Type=oneshot service (the OpenWiki daemon pattern).
function buildTimerUnit({ description, unit, onBootSec, onUnitActiveSec }) {
    return [
        '[Unit]', `Description=${description}`, '',
        '[Timer]',
        `OnBootSec=${onBootSec}`,
        `OnUnitActiveSec=${onUnitActiveSec}`,
        `Unit=${unit}`,
        '',
        '[Install]', 'WantedBy=timers.target', '',
    ].join('\n');
}

const unitPath = (home, name) => path.join(home, '.config', 'systemd', 'user', name);

async function enableUnit(run, name) {
    await run('systemctl', ['--user', 'daemon-reload']);
    return run('systemctl', ['--user', 'enable', '--now', name]);
}

async function disableUnit(run, name) {
    return run('systemctl', ['--user', 'disable', '--now', name]);
}

module.exports = { buildUserUnit, buildTimerUnit, unitPath, enableUnit, disableUnit };
