'use strict';
// Post-update guidance: shipped release notes (docs/whats-new.json) plus detected optimization hints.
const fs = require('fs');
const path = require('path');

const NOTES = path.join(__dirname, '..', 'docs', 'whats-new.json');
const markerPath = (home) => path.join(home, '.aos', 'cache', 'last-update.json');
const MAX_LINES = 6;

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; } }

function detectHints(home) {
    const { readSettings, gateOf } = require('./v5/profile');
    const st = readSettings(home);
    const hints = [];
    if (!fs.existsSync(path.join(home, '.aos', 'status.json'))) hints.push({ text: 'Hub supervisor is not running (services are not watched)', cmd: 'aos hub' });
    if (!st.context) hints.push({ text: 'Context profile is unset (default full, ~62k startup tokens)', cmd: 'aos context' });
    if (gateOf(st) === 'off') hints.push({ text: 'go-gate is off', cmd: 'aos (Settings > go-gate)' });
    if (!fs.existsSync(path.join(home, '.aos', 'router.json'))) hints.push({ text: 'Router uses the shipped default table', cmd: 'aos setup' });
    return hints;
}

function notesFor(version, file = NOTES) {
    const all = readJson(file) || {};
    return Array.isArray(all[version]) ? all[version] : [];
}

function whatsNewLines({ home, version, notesFile }) {
    const hints = detectHints(home);
    const items = notesFor(version, notesFile);
    const lines = items.slice(0, MAX_LINES).map((n) => `  - ${n.title}: ${n.how}${n.cmd ? ` (${n.cmd})` : ''}`);
    const out = [];
    if (lines.length) out.push(`What's new in AOS ${version}:`, ...lines, ...(items.length > MAX_LINES ? [`  ... ${items.length - MAX_LINES} more in docs/whats-new.json`] : []));
    if (hints.length) out.push('Optimize:', ...hints.slice(0, MAX_LINES).map((h) => `  - ${h.text} -> ${h.cmd}`));
    if (out.length) out.push('Run `aos setup` to optimize your setup.');
    return { lines: out, hints: hints.length };
}

// Prints the block and leaves a marker for the SessionStart hint; never throws.
function announceUpdate({ home, version, write, now = Date.now(), notesFile }) {
    try {
        const { lines, hints } = whatsNewLines({ home, version, notesFile });
        if (lines.length) write(`${lines.join('\n')}\n`);
        fs.mkdirSync(path.dirname(markerPath(home)), { recursive: true });
        fs.writeFileSync(markerPath(home), JSON.stringify({ version, hints, t: now, shown: false }));
    } catch { /* guidance is optional */ }
}

module.exports = { announceUpdate, whatsNewLines, detectHints, markerPath };
