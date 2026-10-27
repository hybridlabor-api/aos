'use strict';
// Managed "AOS harness rules" block for ~/.gemini/RULES.md and ~/.gemini/GEMINI.md.
// Marker-delimited so an update replaces it in place without touching user content,
// and `aos uninstall` can remove it without deleting a user's own file.

const START = '<!-- aos:harness-rules:start -->';
const END = '<!-- aos:harness-rules:end -->';

function hasHarnessRulesBlock(content) {
    return String(content || '').includes(START);
}

function upsertHarnessRulesBlock(content, body) {
    const text = String(content || '');
    const block = `${START}\n${String(body || '').replace(/\s+$/, '')}\n${END}`;
    const s = text.indexOf(START);
    const e = s === -1 ? -1 : text.indexOf(END, s);
    if (s !== -1 && e !== -1) return text.slice(0, s) + block + text.slice(e + END.length);
    if (!text.trim()) return `${block}\n`;
    return `${text.replace(/\s+$/, '')}\n\n${block}\n`;
}

function stripHarnessRulesBlock(content) {
    const text = String(content || '');
    const s = text.indexOf(START);
    const e = s === -1 ? -1 : text.indexOf(END, s);
    if (s === -1 || e === -1) return text;
    const before = text.slice(0, s);
    const after = text.slice(e + END.length).replace(/^(?:[ \t]*\r?\n)+/, '');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const head = before.trim() === '' ? '' : before.replace(/(?:\r?\n[ \t]*)+$/, eol);
    if (!head) return after;
    if (!after) return head;
    return `${head}${eol}${after}`;
}

// Upsert the managed block into one target file, preserving any user content around it.
// Returns true when the file changed.
function writeManagedRulesFile(target, body, fsModule = require('fs'), pathModule = require('path')) {
    fsModule.mkdirSync(pathModule.dirname(target), { recursive: true });
    const existing = fsModule.existsSync(target) ? fsModule.readFileSync(target, 'utf8') : '';
    const next = upsertHarnessRulesBlock(existing, body);
    if (next !== existing) fsModule.writeFileSync(target, next);
    return next !== existing;
}

module.exports = { START, END, hasHarnessRulesBlock, upsertHarnessRulesBlock, stripHarnessRulesBlock, writeManagedRulesFile };
