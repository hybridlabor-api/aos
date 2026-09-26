#!/usr/bin/env node
// Validate themes/aos.json against pi's theme schema contract.
//
// Two things go wrong when you re-skin a pi theme, and neither is obvious:
// a missing required role makes pi reject the whole theme, and a role pointing
// at a var that does not exist looks fine in the file but resolves to nothing
// at render time. This is a theme-tuning loop guard, not a schema validator --
// it checks the contract pi actually enforces, so it stays small.
//
//   node scripts/check-theme.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const themePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'themes', 'aos.json');

// pi's published theme-schema.json, trimmed to the enforced part: the required
// colour roles and the five value forms pi accepts (hex, rgb()/oklsl(),
// 256-colour index, var reference, terminal default).
const REQUIRED = [
    'accent', 'border', 'borderAccent', 'borderMuted', 'success', 'error', 'warning',
    'muted', 'dim', 'text', 'thinkingText', 'selectedBg', 'userMessageBg',
    'userMessageText', 'customMessageBg', 'customMessageText', 'customMessageLabel',
    'toolPendingBg', 'toolSuccessBg', 'toolErrorBg', 'toolTitle', 'toolOutput',
    'mdHeading', 'mdLink', 'mdLinkUrl', 'mdCode', 'mdCodeBlock', 'mdCodeBlockBorder',
    'mdQuote', 'mdQuoteBorder', 'mdHr', 'mdListBullet', 'toolDiffAdded',
    'toolDiffRemoved', 'toolDiffContext', 'syntaxComment', 'syntaxKeyword',
    'syntaxFunction', 'syntaxVariable', 'syntaxString', 'syntaxNumber', 'syntaxType',
    'syntaxOperator', 'syntaxPunctuation', 'thinkingOff', 'thinkingMinimal',
    'thinkingLow', 'thinkingMedium', 'thinkingHigh', 'thinkingXhigh', 'bashMode',
];
const isLiteral = (v) =>
    v === '' || typeof v === 'number' ||
    /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ||
    /^(rgb|oklsl)\(/.test(v);

const theme = JSON.parse(readFileSync(themePath, 'utf8'));
const colors = theme.colors ?? {};
const vars = theme.vars ?? {};

const problems = [];
if (theme.name !== 'aos') problems.push(`name is "${theme.name}", expected "aos"`);
for (const role of REQUIRED) {
    if (!(role in colors)) problems.push(`missing required color role: ${role}`);
}
for (const [role, value] of Object.entries(colors)) {
    if (typeof value !== 'string') problems.push(`${role}: expected a string, got ${typeof value}`);
    else if (!isLiteral(value) && !(value in vars)) problems.push(`${role}: references undefined var "${value}"`);
}
for (const [name, value] of Object.entries(vars)) {
    if (typeof value === 'string' && value.startsWith('#') && !isLiteral(value)) problems.push(`var ${name}: malformed hex "${value}"`);
    if (typeof value === 'string' && !value.startsWith('#') && !isLiteral(value) && !(value in vars)) {
        problems.push(`var ${name}: references undefined var "${value}"`);
    }
}

if (problems.length) {
    for (const p of problems) console.error(`  ${p}`);
    console.error(`\ntheme invalid (${problems.length} problem${problems.length > 1 ? 's' : ''})`);
    process.exit(1);
}
console.log(`theme "${theme.name}" valid -- ${Object.keys(colors).length} roles, ${Object.keys(vars).length} vars, ${REQUIRED.length} required present`);
