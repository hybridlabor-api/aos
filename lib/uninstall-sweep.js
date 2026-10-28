'use strict';
// Empty-directory pass of aos-uninstall. A directory is considered only when it is an ancestor of a path AOS
// recorded (install manifest, generated-file record), and it is removed only while it is empty at that moment
// (rmdir, never recursive). Nothing at or above $HOME, no harness root, and nothing behind a symlink or junction.
const fs = require('fs');
const nodePath = require('path');

// Shallow dirs other tools own: ~/.config/<tool>, ~/Library/<x>, ~/AppData/<Roaming|Local>/<x>, ~/.local/<x>.
function isForeignRoot(segs) {
    const first = segs[0];
    if (first === '.config' || first === 'Library' || first === '.local') return segs.length <= 2;
    if (first === 'AppData') return segs.length <= 3;
    return false;
}

// Directories to try, deepest first, as segments below home. `platform` selects the path flavour so the
// Windows rules (backslashes, case-insensitive drive and names) are testable anywhere.
function candidateDirs(home, files, platform = process.platform) {
    const P = platform === 'win32' ? nodePath.win32 : nodePath.posix;
    const fold = (s) => (platform === 'win32' ? s.toLowerCase() : s);
    const out = new Map();
    for (const f of files) {
        if (typeof f !== 'string' || !f) continue;
        let rel = P.relative(home, P.resolve(f));
        if (!rel || rel === '..' || rel.startsWith('..' + P.sep) || P.isAbsolute(rel)) continue; // outside $HOME or $HOME itself
        let segs = rel.split(P.sep).filter(Boolean);
        for (let n = segs.length - 1; n >= 2; n--) { // n = depth of the ancestor; depth 1 (~/.claude, ~/.agents, ...) never
            const s = segs.slice(0, n);
            if (isForeignRoot(s)) continue;
            out.set(fold(s.join('/')), s);
        }
    }
    return [...out.values()].sort((a, b) => b.length - a.length).map((s) => P.join(home, ...s));
}

// Real directory chain from home down to dir: every component an actual directory, none a link or junction.
function plainChain(home, dir, platform, cache) {
    const P = platform === 'win32' ? nodePath.win32 : nodePath.posix;
    const segs = P.relative(home, dir).split(P.sep).filter(Boolean);
    let cur = home;
    for (const s of segs) {
        cur = P.join(cur, s);
        if (!cache.has(cur)) {
            let ok = false;
            try { const st = fs.lstatSync(cur); ok = st.isDirectory() && !st.isSymbolicLink(); } catch { /* absent */ }
            cache.set(cur, ok);
        }
        if (!cache.get(cur)) return false;
    }
    return true;
}

// `alsoGone`: paths a dry run pretends are already deleted, so the preview matches what the real pass will do.
function pruneRecordedEmptyDirs({ home, files, dry = false, platform = process.platform, alsoGone = [] } = {}) {
    const removed = [];
    const gone = new Set(alsoGone);
    const cache = new Map();
    const P = platform === 'win32' ? nodePath.win32 : nodePath.posix;
    for (const dir of candidateDirs(home, files, platform)) {
        if (!plainChain(home, dir, platform, cache)) continue;
        let entries;
        try { entries = fs.readdirSync(dir); } catch { continue; }
        if (!entries.every((e) => gone.has(P.join(dir, e)))) continue;
        try { if (!dry) fs.rmdirSync(dir); } catch { continue; } // raced: something appeared, it stays
        gone.add(dir);
        removed.push(dir);
    }
    return { removed };
}

// Roots other tools share; never a purge target themselves, only named files and folders inside them.
const SHARED_ROOTS = new Set(['.claude', '.codex', '.gemini', '.agents', '.config', '.cache', '.local', '.aos', 'library', 'appdata', 'documents', 'desktop', 'downloads']);

// One explicitly listed AOS-owned path under --purge. Refused: $HOME or anything above it, a shared root
// (~/.claude, ~/.cache, ...), and any path reached through a symlink or junction. A link at the path itself is
// unlinked, never followed.
function guardedRemove({ home, target, dry = false, platform = process.platform }) {
    const P = platform === 'win32' ? nodePath.win32 : nodePath.posix;
    const abs = P.resolve(target);
    const rel = P.relative(home, abs);
    if (!rel || rel === '..' || rel.startsWith('..' + P.sep) || P.isAbsolute(rel)) return 'refused';
    const segs = rel.split(P.sep).filter(Boolean);
    if (segs.length === 1 && SHARED_ROOTS.has(segs[0].toLowerCase())) return 'refused';
    if (!plainChain(home, P.dirname(abs), platform, new Map())) return 'refused';
    try { fs.lstatSync(abs); } catch { return 'absent'; }
    if (!dry) fs.rmSync(abs, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    return 'removed';
}

// True when a path below home is reached through a symlink or junction (or a non-directory) in its parents.
function behindLink({ home, file, platform = process.platform }) {
    const P = platform === 'win32' ? nodePath.win32 : nodePath.posix;
    const rel = P.relative(home, P.resolve(file));
    if (!rel || rel === '..' || rel.startsWith('..' + P.sep) || P.isAbsolute(rel)) return false; // not under home: not judged here
    return !plainChain(home, P.dirname(P.resolve(file)), platform, new Map());
}

module.exports = { behindLink, candidateDirs, pruneRecordedEmptyDirs, guardedRemove };
