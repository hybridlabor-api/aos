// 5.4.2 Windows: OpenCode reads ~/.config/opencode only; no AOS writer may target %APPDATA%\opencode.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mcp = require('../lib/mcp-secrets');
const { opencodeConfigCopies } = require('../lib/opencode-verify');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-oc-win-'));
const appData = path.join(home, 'AppData', 'Roaming');
const winEnv = { APPDATA: appData, USERPROFILE: home };
const ocRow = mcp.HARNESS_ROWS.find((r) => r.id === 'opencode');

test('win32: every OpenCode harness row resolves under ~/.config/opencode, never APPDATA', () => {
    assert.ok(ocRow.mcp.global.length >= 2);
    for (const p of ocRow.mcp.global) {
        const f = mcp.resolveHarnessPath(p, { home, env: winEnv, platform: 'win32' });
        assert.equal(f.startsWith(path.join(home, '.config', 'opencode') + path.sep), true, f);
        assert.equal(f.startsWith(appData), false, f);
    }
});

test('win32: harness MCP files never list the AppData OpenCode copy, even when an old install recorded it', () => {
    fs.mkdirSync(path.join(home, '.agents'), { recursive: true });
    const recorded = [path.join(appData, 'opencode', 'opencode.jsonc'), path.join(home, '.config', 'opencode', 'opencode.jsonc')];
    fs.writeFileSync(path.join(home, '.agents', '.bdb-uninstall-records.json'), JSON.stringify({ mcpConfigs: recorded }));
    const files = mcp.harnessMcpFiles(home, winEnv, 'win32', home).map((f) => f.file);
    assert.equal(files.some((f) => f.startsWith(path.join(appData, 'opencode'))), false);
    assert.equal(files.filter((f) => f === path.join(home, '.config', 'opencode', 'opencode.jsonc')).length, 1);
});

test('doctor helper: an AppData copy is reported as not loaded on win32 (fs mocked)', () => {
    const cfg = path.join(home, '.config', 'opencode', 'opencode.jsonc');
    const copy = path.join(appData, 'opencode', 'opencode.jsonc');
    const exists = (f) => f === cfg || f === copy;
    const r = opencodeConfigCopies({ home, platform: 'win32', env: winEnv, exists });
    assert.equal(r.loadedDir, path.join(home, '.config', 'opencode'));
    assert.deepEqual(r.loaded, [cfg]);
    assert.deepEqual(r.others, [copy]);
});

test('doctor helper: POSIX ignores APPDATA; XDG_CONFIG_HOME moves the loaded dir', () => {
    const copy = path.join(appData, 'opencode', 'opencode.jsonc');
    const xdg = path.join(home, 'xdg', 'opencode', 'opencode.json');
    const exists = (f) => f === copy || f === xdg;
    const r = opencodeConfigCopies({ home, platform: 'darwin', env: { XDG_CONFIG_HOME: path.join(home, 'xdg') }, exists });
    assert.deepEqual(r.loaded, [xdg]);
    assert.deepEqual(r.others, []);
});
