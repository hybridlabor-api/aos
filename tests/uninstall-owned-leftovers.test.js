const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'bin', 'aos-uninstall.mjs')).href);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-owned-leftovers-'));

test('the Codex writable-root record goes with the root it added, so the records file is retired', () => {
    const ur = require('../lib/uninstall-records.js');
    const { replyRoot, ensureWritableRoot } = require('../lib/codex-writable-root.js');
    const home = tmp();
    const dir = replyRoot(home);
    const cfg = path.join(home, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(cfg), { recursive: true });
    fs.writeFileSync(cfg, ensureWritableRoot('', dir).text);
    ur.recordCodexWritableRoot(home, dir);
    ur.reverseRegistrations({ home, env: {} });
    assert.equal(ur.readRecords(home).codexWritableRoot, undefined);
    assert.ok(!fs.existsSync(ur.recordsPath(home)), 'nothing pending: the records file goes');
});

test('a Codex plugin state file that records no AOS ownership is removed; Codex is not called', () => {
    const cp = require('../lib/codex-plugin-install.js');
    const home = tmp();
    fs.mkdirSync(path.dirname(cp.statePath(home)), { recursive: true });
    fs.writeFileSync(cp.statePath(home), JSON.stringify({ version: '5.4.2-beta.1', source: '/x' }));
    const r = cp.uninstallCodexPlugin({ home, run: () => { throw new Error('codex must not run'); }, hasCodex: () => true });
    assert.equal(r.changed, false);
    assert.ok(!fs.existsSync(cp.statePath(home)));
});

test('the Codex hook trust snapshot is planned for removal on every uninstall, not only --purge', async () => {
    const { plan } = await load();
    const home = tmp();
    const snap = path.join(home, '.aos', 'codex-hooks.json');
    fs.mkdirSync(path.dirname(snap), { recursive: true });
    fs.writeFileSync(snap, JSON.stringify({ hookHash: 'abc', trustedHashes: [], changedAt: '2026-11-05T00:00:00.000Z' }));
    const p = plan({ home, manifestPath: path.join(home, 'none.json') });
    assert.ok(p.state.some((e) => e.path === snap), 'codex-hooks.json is in the removal plan');
});
