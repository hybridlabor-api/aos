const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'codex-gate-smoke.mjs');
const REPO = path.join(__dirname, '..');

function withFakeCodex(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-smoke-'));
    try {
        const log = path.join(dir, 'called');
        fs.writeFileSync(path.join(dir, 'codex'), `#!/bin/sh\necho called >> "${log}"\n`, { mode: 0o755 });
        return fn(dir, log);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('default prints the plan and never calls codex', () => withFakeCodex((dir, log) => {
    const r = spawnSync(process.execPath, [SCRIPT], { env: { PATH: `${dir}:${process.env.PATH}`, HOME: dir }, encoding: 'utf8' });
    assert.equal(r.status, 0);
    for (const id of ['exec-fires', 'exec-denies', 'acp-fires']) assert.match(r.stdout, new RegExp(`\\[${id}\\]`));
    assert.match(r.stdout, /UNVERIFIED/);
    assert.equal(fs.existsSync(log), false);
}));

test('--run refuses without AOS_CODEX_SMOKE=1 and never calls codex', () => withFakeCodex((dir, log) => {
    const r = spawnSync(process.execPath, [SCRIPT, '--run'], { env: { PATH: `${dir}:${process.env.PATH}`, HOME: dir }, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /paid API/);
    assert.equal(fs.existsSync(log), false);
}));

test('the generated config carries the PreToolUse stanza with the probe hook', async () => {
    const { pathToFileURL } = require('url');
    const { buildConfig } = await import(pathToFileURL(SCRIPT).href);
    const toml = buildConfig('/x/probe-hook.mjs');
    assert.match(toml, /^\[features\]\nhooks = true/);
    assert.match(toml, /\[\[hooks\.PreToolUse\]\]\nmatcher = /);
    assert.match(toml, /command = "node \\"\/x\/probe-hook\.mjs\\""/);
});

test('--codex-gate is documented in the installer help and the doc says UNVERIFIED', () => {
    const doc = fs.readFileSync(path.join(REPO, 'docs', 'codex-gate-smoke.md'), 'utf8');
    assert.match(doc, /--codex-gate/);
    assert.match(doc, /UNVERIFIED/);
    assert.match(fs.readFileSync(path.join(REPO, 'installer.js'), 'utf8'), /--codex-gate\s+Print the go-gate/);
});
