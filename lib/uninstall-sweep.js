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
    if (dry) return 'removed';
    // A symlink or junction at the target is removed itself and never followed.
    let st; try { st = fs.lstatSync(abs); } catch { return 'absent'; }
    if (st.isSymbolicLink()) {
        try { fs.unlinkSync(abs); } catch { fs.rmdirSync(abs); } // a Windows junction directory needs rmdir
        return 'removed';
    }
    fs.rmSync(abs, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    return 'removed';
}

// True when a path is reached through a symlink or junction (or a non-directory) in its parents.
// Below home the chain is checked from home; elsewhere from the filesystem root, skipping the first component
// (OS-level links such as /tmp or /var on macOS).
function behindLink({ home, file, platform = process.platform }) {
    const P = platform === 'win32' ? nodePath.win32 : nodePath.posix;
    const abs = P.resolve(file);
    const rel = P.relative(home, abs);
    if (rel && rel !== '..' && !rel.startsWith('..' + P.sep) && !P.isAbsolute(rel)) return !plainChain(home, P.dirname(abs), platform, new Map());
    const root = P.parse(abs).root;
    const segs = P.relative(root, P.dirname(abs)).split(P.sep).filter(Boolean);
    let cur = root;
    for (let i = 0; i < segs.length; i++) {
        cur = P.join(cur, segs[i]);
        if (i === 0) continue;
        // Fail closed: only a missing component (nothing to follow) is fine; any other error counts as a link.
        try { const st = fs.lstatSync(cur); if (!st.isDirectory() || st.isSymbolicLink()) return true; } catch (e) { return e && e.code === 'ENOENT' ? false : true; }
    }
    return false;
}

// Why a recorded path must not be deleted, or null. Manifest entries are data from disk, not trusted.
function refuseManifestPath({ home, p, entry, platform = process.platform }) {
    const P = platform === 'win32' ? nodePath.win32 : nodePath.posix;
    if (!entry || typeof entry.sha256 !== 'string' || !entry.sha256) return 'no recorded hash';
    if (typeof p !== 'string' || !p.trim() || p.startsWith('~') || !P.isAbsolute(p)) return 'not an absolute path';
    const abs = P.resolve(p);
    if (P.parse(abs).root === abs || P.parse(abs).root.toLowerCase() === abs.toLowerCase()) return 'a filesystem root';
    // $HOME or any ancestor of it, compared case-insensitively (a case-variant HOME is still HOME on NTFS and APFS).
    const lower = (x) => P.resolve(x).toLowerCase();
    const a = lower(abs), h = lower(home);
    const atOrAbove = (x, y) => x === y || y.startsWith(x.endsWith(P.sep) ? x : x + P.sep);
    if (atOrAbove(a, h)) return '$HOME or above it';
    // What the path really is: 8.3 short names, extended-length (\\?\) prefixes, links and case variants all resolve to one name here.
    if (platform === process.platform) {
        const real = (x) => { try { return fs.realpathSync.native(x).replace(/^\\\\\?\\/, '').toLowerCase(); } catch { return null; } };
        const ra = real(abs), rh = real(home);
        if (ra && rh && atOrAbove(ra, rh)) return 'resolves to $HOME or above it';
    }
    return null;
}

// A config file that may hold user content is never deleted: it moves into ~/.aos/backups/<stamp>/ (same volume).
function moveToBackup({ home, file, stamp, platform = process.platform }) {
    const P = platform === 'win32' ? nodePath.win32 : nodePath.posix;
    if (behindLink({ home, file, platform })) return null;
    let st; try { st = fs.lstatSync(file); } catch { return null; }
    if (!st.isFile()) return null;
    const dir = P.join(home, '.aos', 'backups', stamp);
    const dest = P.join(dir, P.relative(home, P.resolve(file)).split(P.sep).join('__'));
    fs.mkdirSync(dir, { recursive: true });
    try { fs.renameSync(file, dest); } catch { fs.copyFileSync(file, dest); fs.unlinkSync(file); }
    return dest;
}

module.exports = { moveToBackup, behindLink, refuseManifestPath, candidateDirs, pruneRecordedEmptyDirs, guardedRemove };
