// Doctor: agy hooks format and bdb-aos plugin registration per harness. Sandbox HOME only.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DOCTOR = path.resolve(__dirname, '..', 'bin', 'aos-doctor.mjs');
const write = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const NAMES = ['aos-go-gate', 'aos-conventional-commits', 'aos-env-protection', 'aos-trail-relay', 'aos-graph-gate', 'aos-context'];

function run(setup) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-docpl-'));
    try {
        setup(home);
        const env = { HOME: home, USERPROFILE: home, PATH: `${path.join(home, 'empty')}:/usr/bin:/bin` };
        const r = spawnSync(process.execPath, [DOCTOR, '--json'], { cwd: home, env, encoding: 'utf8' });
        assert.ok(r.stdout, `doctor crashed: ${r.stderr}`);
        const res = JSON.parse(r.stdout).results;
        return (n) => res.find((x) => x.name === n);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

test('agy hooks: old single "hooks" key warns', () => {
    const by = run((h) => write(path.join(h, '.gemini', 'config', 'hooks.json'), JSON.stringify({ hooks: { PreInvocation: [{ hooks: [{ command: 'node memb-inject.mjs' }] }] } })));
    const d = by('Antigravity hooks');
    assert.ok(!d.ok && d.warningOnly && /old format/.test(d.detail), d.detail);
    assert.match(d.detail, /loaded N named hooks/);
});

test('agy hooks: partially wired named format warns with the missing names', () => {
    const by = run((h) => write(path.join(h, '.gemini', 'config', 'hooks.json'), JSON.stringify({ 'aos-go-gate': { PreToolUse: [] } })));
    const d = by('Antigravity hooks');
    assert.ok(!d.ok && /missing .*aos-trail-relay/.test(d.detail), d.detail);
});

test('agy hooks: complete named format passes', () => {
    const by = run((h) => write(path.join(h, '.gemini', 'config', 'hooks.json'), JSON.stringify(Object.fromEntries(NAMES.map((n) => [n, { Stop: [] }])))));
    assert.ok(by('Antigravity hooks').ok, by('Antigravity hooks').detail);
});

test('plugin check: Claude settings registered + cache present passes, missing warns', () => {
    const bad = run((h) => write(path.join(h, '.claude', 'settings.json'), '{}'))('Claude Code bdb-aos plugin');
    assert.ok(!bad.ok && bad.warningOnly, bad.detail);
    const good = run((h) => {
        write(path.join(h, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'bdb-aos@bdb-marketplace': true }, extraKnownMarketplaces: { 'bdb-marketplace': { source: { source: 'github', repo: 'hybridlabor-api/aos' } } } }));
        const root = path.join(h, '.claude', 'plugins', 'cache', 'bdb-marketplace', 'bdb-aos', '1.0.0');
        write(path.join(root, 'plugin.json'), JSON.stringify({ skills: ['./skills'] }));
        write(path.join(root, 'skills', 'startcycle', 'SKILL.md'), '#');
    })('Claude Code bdb-aos plugin');
    assert.ok(good.ok, good.detail);
});

test('plugin check: opt-out is not a failure; Codex and agy are checked by their plugin dirs', () => {
    const by = run((h) => {
        write(path.join(h, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'bdb-aos@bdb-marketplace': false } }));
        write(path.join(h, '.codex', 'plugins', 'cache', 'bdb-aos', 'bdb-aos', '1.0.0', 'x'), '');
        fs.mkdirSync(path.join(h, '.gemini'), { recursive: true });
    });
    assert.ok(by('Claude Code bdb-aos plugin').ok);
    assert.ok(by('Codex bdb-aos plugin').ok);
    assert.ok(!by('Antigravity bdb-aos plugin').ok);
});
