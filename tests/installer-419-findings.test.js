// 4.19.1 installer findings (items 2-5, 8). Offline; HOME is a temp dir; fake values only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-419-home-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
for (const k of ['OPENROUTER_API_KEY', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'GEMINI_API_KEY', 'OPENWIKI_PROVIDER']) delete process.env[k];
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const installer = require('../installer.js');
const write = (rel, text, mode = 0o600) => {
    const p = path.join(home, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, { mode });
    fs.chmodSync(p, mode);
    return p;
};

test('finding 2: stored provider, model and keys are found in secrets file and ~/.openwiki/.env', () => {
    write('.aos/secrets.env', 'GITHUB_PERSONAL_ACCESS_TOKEN=ghp_TESTONLY1\n');
    write('.openwiki/.env', 'OPENWIKI_PROVIDER=openrouter\nOPENWIKI_MODEL_ID=vendor/some-model\nOPENROUTER_API_KEY=sk-TESTONLY2\n');
    const e = installer.loadExistingEnv(null);
    assert.strictEqual(e.GITHUB_PERSONAL_ACCESS_TOKEN, 'ghp_TESTONLY1');
    assert.strictEqual(e.OPENWIKI_PROVIDER, 'openrouter');
    assert.strictEqual(e.OPENWIKI_MODEL_ID, 'vendor/some-model');
    assert.strictEqual(e.OPENROUTER_API_KEY, 'sk-TESTONLY2');
});

test('finding 2: openai-compatible in ~/.openwiki/.env maps back to the AOS provider by base URL', () => {
    write('.openwiki/.env', 'OPENWIKI_PROVIDER=openai-compatible\nOPENAI_COMPATIBLE_BASE_URL=https://api.groq.com/openai/v1\nOPENAI_COMPATIBLE_API_KEY=gsk_TESTONLY3\n');
    const e = installer.loadExistingEnv(null);
    assert.strictEqual(e.OPENWIKI_PROVIDER, 'groq');
    assert.strictEqual(e.GROQ_API_KEY, 'gsk_TESTONLY3');
    assert.strictEqual(e.OPENWIKI_BASE_URL, 'https://api.groq.com/openai/v1');
});

test('finding 2: the wizard carries no stale per-provider model lists', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'installer.js'), 'utf8');
    const start = src.indexOf('async function promptCredentials');
    const wizard = src.slice(start, src.indexOf('const DAEMON_LOGON_FALLBACK_EXIT_CODE', start));
    assert.ok(!/claude-3\.5-sonnet|gpt-4o/.test(wizard));
});

const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const runInstaller = (h, code) => {
    const r = spawnSync(process.execPath, ['-e', `const i = require(${JSON.stringify(path.join(ROOT, 'installer.js'))}); (async () => { ${code} })();`], {
        encoding: 'utf8', timeout: 60000, env: { PATH: process.env.PATH, HOME: h, USERPROFILE: h },
    });
    assert.strictEqual(r.status, 0, r.stderr);
    return r.stdout + r.stderr;
};
const fresh = (n) => fs.mkdtempSync(path.join(home, `${n}-`));

test('finding 4: resolveFileConflict backs up once, then reuses an identical .bak after the manifest is lost', () => {
    const dir = fresh('bak');
    const target = path.join(dir, 'SKILL.md');
    const source = path.join(dir, 'src', 'SKILL.md');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(target, 'foreign v1\n');
    fs.writeFileSync(source, 'shipped v2\n');
    let manifest = {};
    const r1 = installer.resolveFileConflict(source, target, manifest, new Set());
    assert.strictEqual(r1, 'bak');
    const baks1 = fs.readdirSync(dir).filter((f) => f.endsWith('.bak'));
    assert.strictEqual(baks1.length, 1);
    assert.match(baks1[0], /^SKILL\.md\.\d{8}_\d{6}\.bak$/);
    assert.strictEqual(fs.readFileSync(path.join(dir, baks1[0]), 'utf8'), 'foreign v1\n');
    assert.strictEqual(manifest[target].backup, path.join(dir, baks1[0]));
    // Simulate a lost manifest and the same foreign content back on disk: the identical prior .bak is reused, no second backup.
    fs.writeFileSync(target, 'foreign v1\n');
    manifest = {};
    const r2 = installer.resolveFileConflict(source, target, manifest, new Set());
    assert.strictEqual(r2, 'bak');
    const baks2 = fs.readdirSync(dir).filter((f) => f.endsWith('.bak'));
    assert.strictEqual(baks2.length, 1);
    assert.strictEqual(manifest[target].backup, path.join(dir, baks1[0]));
});

test('finding 4: doctor lists installer .bak files, ignores *.notes.bak, deletes nothing', () => {
    const h = fresh('bakdoc');
    const dir = path.join(h, '.agents', 'skills', 'demo');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(h, '.agents', '.bdb-install-manifest.json'), JSON.stringify({ [path.join(dir, 'SKILL.md')]: { sha256: 'x' } }));
    const bak = path.join(dir, 'SKILL.md.20260101_120000.bak');
    const notes = path.join(dir, 'notes.notes.bak');
    fs.writeFileSync(bak, 'old\n');
    fs.writeFileSync(notes, 'keep\n');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'aos-doctor.mjs'), '--list-baks'], { env: { HOME: h, USERPROFILE: h, PATH: process.env.PATH }, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout.trim(), bak);
    assert.ok(fs.existsSync(bak) && fs.existsSync(notes), 'doctor must delete nothing');
});

