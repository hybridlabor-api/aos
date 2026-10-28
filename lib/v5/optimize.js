'use strict';
// End of `aos update`: when the context profile is unset or the router still uses the shipped table,
// ask once whether to optimize now. Same once-marker style as askUpdatesOnce (optimizeAsked).
const fs = require('fs');
const path = require('path');
const profile = require('./profile');

const SUGGEST = { minimal: 'small', standard: 'full', full: 'orchestrator' };

function needed(home, st) {
    return !st.context || !fs.existsSync(path.join(home, '.aos', 'router.json'));
}

// Returns 'asked-yes' | 'asked-no' | 'hint' | null. Without a TTY or unattended only the hint line is printed.
async function optimizeOnce({ home, ui, unattended = false, tty = false, write = () => {}, dryRun = false } = {}) {
    const st = profile.readSettings(home, () => {});
    if (dryRun || st.optimizeAsked === true || !needed(home, st)) return null;
    const p = SUGGEST[profile.profileOf(st)] || 'full';
    if (!tty || unattended || !ui || typeof ui.select !== 'function') {
        write(`Optimize: aos context ${p} (context profile) and aos setup (router). Asked interactively once.\n`);
        return 'hint';
    }
    const v = await ui.select(`Optimize now? (context profile ${p}, router setup)`, [
        { value: 'yes', label: `yes (context profile ${p}, router setup)` },
        { value: 'no', label: 'no (asked once, never again)' },
    ], 'yes');
    if (v !== 'yes' && v !== 'no') return null;
    profile.writeSettings(home, { ...profile.readSettings(home, () => {}), optimizeAsked: true });
    if (v === 'no') return 'asked-no';
    require('./context-profiles').contextCommand([p], { home, write });
    write('Router setup: run aos setup to pick the router preset.\n');
    return 'asked-yes';
}

module.exports = { optimizeOnce, needed, SUGGEST };
