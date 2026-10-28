const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const REPO = path.resolve(__dirname, '..');
const sweep = require('../lib/uninstall-sweep.js');

const sandbox = () => { const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-rev2-')); fs.mkdirSync(path.join(home, 'empty-bin')); return home; };
const env = (home) => ({ HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), PATH: path.join(home, 'empty-bin'), AOS_PLUGIN_CLI: 'off' });
const write = (p, text = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const cleanup = (p) => { try { fs.chmodSync(p, 0o755); } catch { /* gone */ } fs.rmSync(p, { recursive: true, force: true }); };
const uninstall = (home, ...flags) => spawnSync(process.execPath, [path.join(REPO, 'bin', 'aos-uninstall.mjs'), ...flags], { cwd: home, env: env(home), encoding: 'utf8' });
const manifestWith = (home, entries) => write(path.join(home, '.agents', '.bdb-install-manifest.json'), JSON.stringify(entries));

test('#2 a shipped server with its own env block is the user\'s: the MCP config is kept', () => {
    const home = sandbox();
    try {
        const cfg = path.join(home, '.gemini', 'config', 'mcp_config.json');
        const rec = path.join(home, '.agents', 'rules', 'r.md');
        write(rec, 'aos');
        manifestWith(home, { [rec]: { sha256: sha('aos') } });
        write(cfg, JSON.stringify({ mcpServers: { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github@2025.4.8'], env: { GITHUB_TOKEN: 'ghp_user' } } } }));
        const r = uninstall(home, '--purge', '--yes');
        assert.strictEqual(r.status, 0, r.stderr + r.stdout);
        assert.ok(fs.existsSync(cfg), 'a server with env keeps the file in place');
        assert.ok(!fs.existsSync(path.join(home, '.aos', 'backups')) || !fs.readdirSync(path.join(home, '.aos', 'backups'), { recursive: true }).some((f) => f.includes('__')));
    } finally { cleanup(home); }
});

test('#4 behindLink fails closed: an unreadable component counts as a link', { skip: process.platform === 'win32' || (process.getuid && process.getuid() === 0) }, () => {
    const home = sandbox();
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-rev2-proj-'));
    try {
        fs.mkdirSync(path.join(proj, 'a', 'b'), { recursive: true });
        fs.chmodSync(path.join(proj, 'a'), 0o000);
        assert.strictEqual(sweep.behindLink({ home, file: path.join(proj, 'a', 'b', 'c', 'f') }), true, 'EACCES is not "absent"');
        fs.chmodSync(path.join(proj, 'a'), 0o755);
        assert.strictEqual(sweep.behindLink({ home, file: path.join(proj, 'a', 'b', 'nope', 'f') }), false, 'ENOENT stays false');
    } finally { cleanup(home); cleanup(proj); }
});

test('#5 plan() hands execute the filtered manifest paths; refused entries are in none of them', async () => {
    const mod = await import(pathToFileURL(path.join(REPO, 'bin', 'aos-uninstall.mjs')).href);
    const home = sandbox();
    try {
        const good = path.join(home, '.agents', 'rules', 'r.md');
        write(good, 'aos');
        manifestWith(home, { [good]: { sha256: sha('aos') }, '': { sha256: 'x' }, '..': { sha256: 'x' }, [home]: { sha256: 'x' }, [path.join(home, 'nohash')]: {} });
        const p = mod.plan({ home, manifestPath: path.join(home, '.agents', '.bdb-install-manifest.json') });
        assert.deepStrictEqual(p.manifestPaths, [good]);
        assert.strictEqual(p.refused.length, 4);
        assert.ok(!/Object\.keys\(p\.manifest/.test(fs.readFileSync(path.join(REPO, 'bin', 'aos-uninstall.mjs'), 'utf8')), 'execute never re-reads the unfiltered manifest');
    } finally { cleanup(home); }
});

test('#7 an edited file behind a link gets no .bak and is not removed', () => {
    const home = sandbox();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-rev2-out-'));
    try {
        const rec = path.join(home, '.agents', 'rules', 'r.md');
        write(rec, 'aos');
        write(path.join(outside, 'f'), 'user edited');
        fs.mkdirSync(path.join(home, '.agents'), { recursive: true });
        fs.symlinkSync(outside, path.join(home, '.agents', 'lnk'));
        manifestWith(home, { [rec]: { sha256: sha('aos') }, [path.join(home, '.agents', 'lnk', 'f')]: { sha256: sha('original') } });
        const r = uninstall(home, '--yes');
        assert.strictEqual(r.status, 0, r.stderr + r.stdout);
        assert.deepStrictEqual(fs.readdirSync(outside), ['f'], 'no .bak next to the file behind the link');
        assert.strictEqual(fs.readFileSync(path.join(outside, 'f'), 'utf8'), 'user edited');
    } finally { cleanup(home); cleanup(outside); }
});

test('#8 a symlinked hooks.json or mcp_config.json is Kept, not moved, not a failure', { skip: process.platform === 'win32' }, () => {
    const home = sandbox();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-rev2-cfg-'));
    try {
        const rec = path.join(home, '.agents', 'rules', 'r.md');
        write(rec, 'aos');
        manifestWith(home, { [rec]: { sha256: sha('aos') } });
        write(path.join(outside, 'hooks.json'), JSON.stringify({ 'aos-go-gate': { Stop: [{ type: 'command', command: 'node go-gate.mjs' }] } }));
        write(path.join(outside, 'mcp.json'), JSON.stringify({ mcpServers: { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github@2025.4.8'] } } }));
        fs.mkdirSync(path.join(home, '.gemini', 'config'), { recursive: true });
        fs.symlinkSync(path.join(outside, 'hooks.json'), path.join(home, '.gemini', 'config', 'hooks.json'));
        fs.symlinkSync(path.join(outside, 'mcp.json'), path.join(home, '.gemini', 'config', 'mcp_config.json'));
        const r = uninstall(home, '--purge', '--yes');
        assert.strictEqual(r.status, 0, r.stderr + r.stdout);
        for (const f of ['hooks.json', 'mcp_config.json']) assert.ok(fs.lstatSync(path.join(home, '.gemini', 'config', f)).isSymbolicLink(), `${f} link stays`);
        assert.ok(fs.existsSync(path.join(outside, 'hooks.json')) && fs.existsSync(path.join(outside, 'mcp.json')));
        const kept = r.stdout.slice(r.stdout.lastIndexOf('Kept:'));
        assert.ok(kept.includes('hooks.json') && kept.includes('mcp_config.json'), kept);
    } finally { cleanup(home); cleanup(outside); }
});

test('#9 case variants and aliases of HOME resolve to HOME and are refused', { skip: process.platform === 'win32' }, () => {
    const home = sandbox();
    const alias = path.join(os.tmpdir(), `aos-rev2-alias-${process.pid}`);
    try {
        const ok = { sha256: 'a'.repeat(64) };
        assert.ok(sweep.refuseManifestPath({ home, p: home.toUpperCase(), entry: ok }), 'case-only HOME');
        fs.symlinkSync(home, alias);
        assert.ok(sweep.refuseManifestPath({ home, p: alias, entry: ok }), 'a link that resolves to HOME');
        assert.strictEqual(sweep.refuseManifestPath({ home, p: path.join(home, '.agents', 'x'), entry: ok }), null);
    } finally { cleanup(alias); cleanup(home); }
});
