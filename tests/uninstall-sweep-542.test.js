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
const winStartup = require('../lib/v5/win-startup.js');

const sandbox = () => { const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-sweep-')); fs.mkdirSync(path.join(home, 'empty-bin')); return home; };
const env = (home) => ({ HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), PATH: path.join(home, 'empty-bin'), AOS_PLUGIN_CLI: 'off' });
const write = (p, text = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
const tree = (d) => fs.readdirSync(d, { recursive: true }).sort().join('\n');
const uninstall = (home, ...flags) => spawnSync(process.execPath, [path.join(REPO, 'bin', 'aos-uninstall.mjs'), ...flags], { cwd: home, env: env(home), encoding: 'utf8' });

// A manifest whose files are all still unchanged; `recorded` are the AOS files.
function install(home, recorded) {
    const manifest = {};
    for (const f of recorded) { write(f, 'aos'); manifest[f] = { sha256: sha('aos') }; }
    write(path.join(home, '.agents', '.bdb-install-manifest.json'), JSON.stringify(manifest));
}

test('empty folders AOS created go; user files, user skills, unrecorded dirs, links and every root stay', () => {
    const home = sandbox();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-sweep-outside-'));
    try {
        const j = (...p) => path.join(home, ...p);
        // 252-style empty skill copies: AOS files recorded, nothing else inside.
        install(home, [j('.claude', 'skills', 'fabric', 'SKILL.md'), j('.claude', 'skills', 'fabric', 'references', 'a.md'), j('.agents', 'rules', 'r.md'), j('.claude', 'agents', 'a.md'), j('.codex', 'hooks', 'h.mjs')]);
        write(j('.claude', 'skills', 'mine', 'SKILL.md'), 'user skill');           // user skill next to AOS ones
        write(j('.codex', 'workflows', 'keep.txt'), 'user file in a recorded-parent');
        write(j('.agents', 'workflows', 'w.md'));                                 // not recorded
        write(j('.claude', 'hooks', 'own.sh'), 'user hook');
        fs.mkdirSync(j('.codex', '.tmp'), { recursive: true });                    // created by Codex: not recorded
        write(path.join(outside, 'precious.txt'), 'outside');
        fs.mkdirSync(j('.agents', 'lib'), { recursive: true });
        write(j('.agents', 'lib', 'x.js'));
        fs.symlinkSync(outside, j('.agents', 'packs'));                            // link inside AOS space
        const manifestPath = j('.agents', '.bdb-install-manifest.json');
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const viaLink = j('.agents', 'packs', 'p.md');
        m[viaLink] = { sha256: sha('aos') };                                       // a recorded path behind the link
        fs.writeFileSync(manifestPath, JSON.stringify(m));
        write(path.join(outside, 'p.md'), 'aos');
        write(j('.agents', 'lib', 'y.js'), 'aos'); m[j('.agents', 'lib', 'y.js')] = { sha256: sha('aos') }; m[j('.agents', 'lib', 'x.js')] = { sha256: sha('x') };
        fs.writeFileSync(manifestPath, JSON.stringify(m));

        const before = tree(home);
        const dry = uninstall(home, '--dry-run');
        assert.strictEqual(dry.status, 0, dry.stderr);
        assert.strictEqual(tree(home), before, 'dry-run changes nothing');
        assert.match(dry.stdout, /Folders AOS created that are empty/);

        const r = uninstall(home, '--yes');
        assert.strictEqual(r.status, 0, r.stderr + r.stdout);
        assert.ok(!fs.existsSync(j('.claude', 'skills', 'fabric')), 'emptied AOS skill copy removed');
        assert.ok(!fs.existsSync(j('.agents', 'rules')) && !fs.existsSync(j('.claude', 'agents')) && !fs.existsSync(j('.codex', 'hooks')), 'emptied skeleton dirs removed');
        assert.ok(fs.existsSync(j('.claude', 'skills', 'mine', 'SKILL.md')), 'user skill survives');
        assert.ok(fs.existsSync(j('.claude', 'skills')), 'skills root survives while it holds a user skill');
        assert.ok(fs.existsSync(j('.codex', 'workflows', 'keep.txt')) && fs.existsSync(j('.agents', 'workflows', 'w.md')) && fs.existsSync(j('.claude', 'hooks', 'own.sh')), 'user files survive');
        assert.ok(fs.existsSync(j('.codex', '.tmp')), 'a dir AOS did not record stays');
        assert.ok(fs.lstatSync(j('.agents', 'packs')).isSymbolicLink(), 'link is not followed or removed');
        assert.strictEqual(fs.readFileSync(path.join(outside, 'precious.txt'), 'utf8'), 'outside');
        assert.ok(fs.existsSync(path.join(outside, 'p.md')), 'a recorded path behind a link is not touched');
        for (const root of [home, j('.claude'), j('.codex'), j('.agents')]) assert.ok(fs.existsSync(root), `${root} survives`);
    } finally { rm(home); rm(outside); }
});

test('candidateDirs: Windows separators and case fold; never $HOME, a first-level root or anything above', () => {
    const home = 'C:\\Users\\api';
    const dirs = sweep.candidateDirs(home, ['c:/users/API/.claude/skills/x/SKILL.md', 'C:\\Users\\api\\.agents\\bin\\aos.mjs', 'C:\\Users\\other\\.claude\\skills\\z\\f', 'C:\\Users\\api\\..\\evil\\f', 'C:\\Users\\api\\f.txt'], 'win32');
    const low = dirs.map((d) => d.toLowerCase());
    assert.deepStrictEqual(low, ['c:\\users\\api\\.claude\\skills\\x', 'c:\\users\\api\\.claude\\skills', 'c:\\users\\api\\.agents\\bin']);
    for (const bad of ['c:\\users\\api', 'c:\\users', 'c:\\users\\api\\.claude', 'c:\\users\\api\\.agents', 'c:\\users\\other\\.claude\\skills']) assert.ok(!low.includes(bad), bad);
    assert.deepStrictEqual(sweep.candidateDirs('/h', ['/h/.config/opencode/commands/c.md'], 'linux'), ['/h/.config/opencode/commands']);
});

test('--purge removes AOS state only while it is AOS-owned and names everything it keeps', () => {
    const home = sandbox();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-purge-outside-'));
    try {
        const j = (...p) => path.join(home, ...p);
        install(home, [j('.agents', 'rules', 'r.md')]);
        write(j('.aos', 'hub', 'hub.json')); write(j('.aos', 'logs', 'u.log')); write(j('.aos', 'codex-hooks.json')); write(j('.aos', 'status.json'));
        write(j('.aos', 'pipeline.json'), '{"edited":true}');                       // user-edited: stays
        write(j('.aos', 'backups', 'uninstall-1', 'b.json'));
        write(j('.aos', 'v5-settings.json.removed-20260101'));
        write(j('.agents', 'gateway', 'g.json')); write(j('.agents', 'backups', 'plugin-x', 'f'));
        write(j('.gemini', 'config', 'hooks.json'), JSON.stringify({ 'aos-go-gate': {} }));
        write(j('.gemini', 'config', 'mcp_config.json'), JSON.stringify({ mcpServers: { mine: { command: 'x' } } })); // user server: stays
        write(j('.gemini', 'config', 'import_manifest.json'));
        write(j('.openwiki', 'cred')); write(j('.MemBDB', 'm.db'));
        write(path.join(outside, 'precious.txt'), 'outside');
        fs.rmSync(j('.aos', 'logs'), { recursive: true });
        fs.symlinkSync(outside, j('.aos', 'logs'));                                 // a link where a purge target is
        write(j('notes.txt'), 'user file in HOME');

        const dry = uninstall(home, '--purge', '--dry-run');
        assert.strictEqual(dry.status, 0, dry.stderr);
        assert.ok(fs.existsSync(j('.aos', 'hub', 'hub.json')) && fs.existsSync(j('.openwiki', 'cred')), 'dry-run deletes nothing');
        assert.match(dry.stdout, /\.aos\/backups/);

        const r = uninstall(home, '--purge', '--yes');
        assert.strictEqual(r.status, 0, r.stderr + r.stdout);
        for (const gone of [['.aos', 'hub'], ['.aos', 'codex-hooks.json'], ['.aos', 'status.json'], ['.agents', 'gateway'], ['.gemini', 'config', 'hooks.json'], ['.openwiki'], ['.MemBDB'], ['.aos', 'logs']]) assert.ok(!fs.existsSync(j(...gone)), `${gone.join('/')} removed`);
        for (const kept of [['.aos', 'pipeline.json'], ['.aos', 'backups', 'uninstall-1', 'b.json'], ['.aos', 'v5-settings.json.removed-20260101'], ['.agents', 'backups', 'plugin-x', 'f'], ['.gemini', 'config', 'mcp_config.json'], ['.gemini', 'config', 'import_manifest.json'], ['notes.txt']]) assert.ok(fs.existsSync(j(...kept)), `${kept.join('/')} kept`);
        assert.strictEqual(fs.readFileSync(path.join(outside, 'precious.txt'), 'utf8'), 'outside', 'the link target is untouched');
        assert.ok(fs.existsSync(home));
        const kept = r.stdout.slice(r.stdout.lastIndexOf('Kept:'));
        for (const needle of ['.aos/backups', '.agents/backups', 'v5-settings.json.removed-20260101', 'import_manifest.json', 'pipeline.json', 'mcp_config.json', '.bak']) assert.ok(kept.includes(needle), `Kept names ${needle}\n${kept}`);
        assert.match(r.stdout, /npm uninstall -g @hybridlabor-api\/aos/);
    } finally { rm(home); rm(outside); }
});

test('guardedRemove refuses $HOME, shared roots and paths behind a link', () => {
    const home = sandbox();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-guard-outside-'));
    try {
        write(path.join(outside, 'f'), 'x');
        fs.mkdirSync(path.join(home, '.claude'));
        fs.symlinkSync(outside, path.join(home, '.openwiki'));
        assert.strictEqual(sweep.guardedRemove({ home, target: home }), 'refused');
        assert.strictEqual(sweep.guardedRemove({ home, target: path.dirname(home) }), 'refused');
        assert.strictEqual(sweep.guardedRemove({ home, target: path.join(home, '.claude') }), 'refused');
        assert.strictEqual(sweep.guardedRemove({ home, target: path.join(home, '.openwiki', 'f') }), 'refused');
        assert.ok(fs.existsSync(path.join(outside, 'f')) && fs.existsSync(path.join(home, '.claude')));
    } finally { rm(home); rm(outside); }
});

test('Windows services: the visualizer is stopped by its "visualize --port N" command line, scripts by their path under this home', async () => {
    const mod = await import(pathToFileURL(path.join(REPO, 'bin', 'aos-uninstall.mjs')).href);
    const home = sandbox();
    try {
        const bat = path.join(home, '.openwiki', 'run-openwiki-visualize.bat');
        write(bat, `@echo off\r\ncd /d "${home}"\r\n"C:\\Users\\api\\AppData\\Roaming\\npm\\openwiki.cmd" visualize --port 4322 --no-open >> "${home}\\.openwiki\\visualize.stdout.log" 2>> "${home}\\.openwiki\\e.log"\r\n`);
        assert.deepStrictEqual(mod.batStopSpecs(bat, home), { paths: [], all: ['openwiki', 'visualize', '--port 4322'] });
        const syn = path.join(home, '.synapse', 'run-synapse.bat');
        write(syn, `@echo off\r\nnode "${home}\\.agents\\bdb-synapse\\bin\\synapse.js" serve --port 7781 --no-open\r\n`);
        assert.deepStrictEqual(mod.batStopSpecs(syn, home).paths, [`${home}\\.agents\\bdb-synapse\\bin\\synapse.js`]);
        const ps = winStartup.stopAllArgs(['openwiki', 'visualize', '--port 4322']).join(' ');
        assert.match(ps, /Contains\('openwiki'\) -and .*Contains\('visualize'\) -and .*Contains\('--port 4322'\)/);
        assert.match(ps, /GetOwner/, 'only this user\'s processes');
        assert.match(ps, /\$_\.ProcessId -ne \$PID/);
    } finally { rm(home); }
});
