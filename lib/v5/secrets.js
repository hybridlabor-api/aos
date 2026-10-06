'use strict';
// One question per secret, ever: stored value -> legacy value -> remembered skip -> ask once.
const { secretsPath, readSecretsFile, setSecret } = require('../mcp-secrets');

const SKIPPED = 'AOS_SKIPPED_KEYS';
const read = (home) => readSecretsFile(secretsPath(home)).vars;
// A file that exists but fails the permission/owner checks: never asked into, never written.
const refusal = (home) => { const r = readSecretsFile(secretsPath(home)); return r.state === 'refused' ? `secrets file refused (permissions/owner): ${r.reason}` : null; };
const skippedOf = (vars) => String(vars[SKIPPED] || '').split(',').map((s) => s.trim()).filter(Boolean);

// An ask() answer that is not a string (Back, Esc) is "not answered": nothing stored, nothing skipped.
async function prompt(key, { home, ask }) {
    if (refusal(home)) return '';
    const answer = await ask(key);
    if (typeof answer !== 'string') return '';
    const value = answer.trim();
    const file = secretsPath(home);
    if (!value && read(home)[key]) return read(home)[key];
    const skipped = skippedOf(read(home)).filter((k) => k !== key);
    if (value) { setSecret(file, key, value); if (skipped.length !== skippedOf(read(home)).length) setSecret(file, SKIPPED, skipped.join(',')); }
    else setSecret(file, SKIPPED, [...skipped, key].join(','));
    return value;
}

async function need(keys, { home, ask, legacy = {} }) {
    const out = {};
    for (const key of keys) {
        const vars = read(home);
        if (vars[key]) out[key] = vars[key];
        else if (legacy[key]) out[key] = legacy[key];
        else if (skippedOf(vars).includes(key)) out[key] = '';
        else out[key] = await prompt(key, { home, ask });
    }
    return out;
}

// Settings: ask even if a value is stored; a blank answer keeps a stored value, otherwise the key is remembered as "skipped".
const reask = (key, opts) => prompt(key, opts);

const isSkipped = (home, key) => skippedOf(read(home)).includes(key);

module.exports = { need, reask, isSkipped, refusal, SKIPPED };
