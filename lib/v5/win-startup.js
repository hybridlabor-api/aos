'use strict';
// Windows autostart for the v5 services: a hidden .vbs in the user's Startup folder, the route the other AOS
// daemons already take (installer.js). schtasks /Create needs admin rights on a standard account ("Access denied").
const path = require('path');

const startupDir = (ctx) => path.join((ctx.env && ctx.env.APPDATA) || path.join(ctx.home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const vbsPath = (ctx, label) => path.join(startupDir(ctx), `${label}.vbs`);

// In a VBS string literal "" is one quote, so every argv element is double-quoted on the command line; window 0 = hidden.
const buildVbs = (cwd, argv) => `Set WshShell = CreateObject("WScript.Shell")\r\nWshShell.CurrentDirectory = "${cwd}"\r\nWshShell.Run "${argv.map((a) => `""${a}""`).join(' ')}", 0, False\r\n`;

// Lower-case, backslashes only: Windows paths differ in case and separator between the .vbs and the process list.
const norm = (s) => String(s).toLowerCase().replace(/\//g, '\\');
// Pure twin of the PowerShell match below.
const matchesCmd = (cmd, paths) => !!cmd && paths.some((p) => norm(cmd).includes(norm(p)));

// Only processes owned by the current user; an owner that cannot be read is not stopped (another profile may own it).
const OWNED = `$o = Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue; $o -and $o.User -and (($o.Domain + '\\' + $o.User) -eq ($env:USERDOMAIN + '\\' + $env:USERNAME))`;

// PowerShell args that stop every process of THIS user whose command line contains one of the paths (plain
// case-insensitive substring, no wildcards). The PowerShell process itself carries the paths in its own
// command line, hence the $PID exclusion.
const stopArgs = (paths) => ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process | Where-Object { $c = $_.CommandLine; $_.ProcessId -ne $PID -and $c -and (${paths.map((p) => `$c.ToLower().Replace('/','\\').Contains('${norm(p).replace(/'/g, "''")}')`).join(' -or ')}) -and $(${OWNED}) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`];

// Same for a -like pattern (the .bat launchers).
const stopLikeArgs = (pattern) => ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '${String(pattern).replace(/'/g, "''")}' -and $(${OWNED}) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`];

module.exports = { vbsPath, buildVbs, stopArgs, stopLikeArgs, matchesCmd, norm };
