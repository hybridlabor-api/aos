'use strict';
// Windows autostart for the v5 services: a hidden .vbs in the user's Startup folder, the route the other AOS
// daemons already take (installer.js). schtasks /Create needs admin rights on a standard account ("Access denied").
const path = require('path');

const startupDir = (ctx) => path.join((ctx.env && ctx.env.APPDATA) || path.join(ctx.home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const vbsPath = (ctx, label) => path.join(startupDir(ctx), `${label}.vbs`);

// In a VBS string literal "" is one quote, so every argv element is double-quoted on the command line; window 0 = hidden.
const buildVbs = (cwd, argv) => `Set WshShell = CreateObject("WScript.Shell")\r\nWshShell.CurrentDirectory = "${cwd}"\r\nWshShell.Run "${argv.map((a) => `""${a}""`).join(' ')}", 0, False\r\n`;

// PowerShell args that stop every process whose command line contains one of the paths (plain substring, no
// wildcards). The PowerShell process itself carries the paths in its own command line, hence the $PID exclusion.
const stopArgs = (paths) => ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process | Where-Object { $c = $_.CommandLine; $_.ProcessId -ne $PID -and $c -and (${paths.map((p) => `$c.Contains('${String(p).replace(/'/g, "''")}')`).join(' -or ')}) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`];

module.exports = { vbsPath, buildVbs, stopArgs };