test('finding 5: the replace prompt for a foreign Codenotch.app names its installed version', async () => {
    const { installCodenotch } = require('../lib/codenotch.js');
    const h = fresh('cn');
    const apps = path.join(h, 'Applications');
    const dest = path.join(apps, 'BDB AO Codenotch.app');
    fs.mkdirSync(path.join(dest, 'Contents'), { recursive: true });
    fs.writeFileSync(path.join(dest, 'Contents', 'Info.plist'), '<plist/>');
    const crypto = require('crypto');
    const dmgBuf = Buffer.from('fake-dmg');
    const dmgSha = crypto.createHash('sha256').update(dmgBuf).digest('hex');
    const release = { tag_name: 'v9.9.9', draft: false, prerelease: false, assets: [{ name: 'Codenotch.dmg', browser_download_url: 'x' }, { name: 'Codenotch.dmg.sha256', browser_download_url: 'y' }] };
    const plutil = () => { throw new Error('no version'); };
    const hdiutil = (args) => {
        const mp = args[args.indexOf('-mountpoint') + 1];
        fs.mkdirSync(path.join(mp, 'Codenotch.app'), { recursive: true });
    };
    let prompt = null;
    const destDir0 = path.join(apps, 'Codenotch.app');
    fs.mkdirSync(destDir0, { recursive: true });
    await installCodenotch({
        platform: 'darwin', home: h, interactive: true,
        roots: { applications: apps, userApplications: path.join(h, 'UserApplications'), tmp: path.join(h, 'tmp') },
        stateFile: path.join(h, 'state.json'),
        fetch: async (url) => url.includes('releases')
            ? { ok: true, json: async () => [release] }
            : { ok: true, arrayBuffer: async () => url === 'y' ? Buffer.from(dmgSha) : dmgBuf },
        confirm: async (m) => { prompt = m; return false; },
        plutil, hdiutil,
        log: { info() {}, warn() {}, success() {} },
    });
    assert.ok(prompt && /unknown version/.test(prompt), prompt);
});

test('finding 5: prompt uses CFBundleShortVersionString when present', async () => {
    const { installCodenotch } = require('../lib/codenotch.js');
    const h = fresh('cn2');
    const apps = path.join(h, 'Applications');
    fs.mkdirSync(path.join(h, 'tmp'), { recursive: true });
    const dest = path.join(apps, 'Codenotch.app');
    fs.mkdirSync(path.join(dest, 'Contents'), { recursive: true });
    fs.writeFileSync(path.join(dest, 'Contents', 'Info.plist'), '<plist/>');
    const crypto = require('crypto');
    const dmgBuf = Buffer.from('fake-dmg');
    const dmgSha = crypto.createHash('sha256').update(dmgBuf).digest('hex');
    const release = { tag_name: 'v9.9.9', draft: false, prerelease: false, assets: [{ name: 'Codenotch.dmg', browser_download_url: 'x' }, { name: 'Codenotch.dmg.sha256', browser_download_url: 'y' }] };
    let prompt = null;
    await installCodenotch({
        platform: 'darwin', home: h, interactive: true,
        roots: { applications: apps, userApplications: path.join(h, 'UserApplications'), tmp: path.join(h, 'tmp') },
        stateFile: path.join(h, 'state.json'),
        fetch: async (url) => url.includes('releases')
            ? { ok: true, json: async () => [release] }
            : { ok: true, arrayBuffer: async () => url === 'y' ? Buffer.from(dmgSha) : dmgBuf },
        confirm: async (m) => { prompt = m; return false; },
        plutil: (args) => args.includes('CFBundleShortVersionString') ? '1.2.3\n' : 'com.bdb.codenotch\n',
        hdiutil: (args) => { const mp = args[args.indexOf('-mountpoint') + 1]; fs.mkdirSync(path.join(mp, 'Codenotch.app'), { recursive: true }); },
        log: { info() {}, warn() {}, success() {} },
    });
    assert.ok(prompt && prompt.includes('1.2.3'), prompt);
});

test('finding 3: OpenCode plugin payload is installed when missing and left alone, silently, when identical', () => {
    const h = fresh('oc');
    const code = `i.installOpencodePlugin({ targetHome: ${JSON.stringify(h)}, configPath: ${JSON.stringify(path.join(h, '.config', 'opencode', 'opencode.jsonc'))} });`;
    const first = runInstaller(h, code);
    const plugin = path.join(h, '.config', 'opencode', 'plugins', 'bdb-aos.js');
    assert.match(first, /Installed OpenCode plugin/);
    assert.ok(fs.existsSync(plugin));
    const old = new Date(Date.now() - 3600_000);
    fs.utimesSync(plugin, old, old);
    const second = runInstaller(h, code);
    assert.doesNotMatch(second, /Installed OpenCode plugin|commands in .*written/);
    assert.strictEqual(fs.statSync(plugin).mtimeMs, old.getTime());
    fs.appendFileSync(plugin, '\n// local change\n');
    assert.match(runInstaller(h, code), /Installed OpenCode plugin/);
});
