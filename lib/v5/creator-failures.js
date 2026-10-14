'use strict';
// Parses the creator extension's "Setup finished with N failure(s)" block (its installer.js finishSetup).
const OPTIONAL = ['TripoSR venv', 'Palmier Pro clone', 'OpenMontage venv'];

function failedEngines(output) {
    const lines = String(output || '').replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/);
    const i = lines.findIndex((l) => /Setup finished with \d+ failure\(s\)/.test(l));
    if (i < 0) return null;
    const names = [];
    for (const l of lines.slice(i + 1)) {
        const m = l.match(/^\s*- ([^:]+): /);
        if (m) names.push(m[1].trim());
        else if (!/^\s+Fix: /.test(l) && l.trim()) break;
    }
    return names;
}

// Returns a warning text when every failure is optional, else null.
function optionalOnlyWarning(output) {
    const names = failedEngines(output);
    if (!names || !names.length || !names.every((n) => OPTIONAL.includes(n))) return null;
    return `optional engines not set up: ${names.join(', ')} (rerun after installing a C++ toolchain / git / uv)`;
}

module.exports = { OPTIONAL, failedEngines, optionalOnlyWarning };
