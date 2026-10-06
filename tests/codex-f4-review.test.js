// F4 review follow-ups: [features] hooks handling, marker-free doctor hooks check, deja table ownership.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-f4r-'));
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const inst = require('../installer.js');
const ur = require('../lib/uninstall-records.js');

const merge = (initial) => {
    const f = path.join(tmp, `c${Math.random().toString(36).slice(2)}`, 'config.toml');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (initial !== null) fs.writeFileSync(f, initial);
    inst.mergeCodexTomlHooks(f);
    return fs.readFileSync(f, 'utf8');
};
const count = (s, re) => (s.match(re) || []).length;

test('hooks = true in another table does not count; [features] gets its own', () => {
    const out = merge('[other]\nhooks = true\n');
    assert.match(out, /^\[features\]\nhooks = true\n/);
});

test('[features] hooks = false is flipped, not duplicated', () => {
    const out = merge('[features]\nhooks = false\nother = 1\n');
    assert.strictEqual(count(out, /^hooks\s*=/gm), 1);
    assert.match(out, /^hooks = true$/m);
    assert.match(out, /^other = 1$/m);
});

test('[features] without hooks gets the key inside the table; a second run changes nothing', () => {
    const f = path.join(tmp, 'f.toml');
    fs.writeFileSync(f, '[features]\nfoo = true\n\n[model]\nname = "x"\n');
    inst.mergeCodexTomlHooks(f);
    const first = fs.readFileSync(f, 'utf8');
    assert.match(first, /^\[features\]\nhooks = true\nfoo = true\n\n\[model\]/);
    inst.mergeCodexTomlHooks(f);
    assert.strictEqual(fs.readFileSync(f, 'utf8'), first);
});

test('doctor sees AOS hooks after Codex dropped the marker comments', () => {
    const home = fs.mkdtempSync(path.join(tmp, 'doc-'));
    const f = path.join(home, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const withMarkers = merge(null);
    fs.writeFileSync(f, withMarkers.split('\n').filter((l) => !l.startsWith('# AOS:')).join('\n'));
    const r = spawnSync(process.execPath, [path.resolve(__dirname, '..', 'bin', 'aos-doctor.mjs'), '--json'], { cwd: home, env: { HOME: home, USERPROFILE: home, PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
    const row = JSON.parse(r.stdout).results.find((x) => x.name === 'Codex config.toml hooks');
    assert.ok(row && row.ok, JSON.stringify(row));
});

test('deja ownership predicate keeps a foreign deja table and its sub-table', () => {
    const toml = '[mcp_servers.deja]\ncommand = "mine"\n\n[mcp_servers.deja.env]\nK = "v"\n\n[mcp_servers.x]\ncommand = "deja"\n';
    const owns = (n, sec) => n === 'deja' && sec.some((l) => l.trim() === 'command = "deja"');
    const out = ur.dropMcpTables(toml.split('\n'), owns).join('\n');
    assert.match(out, /command = "mine"/);
    assert.match(out, /deja\.env/);
    const own = ur.dropMcpTables('[mcp_servers.deja]\ncommand = "deja"\nargs = ["mcp"]\n\n[mcp_servers.deja.env]\nK = "v"\n'.split('\n'), owns).join('\n');
    assert.doesNotMatch(own, /deja\.env/);
});
