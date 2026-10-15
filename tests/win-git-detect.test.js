'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const REPO = path.resolve(__dirname, '..');
const {
    ELEVATED_GIT_HINT,
    isElevated,
    getGitInstallInstruction,
    prependPath,
    findExecutable,
    hasExecutable,
} = require(path.join(REPO, 'lib', 'executable-probe.js'));
const { checkSystemPrereqs } = require(path.join(REPO, 'installer.js'));

describe('win-git-detect: executable probe & Windows fallback', () => {
    test('findExecutable returns where.exe path when where.exe succeeds', () => {
        const fakeExec = (bin, args) => {
            if (bin === 'where.exe' && args[0] === 'git') {
                return 'C:\\Custom\\git.exe\r\nC:\\Other\\git.exe\r\n';
            }
            throw new Error('command failed');
        };

        const res = findExecutable('git', {
            platform: 'win32',
            env: { PATH: 'C:\\Windows\\system32' },
            execImpl: fakeExec,
        });

        assert.equal(res, 'C:\\Custom\\git.exe');
    });

    test('findExecutable falls back to %LOCALAPPDATA%\\Programs\\Git\\cmd\\git.exe when where.exe fails', () => {
        const localAppData = 'C:\\Users\\TestUser\\AppData\\Local';
        const expectedGit = path.win32.join(localAppData, 'Programs', 'Git', 'cmd', 'git.exe');
        const fakeEnv = {
            LOCALAPPDATA: localAppData,
            PATH: 'C:\\Windows\\system32',
        };

        const fakeFs = {
            existsSync: (p) => p === expectedGit,
        };

        const fakeExec = (bin) => {
            throw new Error(`Command not found: ${bin}`);
        };

        const res = findExecutable('git', {
            platform: 'win32',
            env: fakeEnv,
            fsImpl: fakeFs,
            execImpl: fakeExec,
        });

        assert.equal(res, expectedGit);
        assert.equal(hasExecutable('git', {
            platform: 'win32',
            env: fakeEnv,
            fsImpl: fakeFs,
            execImpl: fakeExec,
        }), true);

        // PATH should have the git cmd directory prepended
        const expectedDir = path.win32.dirname(expectedGit);
        assert.ok(fakeEnv.PATH.startsWith(expectedDir + ';'));
    });

    test('findExecutable falls back to %ProgramFiles%\\Git\\cmd\\git.exe when where.exe fails', () => {
        const progFiles = 'C:\\Program Files';
        const expectedGit = path.win32.join(progFiles, 'Git', 'cmd', 'git.exe');
        const fakeEnv = {
            ProgramFiles: progFiles,
            PATH: 'C:\\Windows\\system32',
        };

        const fakeFs = {
            existsSync: (p) => p === expectedGit,
        };

        const fakeExec = () => {
            throw new Error('where.exe failed');
        };

        const res = findExecutable('git', {
            platform: 'win32',
            env: fakeEnv,
            fsImpl: fakeFs,
            execImpl: fakeExec,
        });

        assert.equal(res, expectedGit);
        assert.ok(fakeEnv.PATH.startsWith(path.win32.dirname(expectedGit) + ';'));
    });

    test('findExecutable falls back to %ProgramFiles(x86)%\\Git\\cmd\\git.exe when where.exe fails', () => {
        const progFilesX86 = 'C:\\Program Files (x86)';
        const expectedGit = path.win32.join(progFilesX86, 'Git', 'cmd', 'git.exe');
        const fakeEnv = {
            'ProgramFiles(x86)': progFilesX86,
            PATH: 'C:\\Windows\\system32',
        };

        const fakeFs = {
            existsSync: (p) => p === expectedGit,
        };

        const fakeExec = () => {
            throw new Error('where.exe failed');
        };

        const res = findExecutable('git', {
            platform: 'win32',
            env: fakeEnv,
            fsImpl: fakeFs,
            execImpl: fakeExec,
        });

        assert.equal(res, expectedGit);
    });

    test('findExecutable falls back to registry HKLM InstallPath when where.exe and static paths fail', () => {
        const installDir = 'D:\\Tools\\Git';
        const expectedGit = path.win32.join(installDir, 'cmd', 'git.exe');
        const fakeEnv = {
            ProgramFiles: 'C:\\Program Files',
            PATH: 'C:\\Windows\\system32',
        };

        const fakeFs = {
            existsSync: (p) => p === expectedGit,
        };

        const fakeExec = (bin, args) => {
            if (args[0] === 'query' && args[1] === 'HKLM\\Software\\GitForWindows') {
                return `HKEY_LOCAL_MACHINE\\Software\\GitForWindows\r\n    InstallPath    REG_SZ    ${installDir}\r\n`;
            }
            throw new Error('not found');
        };

        const res = findExecutable('git', {
            platform: 'win32',
            env: fakeEnv,
            fsImpl: fakeFs,
            execImpl: fakeExec,
        });

        assert.equal(res, expectedGit);
        assert.ok(fakeEnv.PATH.startsWith(path.win32.dirname(expectedGit) + ';'));
    });

    test('findExecutable falls back to registry HKCU InstallPath when where.exe and static paths fail', () => {
        const installDir = 'C:\\Users\\Admin\\Git';
        const expectedGit = path.win32.join(installDir, 'cmd', 'git.exe');
        const fakeEnv = {
            PATH: 'C:\\Windows\\system32',
        };

        const fakeFs = {
            existsSync: (p) => p === expectedGit,
        };

        const fakeExec = (bin, args) => {
            if (args[0] === 'query' && args[1] === 'HKCU\\Software\\GitForWindows') {
                return `HKEY_CURRENT_USER\\Software\\GitForWindows\r\n    InstallPath    REG_SZ    ${installDir}\r\n`;
            }
            throw new Error('not found');
        };

        const res = findExecutable('git', {
            platform: 'win32',
            env: fakeEnv,
            fsImpl: fakeFs,
            execImpl: fakeExec,
        });

        assert.equal(res, expectedGit);
    });

    test('findExecutable falls back for gh to %ProgramFiles%\\GitHub CLI\\gh.exe', () => {
        const progFiles = 'C:\\Program Files';
        const expectedGh = path.win32.join(progFiles, 'GitHub CLI', 'gh.exe');
        const fakeEnv = {
            ProgramFiles: progFiles,
            PATH: 'C:\\Windows\\system32',
        };

        const fakeFs = {
            existsSync: (p) => p === expectedGh,
        };

        const fakeExec = () => {
            throw new Error('where.exe failed');
        };

        const res = findExecutable('gh', {
            platform: 'win32',
            env: fakeEnv,
            fsImpl: fakeFs,
            execImpl: fakeExec,
        });

        assert.equal(res, expectedGh);
        assert.ok(fakeEnv.PATH.startsWith(path.win32.dirname(expectedGh) + ';'));
    });

    test('findExecutable falls back for gh to %LOCALAPPDATA%\\Programs\\GitHub CLI\\gh.exe', () => {
        const localAppData = 'C:\\Users\\TestUser\\AppData\\Local';
        const expectedGh = path.win32.join(localAppData, 'Programs', 'GitHub CLI', 'gh.exe');
        const fakeEnv = {
            LOCALAPPDATA: localAppData,
            PATH: 'C:\\Windows\\system32',
        };

        const fakeFs = {
            existsSync: (p) => p === expectedGh,
        };

        const fakeExec = () => {
            throw new Error('where.exe failed');
        };

        const res = findExecutable('gh', {
            platform: 'win32',
            env: fakeEnv,
            fsImpl: fakeFs,
            execImpl: fakeExec,
        });

        assert.equal(res, expectedGh);
    });

    test('findExecutable returns null when git is missing everywhere on win32', () => {
        const fakeEnv = {
            PATH: 'C:\\Windows\\system32',
        };

        const fakeFs = {
            existsSync: () => false,
        };

        const fakeExec = () => {
            throw new Error('not found');
        };

        const res = findExecutable('git', {
            platform: 'win32',
            env: fakeEnv,
            fsImpl: fakeFs,
            execImpl: fakeExec,
        });

        assert.equal(res, null);
        assert.equal(hasExecutable('git', {
            platform: 'win32',
            env: fakeEnv,
            fsImpl: fakeFs,
            execImpl: fakeExec,
        }), false);
    });

    test('findExecutable works with real filesystem in a temporary directory tree', () => {
        const tmpBase = path.join(REPO, '.tmp-win-git-test');
        const fakeGitCmdDir = path.join(tmpBase, 'Programs', 'Git', 'cmd');
        const fakeGitExe = path.join(fakeGitCmdDir, 'git.exe');

        fs.mkdirSync(fakeGitCmdDir, { recursive: true });
        fs.writeFileSync(fakeGitExe, 'fake-git-binary');

        try {
            const fakeEnv = {
                LOCALAPPDATA: tmpBase,
                PATH: '/usr/bin:/bin',
            };

            const fakeExec = () => {
                throw new Error('where.exe failed');
            };

            const res = findExecutable('git', {
                platform: 'win32',
                env: fakeEnv,
                fsImpl: fs,
                execImpl: fakeExec,
            });

            assert.equal(res, fakeGitExe);
            assert.ok(fakeEnv.PATH.startsWith(fakeGitCmdDir + ';'));
        } finally {
            try { fs.unlinkSync(fakeGitExe); } catch {}
            try { fs.rmdirSync(fakeGitCmdDir); } catch {}
            try { fs.rmdirSync(path.join(tmpBase, 'Programs', 'Git')); } catch {}
            try { fs.rmdirSync(path.join(tmpBase, 'Programs')); } catch {}
            try { fs.rmdirSync(tmpBase); } catch {}
        }
    });

    test('non-win32 platforms do not run Windows fallbacks or query registry', () => {
        let regCalled = false;
        let whereCalled = false;

        const fakeExec = (bin, args) => {
            if (bin === 'where.exe') whereCalled = true;
            if (bin.startsWith('reg')) regCalled = true;
            if (bin === 'which' && args[0] === 'git') {
                return '/usr/local/bin/git\n';
            }
            throw new Error('not found');
        };

        const res = findExecutable('git', {
            platform: 'darwin',
            env: { PATH: '/usr/local/bin:/usr/bin' },
            execImpl: fakeExec,
        });

        assert.equal(res, '/usr/local/bin/git');
        assert.equal(whereCalled, false);
        assert.equal(regCalled, false);
    });
});

