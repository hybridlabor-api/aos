'use strict';
// Windows system tools by absolute path, so a planted powershell.exe/taskkill.exe earlier on PATH or in the cwd is never run.
const path = require('path');

const REL = {
    powershell: ['WindowsPowerShell', 'v1.0', 'powershell.exe'],
    taskkill: ['taskkill.exe'],
};

// `name` may carry .exe. Anything else, and every non-Windows platform, comes back unchanged.
function winBin(name, { platform = process.platform, env = process.env } = {}) {
    if (platform !== 'win32') return name;
    const rel = REL[String(name).toLowerCase().replace(/\.exe$/, '')];
    if (!rel) return name;
    const key = Object.keys(env).find((k) => k.toLowerCase() === 'systemroot');
    return path.win32.join((key && env[key]) || 'C:\\Windows', 'System32', ...rel);
}

// Body of a PowerShell single-quoted literal: PowerShell also treats the typographic quotes as quote characters.
const psQuote = (s) => String(s).replace(/['\u2018\u2019\u201A\u201B]/g, (c) => c + c);

module.exports = { winBin, psQuote };
