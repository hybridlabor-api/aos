// Doctor: agy hooks format and bdb-aos plugin registration per harness. Sandbox HOME only.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DOCTOR = path.resolve(__dirname, '..', 'bin', 'aos-doctor.mjs');
const write = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const NAMES = ['aos-go-gate', 'aos-conventional-commits', 'aos-env-protection', 'aos-trail-relay', 'aos-graph-gate', 'aos-context', 'aos-a2a-inbox'];

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

test('Claude duplicate skills: a manifest-recorded loose copy of a plugin skill warns; an unrecorded one does not', () => {
    const setup = (recordLoose) => (h) => {
        const root = path.join(h, '.claude', 'plugins', 'cache', 'bdb-marketplace', 'bdb-aos', '1.0.0');
        write(path.join(root, 'plugin.json'), JSON.stringify({ skills: ['./skills'] }));
        write(path.join(root, 'skills', 'startcycle', 'SKILL.md'), '#');
        write(path.join(h, '.claude', 'skills', 'startcycle', 'SKILL.md'), '#');
        write(path.join(h, '.agents', '.bdb-install-manifest.json'), JSON.stringify(recordLoose ? { [path.join(h, '.claude', 'skills', 'startcycle', 'SKILL.md')]: { sha256: 'x' } } : {}));
    };
    const d = run(setup(true))('Claude duplicate skills');
    assert.ok(d && !d.ok && d.warningOnly, JSON.stringify(d));
    assert.match(d.fix, /run the AOS installer again; it backs up and retires the loose copies \(aos-uninstall --restore-plugin-backup restores them\)/i);
    assert.equal(run(setup(false))('Claude duplicate skills'), undefined);
});

function modsRow(settings, withClaude = true) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-docmods-'));
    try {
        if (settings) write(path.join(home, '.claude', 'settings.json'), JSON.stringify(settings));
        const bin = path.join(home, 'bin');
        if (withClaude) { write(path.join(bin, 'claude'), '#!/bin/sh\necho "2.1.162 (Claude Code)"\n'); fs.chmodSync(path.join(bin, 'claude'), 0o755); }
        const env = { HOME: home, USERPROFILE: home, AOS_TEST_SANDBOX: 'container', PATH: `${bin}:/usr/bin:/bin` };
        const r = spawnSync(process.execPath, [DOCTOR, '--json'], { cwd: home, env, encoding: 'utf8' });
        assert.ok(r.stdout, `doctor crashed: ${r.stderr}`);
        return JSON.parse(r.stdout).results.find((x) => x.name === 'Claude Code mods');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

test('Claude Code mods row: warns with the fix when claude is installed and a mod is not enabled', () => {
    const d = modsRow({ enabledPlugins: { 'bdb-aos-fleet@bdb-marketplace': true } });
    assert.ok(!d.ok && d.warningOnly, JSON.stringify(d));
    assert.match(d.detail, /enabled: fleet; not enabled: sessions, alert, control; Claude Code in PATH is 2\.1\.162/);
    assert.match(d.fix, /claude update.*aos package install sessions\|alert\|control/);
});

test('Claude Code mods row: passes when all four are enabled, absent without claude', () => {
    const all = Object.fromEntries(['fleet', 'sessions', 'alert', 'control'].map((m) => [`bdb-aos-${m}@bdb-marketplace`, true]));
    assert.ok(modsRow({ enabledPlugins: all }).ok);
    assert.equal(modsRow({}, false), undefined);
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
