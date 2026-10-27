'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, execSync } = require('node:child_process');

const ELEVATED_GIT_HINT = "Git may be installed for another user or missing from this shell's PATH; open a normal (non-elevated) PowerShell or add Git\\cmd to the system PATH";

function isElevatedWindows({ execImpl = execFileSync } = {}) {
    try {
        execImpl('net.exe', ['session'], { stdio: 'ignore', windowsHide: true });
        return true;
    } catch {
        try {
            execImpl('net', ['session'], { stdio: 'ignore', windowsHide: true });
            return true;
        } catch {
            return false;
        }
    }
}

function isElevated({ platform = process.platform, execImpl = execFileSync } = {}) {
    if (platform === 'win32') {
        return isElevatedWindows({ execImpl });
    }
    return typeof process.getuid === 'function' && process.getuid() === 0;
}

function getGitInstallInstruction({
    platform = process.platform,
    elevated = isElevated({ platform }),
} = {}) {
    const isWin = platform === 'win32';
    const isMac = platform === 'darwin';

    const base = isWin
        ? 'Install Git via git-scm.com or winget install Git.Git'
        : isMac
            ? 'Install Git via brew install git / xcode-select --install'
            : 'Install Git via your package manager (e.g. apt install git / dnf install git)';

    if (isWin && elevated) {
        return `${base}\n${ELEVATED_GIT_HINT}`;
    }
    return base;
}

function prependPath(dir, env = process.env, platform = process.platform) {
    if (!dir) return;
    const delim = platform === 'win32' ? ';' : path.delimiter;
    const current = (env && (env.PATH || env.Path)) || '';
    const parts = current.split(delim).filter(Boolean);
    if (!parts.includes(dir)) {
        const next = current ? `${dir}${delim}${current}` : dir;
        if (env) {
            env.PATH = next;
            if ('Path' in env) env.Path = next;
        }
        if (env === process.env && process.env) {
            process.env.PATH = next;
        }
    }
}

function queryGitRegistryInstallPath(key, execImpl) {
    for (const bin of ['reg.exe', 'reg']) {
        try {
            const out = execImpl(bin, ['query', key, '/v', 'InstallPath'], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
                windowsHide: true,
                timeout: 3000,
            });
            const match = String(out || '').match(/InstallPath\s+REG_\w+\s+(.+)/i);
            if (match && match[1]) {
                return match[1].trim();
            }
        } catch {
            // key not found or reg.exe unavailable; continue
        }
    }
    return null;
}

function resolveWinFallback(binary, { platform = process.platform, env = process.env, fsImpl = fs, execImpl = execFileSync } = {}) {
    const p = path.win32;
    const baseName = String(binary || '').replace(/\.exe$/i, '').toLowerCase();

    const checkCandidate = (cand) => {
        if (!cand) return null;
        if (fsImpl.existsSync(cand)) return cand;
        if (platform === 'win32' && process.platform !== 'win32') {
            const posixCand = cand.replace(/\\/g, '/');
            if (fsImpl.existsSync(posixCand)) return posixCand;
        }
        return null;
    };

    if (baseName === 'git') {
        const programFiles = env.ProgramFiles || env.PROGRAMFILES || 'C:\\Program Files';
        const programFilesX86 = env['ProgramFiles(x86)'] || env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
        const localAppData = env.LOCALAPPDATA || (env.USERPROFILE ? p.join(env.USERPROFILE, 'AppData', 'Local') : '');

        const candidates = [];
        if (programFiles) {
            candidates.push(p.join(programFiles, 'Git', 'cmd', 'git.exe'));
        }
        if (programFilesX86) {
            candidates.push(p.join(programFilesX86, 'Git', 'cmd', 'git.exe'));
        }
        if (localAppData) {
            candidates.push(p.join(localAppData, 'Programs', 'Git', 'cmd', 'git.exe'));
        }

        for (const regKey of ['HKCU\\Software\\GitForWindows', 'HKLM\\Software\\GitForWindows']) {
            const installPath = queryGitRegistryInstallPath(regKey, execImpl);
            if (installPath) {
                candidates.push(p.join(installPath, 'cmd', 'git.exe'));
                candidates.push(p.join(installPath, 'bin', 'git.exe'));
            }
        }

        for (const cand of candidates) {
            const found = checkCandidate(cand);
            if (found) {
                return found;
            }
        }
    } else if (baseName === 'gh') {
        const programFiles = env.ProgramFiles || env.PROGRAMFILES || 'C:\\Program Files';
        const localAppData = env.LOCALAPPDATA || (env.USERPROFILE ? p.join(env.USERPROFILE, 'AppData', 'Local') : '');

        const candidates = [];
        if (programFiles) {
            candidates.push(p.join(programFiles, 'GitHub CLI', 'gh.exe'));
        }
        if (localAppData) {
            candidates.push(p.join(localAppData, 'Programs', 'GitHub CLI', 'gh.exe'));
        }

        for (const cand of candidates) {
            const found = checkCandidate(cand);
            if (found) {
                return found;
            }
        }
    }

    return null;
}

const firstLine = (out) => String(out || '').trim().split(/\r?\n/)[0].trim();

function findExecutable(binary, {
    platform = process.platform,
    env = process.env,
    fsImpl = fs,
    execImpl = execFileSync,
} = {}) {
    if (!binary || typeof binary !== 'string') return null;
    const trimmed = binary.trim();
    if (!trimmed) return null;

    if (platform === 'win32') {
        // 1. Try where.exe
        try {
            const out = execImpl('where.exe', [trimmed], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
                windowsHide: true,
                timeout: 5000,
            });
            const first = firstLine(out);
            if (first) return first;
        } catch {
            // where.exe failed or returned non-zero
        }

        // 2. Fallbacks for known tools (git, gh)
        const baseName = trimmed.replace(/\.exe$/i, '').toLowerCase();
        if (baseName === 'git' || baseName === 'gh') {
            const fallback = resolveWinFallback(baseName, { platform, env, fsImpl, execImpl });
            if (fallback) {
                prependPath(path.win32.dirname(fallback), env, platform);
                return fallback;
            }
        }
        return null;
    }

    // Non-win32 platforms
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(trimmed)) return null;

    try {
        const out = execImpl('which', [trimmed], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
            timeout: 5000,
        });
        const first = firstLine(out);
        if (first) return first;
    } catch {
        // which binary failed; try POSIX command -v
        try {
            const out = execSync(`command -v ${trimmed}`, {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
                windowsHide: true,
                timeout: 5000,
            });
            const first = firstLine(out);
            if (first) return first;
        } catch {
            return null;
        }
    }

    return null;
}

function hasExecutable(binary, options = {}) {
    return Boolean(findExecutable(binary, options));
}

module.exports = {
    ELEVATED_GIT_HINT,
    isElevated,
    getGitInstallInstruction,
    prependPath,
    findExecutable,
    hasExecutable,
};
