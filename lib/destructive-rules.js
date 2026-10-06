'use strict';
// Managed "Destructive Actions" block for every instruction file AOS writes.
// Marker-delimited so an update can replace it in place without touching user content.

const START = '<!-- aos:destructive-actions:start -->';
const END = '<!-- aos:destructive-actions:end -->';

const BLOCK = `${START}
## Destructive Actions (non-negotiable)
- Never delete recursively outside your own worktree or task directory.
- Never build a delete path from HOME, USERPROFILE, TMPDIR or any other environment variable, and never from \`~\`. Delete only literal absolute paths you created in the same command, after checking they start with the intended prefix.
- Run installer, uninstaller and integration tests only inside a container, VM or a dedicated test user, never against the real home. Set a test HOME inline in the same command, never via export in an earlier call.
- A blocked command means stop and report. Never retry it in another form, another tool, another language or a script file.
- Subagents and workers delete nothing; cleanup is the dispatcher's job after the user's GO.
${END}`;

function upsertDestructiveBlock(content) {
    const text = String(content || '');
    const s = text.indexOf(START);
    const e = s === -1 ? -1 : text.indexOf(END, s);
    if (s !== -1 && e !== -1) return text.slice(0, s) + BLOCK + text.slice(e + END.length);
    if (!text.trim()) return `${BLOCK}\n`;
    return `${text.replace(/\s+$/, '')}\n\n${BLOCK}\n`;
}

module.exports = { START, END, BLOCK, upsertDestructiveBlock };