describe('win-git-detect: elevation detection & error instructions', () => {
    test('isElevated returns true when net session succeeds on win32', () => {
        const fakeExec = (bin, args) => {
            if ((bin === 'net.exe' || bin === 'net') && args[0] === 'session') {
                return ''; // success
            }
            throw new Error('command failed');
        };

        assert.equal(isElevated({ platform: 'win32', execImpl: fakeExec }), true);
    });

    test('isElevated returns false when net session fails (access denied) on win32', () => {
        const fakeExec = () => {
            const err = new Error('System error 5 has occurred. Access is denied.');
            err.status = 2;
            throw err;
        };

        assert.equal(isElevated({ platform: 'win32', execImpl: fakeExec }), false);
    });

    test('getGitInstallInstruction for non-elevated win32 provides winget / git-scm hint', () => {
        const hint = getGitInstallInstruction({ platform: 'win32', elevated: false });
        assert.match(hint, /git-scm\.com or winget install Git\.Git/);
        assert.ok(!hint.includes(ELEVATED_GIT_HINT));
    });

    test('getGitInstallInstruction for elevated win32 provides winget / git-scm AND elevated warning hint', () => {
        const hint = getGitInstallInstruction({ platform: 'win32', elevated: true });
        assert.match(hint, /git-scm\.com or winget install Git\.Git/);
        assert.ok(hint.includes(ELEVATED_GIT_HINT));
        assert.match(hint, /Git may be installed for another user or missing from this shell's PATH/);
    });

    test('checkSystemPrereqs on win32 when git is missing and shell is elevated includes elevated hint', () => {
        const errors = [];
        const logger = { error: (msg) => errors.push(msg), warn: () => {} };

        assert.throws(
            () => checkSystemPrereqs({
                which: () => false,
                platform: 'win32',
                logger,
                exitOnError: true,
                isElevated: true,
            }),
            (err) => {
                assert.match(err.message, /git-scm\.com or winget install Git\.Git/);
                assert.match(err.message, /Git may be installed for another user or missing from this shell's PATH/);
                return true;
            }
        );
        assert.equal(process.exitCode, 1);
        process.exitCode = 0;

        assert.equal(errors.length, 1);
        assert.match(errors[0], /git-scm\.com or winget install Git\.Git/);
        assert.match(errors[0], /Git may be installed for another user or missing from this shell's PATH/);
    });

    test('checkSystemPrereqs on win32 when git is missing and shell is non-elevated omits elevated hint', () => {
        const errors = [];
        const logger = { error: (msg) => errors.push(msg), warn: () => {} };

        assert.throws(
            () => checkSystemPrereqs({
                which: () => false,
                platform: 'win32',
                logger,
                exitOnError: true,
                isElevated: false,
            }),
            /git-scm\.com or winget install Git\.Git/
        );
        assert.equal(process.exitCode, 1);
        process.exitCode = 0;

        assert.equal(errors.length, 1);
        assert.match(errors[0], /git-scm\.com or winget install Git\.Git/);
        assert.ok(!errors[0].includes(ELEVATED_GIT_HINT));
    });

    test('checkSystemPrereqs on win32 succeeds when which returns git found via fallback', () => {
        const warnings = [];
        const errors = [];
        const logger = { error: (msg) => errors.push(msg), warn: (msg) => warnings.push(msg) };

        const res = checkSystemPrereqs({
            which: (bin) => bin === 'git' ? 'C:\\Users\\User\\AppData\\Local\\Programs\\Git\\cmd\\git.exe' : false,
            platform: 'win32',
            logger,
            exitOnError: true,
        });

        assert.equal(res.ok, true);
        assert.equal(res.git, true);
        assert.equal(errors.length, 0);
    });
});

describe('win-git-detect: doctor and installer agreement', () => {
    test('doctor script imports and shares executable-probe functions', () => {
        const doctorSrc = fs.readFileSync(path.join(REPO, 'bin', 'aos-doctor.mjs'), 'utf8');
        assert.ok(doctorSrc.includes("req('../lib/executable-probe.js')"), 'doctor must import lib/executable-probe.js');
        assert.ok(doctorSrc.includes('findExecutable'), 'doctor must use findExecutable');
        assert.ok(doctorSrc.includes('getGitInstallInstruction'), 'doctor must use getGitInstallInstruction');
        assert.ok(doctorSrc.includes('isElevated'), 'doctor must use isElevated');
    });

    test('installer script imports and shares executable-probe functions', () => {
        const installerSrc = fs.readFileSync(path.join(REPO, 'installer.js'), 'utf8');
        assert.ok(installerSrc.includes("require('./lib/executable-probe')"), 'installer must import lib/executable-probe');
        assert.ok(installerSrc.includes('findExecutable'), 'installer must use findExecutable');
        assert.ok(installerSrc.includes('getGitInstallInstruction'), 'installer must use getGitInstallInstruction');
    });

    test('installer and doctor produce identical git instruction on win32 elevated and non-elevated', () => {
        const nonElevated = getGitInstallInstruction({ platform: 'win32', elevated: false });
        const elevated = getGitInstallInstruction({ platform: 'win32', elevated: true });

        assert.equal(nonElevated, 'Install Git via git-scm.com or winget install Git.Git');
        assert.equal(elevated, `Install Git via git-scm.com or winget install Git.Git\n${ELEVATED_GIT_HINT}`);
    });
});

