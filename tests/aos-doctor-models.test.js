// aos-doctor agent model override checks. Sandbox HOME, format check only.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DOCTOR = path.resolve(__dirname, '..', 'bin', 'aos-doctor.mjs');

function run(pipeline, where = 'project') {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-docmodels-'));
    try {
        const file = where === 'project' ? path.join(home, '.aos', 'pipeline.json') : path.join(home, 'elsewhere', '.aos', 'pipeline.json');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, typeof pipeline === 'string' ? pipeline : JSON.stringify({ version: 1, pipeline }));
        const cwd = where === 'project' ? home : path.join(home, 'elsewhere');
        const r = spawnSync(process.execPath, [DOCTOR, '--json'], { cwd, env: { HOME: home, USERPROFILE: home, PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
        assert.ok(r.stdout, `doctor crashed: ${r.stderr}`);
        return JSON.parse(r.stdout).results.filter((x) => x.area === 'agents');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

test('valid overrides, including custom providers and fable, pass', () => {
    const res = run({
        architect: { models: { claude: 'fable', opencode: 'my-proxy/some.model:1', codex: 'o3', antigravity: 'pro' } },
        reviewer: { harness: 'claude', model: 'claude-opus-5-5' },
    });
    assert.deepStrictEqual(res, []);
});

test('OpenCode without provider/ is an error naming file, role, harness and value', () => {
    const [e, ...rest] = run({ architect: { models: { opencode: 'fable' } } });
    assert.deepStrictEqual(rest, []);
    assert.strictEqual(e.ok, false);
    assert.notStrictEqual(e.warningOnly, true);
    for (const part of ['pipeline.json', 'role "architect"', 'harness "opencode"', '"fable"', 'provider/model']) assert.ok(e.detail.includes(part), `${part} in ${e.detail}`);
});

test('whitespace, empty, non-string and unknown harness are errors', () => {
    const res = run({
        a: { models: { claude: 'opus 4' } },
        b: { models: { codex: '' } },
        c: { models: { antigravity: 5 } },
        d: { models: { cursor: 'x' } },
    });
    assert.deepStrictEqual(res.map((r) => r.name).sort(), ['Agent model a/claude', 'Agent model b/codex', 'Agent model c/antigravity', 'Agent model d/cursor']);
    assert.ok(res.every((r) => !r.ok && !r.warningOnly));
});

test('legacy model without harness is checked against OpenCode too', () => {
    const res = run({ reviewer: { model: 'opus' } });
    assert.deepStrictEqual(res.map((r) => r.name), ['Agent model reviewer/opencode']);
});

test('a broken pipeline.json is reported, not silently ignored', () => {
    const [e] = run('{ nope');
    assert.strictEqual(e.ok, false);
    assert.match(e.detail, /not valid JSON/);
});
