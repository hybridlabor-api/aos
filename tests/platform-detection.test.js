const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const { findBundledClaudeCli } = require(path.join(REPO, 'installer.js'));

// detectPlatforms() reads $HOME and $PATH, both resolved by installer.js at
// module load, so each scenario runs in a child process with those pointed
// somewhere controlled. /Applications cannot be redirected that way, hence the
// baseline comparison in the suite below.
function detectIn({ home, pathDirs = [], explicit = [] }) {
    const src = `
        const m = require(${JSON.stringify(path.join(REPO, 'installer.js'))});
        m.markPlatformsExplicit(${JSON.stringify(explicit)});
        process.stdout.write(JSON.stringify(m.detectPlatforms().map(d => ({ key: d.key, chosen: !!d.chosen }))));
    `;
    const out = execFileSync(process.execPath, ['-e', src], {
        env: { ...process.env, HOME: home, PATH: pathDirs.join(path.delimiter) },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(out);
}

const fakeBin = (dir, name) => {
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, name);
    fs.writeFileSync(p, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(p, 0o755);
    return dir;
};

describe('detectPlatforms', () => {
    let home, bin;

    // App bundles live in /Applications, which no HOME override can hide, so a
    // truly bare machine is not reproducible here. Compare against whatever
    // this machine detects with an empty HOME and PATH instead — every
    // assertion below is about the DELTA from that baseline.
    let baseline;
    const keysOf = (ds) => ds.map((d) => d.key).sort();

    test.beforeEach(() => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'bdb-detect-home-'));
        bin = fs.mkdtempSync(path.join(os.tmpdir(), 'bdb-detect-bin-'));
        baseline = keysOf(detectIn({ home: fs.mkdtempSync(path.join(os.tmpdir(), 'bdb-detect-base-')) }));
    });
    test.afterEach(() => {
        fs.rmSync(home, { recursive: true, force: true });
        fs.rmSync(bin, { recursive: true, force: true });
    });

    test('an empty HOME adds nothing beyond what is installed machine-wide', () => {
        assert.deepEqual(keysOf(detectIn({ home })), baseline);
    });

    test('a binary on PATH is evidence', () => {
        fakeBin(bin, 'codex');
        const keys = keysOf(detectIn({ home, pathDirs: [bin] }));
        assert.deepEqual(keys, [...baseline, 'codex'].sort());
    });

    // The bug this whole change exists for. syncSkillsToGlobalHarnesses() and
    // universalHarnessSync() create these paths themselves, so treating them as
    // evidence made the detector read back what the installer had planted — a
    // machine with no Cursor and no VS Code still reported both.
    test('directories and config files the installer itself writes are NOT evidence', () => {
        for (const rel of [
            '.claude/skills', '.claude.json',
            '.codex/skills', '.codex/config.toml',
            '.cursor/skills', '.cursor/mcp.json',
            '.roo/skills', '.roo/mcp_settings.json',
            '.gemini/config/skills',
            '.aider', '.aider.conf.yml',
            '.config/opencode/opencode.json',
            'Library/Application Support/Claude/claude_desktop_config.json',
            'Library/Application Support/Cursor/User/mcp.json',
        ]) {
            const p = path.join(home, rel);
            if (path.extname(p)) {
                fs.mkdirSync(path.dirname(p), { recursive: true });
                fs.writeFileSync(p, '{}');
            } else {
                fs.mkdirSync(p, { recursive: true });
            }
        }
        assert.deepEqual(
            keysOf(detectIn({ home })), baseline,
            'installer-created paths must not add a single harness beyond what is really installed',
        );
    });

    test('an explicitly chosen platform counts even when it is not installed', () => {
        const got = detectIn({ home, explicit: ['3'] });
        const cursor = got.find((d) => d.key === 'cursor');
        assert.ok(cursor, 'the chosen platform must be present');
        assert.equal(cursor.chosen, true, 'and be marked as chosen rather than found');
    });

    test('option 2 covers both Claude Code and Claude Desktop', () => {
        const keys = keysOf(detectIn({ home, explicit: ['2'] }));
        assert.ok(keys.includes('claudecode') && keys.includes('claudedesktop'));
    });

    test('a found platform is reported as found, not as chosen', () => {
        fakeBin(bin, 'opencode');
        const [d] = detectIn({ home, pathDirs: [bin], explicit: ['8'] }).filter((x) => x.key === 'opencode');
        assert.equal(d.chosen, false, 'evidence outranks the explicit flag in how it is labelled');
    });

    test('findBundledClaudeCli detects macOS bundled binary', () => {
        const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-bundle-mac-'));
        try {
            const cliPath = path.join(fakeHome, 'Applications', 'Claude.app', 'Contents', 'Resources', 'claude');
            fs.mkdirSync(path.dirname(cliPath), { recursive: true });
            fs.writeFileSync(cliPath, '#!/bin/sh\nexit 0\n');
            fs.chmodSync(cliPath, 0o755);

            const found = findBundledClaudeCli({
                platform: 'darwin',
                home: fakeHome,
                fsImpl: fs,
            });
            assert.equal(found, cliPath);
        } finally {
            fs.rmSync(fakeHome, { recursive: true, force: true });
        }
    });

    test('findBundledClaudeCli detects Windows bundled binary in LOCALAPPDATA', () => {
        const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-bundle-win-'));
        try {
            const localAppData = path.join(fakeHome, 'AppData', 'Local');
            const cliPath = path.join(localAppData, 'Programs', 'Claude', 'resources', 'claude.exe');
            fs.mkdirSync(path.dirname(cliPath), { recursive: true });
            fs.writeFileSync(cliPath, 'dummy exe');

            const found = findBundledClaudeCli({
                platform: 'win32',
                home: fakeHome,
                env: { LOCALAPPDATA: localAppData },
                fsImpl: fs,
            });
            assert.equal(found, cliPath);
        } finally {
            fs.rmSync(fakeHome, { recursive: true, force: true });
        }
    });

    test('findBundledClaudeCli returns null when no candidate exists', () => {
        const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-bundle-none-'));
        try {
            const found = findBundledClaudeCli({
                platform: 'darwin',
                home: fakeHome,
                fsImpl: fs,
            });
            assert.equal(found, null);
        } finally {
            fs.rmSync(fakeHome, { recursive: true, force: true });
        }
    });

    test('findBundledClaudeCli picks Contents/MacOS/claude when it is the only macOS candidate', () => {
        const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-bundle-macos-'));
        try {
            const cliPath = path.join(fakeHome, 'Applications', 'Claude.app', 'Contents', 'MacOS', 'claude');
            fs.mkdirSync(path.dirname(cliPath), { recursive: true });
            fs.writeFileSync(cliPath, '#!/bin/sh\nexit 0\n');
            fs.chmodSync(cliPath, 0o755);

            assert.equal(findBundledClaudeCli({ platform: 'darwin', home: fakeHome, fsImpl: fs }), cliPath);
        } finally {
            fs.rmSync(fakeHome, { recursive: true, force: true });
        }
    });

    test('findBundledClaudeCli prefers Contents/Resources/bin/claude over Contents/MacOS/claude', () => {
        const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-bundle-order-'));
        try {
            const appDir = path.join(fakeHome, 'Applications', 'Claude.app', 'Contents');
            const binPath = path.join(appDir, 'Resources', 'bin', 'claude');
            const macosPath = path.join(appDir, 'MacOS', 'claude');
            for (const p of [binPath, macosPath]) {
                fs.mkdirSync(path.dirname(p), { recursive: true });
                fs.writeFileSync(p, '#!/bin/sh\nexit 0\n');
                fs.chmodSync(p, 0o755);
            }

            assert.equal(findBundledClaudeCli({ platform: 'darwin', home: fakeHome, fsImpl: fs }), binPath);
        } finally {
            fs.rmSync(fakeHome, { recursive: true, force: true });
        }
    });

    test('detectPlatforms finds claudecode when bundled CLI is present even without PATH binary', () => {
        const bundleDir = path.join(home, 'Applications', 'Claude.app', 'Contents', 'Resources');
        fs.mkdirSync(bundleDir, { recursive: true });
        const bundleCli = path.join(bundleDir, 'claude');
        fs.writeFileSync(bundleCli, '#!/bin/sh\nexit 0\n');
        fs.chmodSync(bundleCli, 0o755);

        const keys = keysOf(detectIn({ home }));
        assert.ok(keys.includes('claudecode'), 'bundled Claude CLI is recognized as claudecode evidence');
    });
});
