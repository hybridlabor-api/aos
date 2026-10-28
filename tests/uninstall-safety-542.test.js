const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const sweep = require('../lib/uninstall-sweep.js');

const sandbox = () => { const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-safe-')); fs.mkdirSync(path.join(home, 'empty-bin')); return home; };
const env = (home) => ({ HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), PATH: path.join(home, 'empty-bin'), AOS_PLUGIN_CLI: 'off' });
const write = (p, text = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const cleanup = (p) => fs.rmSync(p, { recursive: true, force: true });
const uninstall = (home, ...flags) => spawnSync(process.execPath, [path.join(REPO, 'bin', 'aos-uninstall.mjs'), ...flags], { cwd: home, env: env(home), encoding: 'utf8' });

// One purge run in a sandbox with the given Antigravity files; reports what is left and what was backed up.
function purgeWith(hooks, mcp) {
    const home = sandbox();
    try {
        const j = (...p) => path.join(home, ...p);
        const rec = j('.agents', 'rules', 'r.md');
        write(rec, 'aos');
        write(j('.agents', '.bdb-install-manifest.json'), JSON.stringify({ [rec]: { sha256: sha('aos') } }));
        write(j('.gemini', 'config', 'hooks.json'), JSON.stringify(hooks));
        write(j('.gemini', 'config', 'mcp_config.json'), JSON.stringify(mcp));
        const r = uninstall(home, '--purge', '--yes');
        assert.strictEqual(r.status, 0, r.stderr + r.stdout);
        const bk = fs.existsSync(j('.aos', 'backups')) ? fs.readdirSync(j('.aos', 'backups'), { recursive: true }).filter((f) => f.includes('__')) : [];
        return { hooks: fs.existsSync(j('.gemini', 'config', 'hooks.json')), mcp: fs.existsSync(j('.gemini', 'config', 'mcp_config.json')), bk, out: r.stdout };
    } finally { cleanup(home); }
}

test('purge: Antigravity hooks/MCP files are decided by content and moved to ~/.aos/backups, never deleted', () => {
    const aos = { 'aos-go-gate': { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'node "/h/.gemini/config/hooks/go-gate.mjs" || exit 0' }] }] } };
    const mixed = { 'aos-go-gate': { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'node "/h/hooks/go-gate.mjs"' }, { type: 'command', command: './my-audit.sh' }] }] } };
    const chained = { 'aos-go-gate': { Stop: [{ type: 'command', command: 'node go-gate.mjs && curl evil' }] } };
    const shippedGithub = { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github@2025.4.8'] };

    const a = purgeWith(aos, { mcpServers: { github: shippedGithub } });
    assert.ok(!a.hooks && !a.mcp, 'AOS-only files leave their place');
    assert.strictEqual(a.bk.length, 2, 'both are moved into the backup folder');
    assert.match(a.out, /backed up here/);

    const b = purgeWith(mixed, { mcpServers: { github: { command: 'node', args: ['my-github.js'], env: { GITHUB_TOKEN: 'ghp_x' } } } });
    assert.ok(b.hooks && b.mcp, 'a user handler inside an aos-* group, or a user github entry with a PAT, keeps the whole file');
    assert.strictEqual(b.bk.length, 0);

    const c = purgeWith(chained, {});
    assert.ok(c.hooks && c.mcp, 'a chained command and an empty config are not AOS-only');
    assert.strictEqual(c.bk.length, 0);
});

test('guardedRemove unlinks a symlink or junction at the target and never follows it', () => {
    const home = sandbox();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-link-outside-'));
    try {
        write(path.join(outside, 'precious.txt'), 'outside');
        let tried = 0;
        for (const [name, type] of [['.synapse', 'dir'], ['.memb', 'junction']]) {
            try { fs.symlinkSync(outside, path.join(home, name), type); } catch { continue; } // a junction needs Windows
            tried++;
            assert.strictEqual(sweep.guardedRemove({ home, target: path.join(home, name) }), 'removed');
            assert.throws(() => fs.lstatSync(path.join(home, name)), { code: 'ENOENT' }, `${type} link itself is gone`);
        }
        assert.ok(tried >= 1);
        assert.strictEqual(fs.readFileSync(path.join(outside, 'precious.txt'), 'utf8'), 'outside', 'the link target is intact');
    } finally { cleanup(home); cleanup(outside); }
});

test('refuseManifestPath rejects crafted entries and unhashed ones', () => {
    const ok = { sha256: 'a'.repeat(64) };
    const cases = [
        ['posix', '/home/tim', ['', '.', '..', '~', '~/x', '/', '/home', '/home/tim', '/HOME/TIM', '/home/tim/', 'rel/path']],
        ['win32', 'C:\\Users\\api', ['', '.', '..', '~', 'C:\\', 'c:/', '\\\\srv\\share\\', 'C:\\Users', 'C:\\Users\\api', 'c:\\users\\API', 'c:/USERS/api/']],
    ];
    for (const [platform, home, bad] of cases) {
        for (const p of bad) assert.ok(sweep.refuseManifestPath({ home, p, entry: ok, platform }), `${platform} ${JSON.stringify(p)} must be refused`);
        const good = platform === 'win32' ? 'C:\\Users\\api\\.agents\\x' : '/home/tim/.agents/x';
        assert.strictEqual(sweep.refuseManifestPath({ home, p: good, entry: ok, platform }), null);
        for (const entry of [null, {}, { sha256: null }, { sha256: '' }, { sha256: 5 }]) assert.ok(sweep.refuseManifestPath({ home, p: good, entry, platform }), `entry ${JSON.stringify(entry)}`);
    }
});

test('uninstall: crafted manifest entries delete nothing and HOME survives', () => {
    const home = sandbox();
    try {
        const j = (...p) => path.join(home, ...p);
        write(j('keep.txt'), 'user');
        const real = j('.agents', 'rules', 'r.md');
        write(real, 'aos');
        const manifest = {
            [real]: { sha256: sha('aos') }, '': { sha256: sha('') }, '.': { sha256: 'x' }, '..': { sha256: 'x' }, '~': { sha256: 'x' },
            [home]: { sha256: sha('') }, [home.toUpperCase()]: { sha256: 'x' }, '/': { sha256: 'x' }, [j('keep.txt')]: { sha256: null }, '\\\\srv\\share\\f': { sha256: 'x' },
        };
        write(j('.agents', '.bdb-install-manifest.json'), JSON.stringify(manifest));
        const r = uninstall(home, '--yes');
        assert.strictEqual(r.status, 0, r.stderr + r.stdout);
        assert.match(r.stdout, /refused/);
        assert.ok(fs.existsSync(j('keep.txt')) && fs.existsSync(home));
        assert.ok(!fs.existsSync(real), 'the valid recorded file is still removed');
    } finally { cleanup(home); }
});

test('behindLink: outside HOME the chain is checked from the root; a link is caught', () => {
    const home = sandbox();
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-proj-'));
    const real = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-proj-real-'));
    try {
        fs.mkdirSync(path.join(proj, 'a'));
        fs.symlinkSync(real, path.join(proj, 'a', 'lnk'));
        write(path.join(real, 'f'), 'x');
        assert.strictEqual(sweep.behindLink({ home, file: path.join(proj, 'a', 'lnk', 'f') }), true);
        assert.strictEqual(sweep.behindLink({ home, file: path.join(proj, 'a', 'g') }), false);
    } finally { cleanup(home); cleanup(proj); cleanup(real); }
});
