// F3 doctor regressions (H-2, M-a, M-b, M-d). Sandbox HOME, PATH limited to the sandbox and /usr/bin:/bin.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DOCTOR = path.resolve(__dirname, '..', 'bin', 'aos-doctor.mjs');
const write = (p, text, mode) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text, { mode }); };

function run(setup, extraEnv = {}) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-docf3-'));
    try {
        setup(home);
        const r = spawnSync(process.execPath, [DOCTOR, '--json'], { cwd: home, env: { HOME: home, USERPROFILE: home, PATH: `${path.join(home, '.local', 'bin')}:/usr/bin:/bin`, ...(typeof extraEnv === 'function' ? extraEnv(home) : extraEnv) }, encoding: 'utf8' });
        assert.ok(r.stdout, `doctor crashed: ${r.stderr}`);
        const res = JSON.parse(r.stdout).results;
        return { res, status: r.status, by: (n) => res.find((x) => x.name === n) };
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

test('Codex layout: ~/.agents/skills is checked, a lone ~/.codex/skills/.system is fine', () => {
    const { by } = run((h) => {
        write(path.join(h, '.agents', 'skills', 'startcycle', 'SKILL.md'), '#');
        write(path.join(h, '.codex', 'skills', '.system', 'imagegen', 'SKILL.md'), '#');
    });
    assert.ok(by('Codex Skills').ok, by('Codex Skills').detail);
    assert.equal(by('Codex duplicate skills'), undefined);
});

test('AOS copies in both Codex roots warn, never fail', () => {
    const { by } = run((h) => {
        for (const r of ['.agents', '.codex']) write(path.join(h, r, 'skills', 'startcycle', 'SKILL.md'), '#');
    });
    const d = by('Codex duplicate skills');
    assert.ok(d && !d.ok && d.warningOnly, JSON.stringify(d));
});

test('a real ao in ~/.local/bin is executed (absolute path, no ~ expansion) and a missing AO is only a warning', () => {
    const withAo = run((h) => write(path.join(h, '.local', 'bin', 'ao'), '#!/bin/sh\necho "ao 9.9.9"\n', 0o755));
    assert.match(withAo.by('AO Agent Orchestrator').detail, /9\.9\.9/);
    const noAo = run(() => {});
    const ao = noAo.by('AO Agent Orchestrator');
    assert.ok(!ao.ok && ao.warningOnly);
});

test('CLAUDE_CONFIG_DIR is honoured for the Claude skills check', () => {
    const { by } = run((h) => write(path.join(h, 'cfg', 'skills', 'startcycle', 'SKILL.md'), '#'), (h) => ({ CLAUDE_CONFIG_DIR: path.join(h, 'cfg') }));
    assert.ok(by('Claude Code Skills').ok, by('Claude Code Skills').detail);
    const plain = run((h) => write(path.join(h, 'cfg', 'skills', 'startcycle', 'SKILL.md'), '#'));
    assert.ok(!plain.by('Claude Code Skills').ok);
});
