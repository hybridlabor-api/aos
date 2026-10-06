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
        architect: { models: { claude: 'opus 4' } },
        reviewer: { models: { codex: '', claude: 'a\nb' } },
        techlead: { models: { antigravity: 5 } },
        godmode_shipping: { models: { cursor: 'x' } },
    });
    assert.deepStrictEqual(res.map((r) => r.name).sort(), ['Agent model architect/claude', 'Agent model godmode_shipping/cursor', 'Agent model reviewer/claude', 'Agent model reviewer/codex', 'Agent model techlead/antigravity']);
    assert.ok(res.every((r) => !r.ok && !r.warningOnly));
});

test('legacy model without harness is checked against every harness', () => {
    const res = run({ reviewer: { model: 'opus' } });
    assert.deepStrictEqual(res.map((r) => r.name).sort(), ['Agent model reviewer/antigravity', 'Agent model reviewer/opencode']);
});

test('antigravity accepts only inherit|flash|pro and the error cites docs/agent-models.md', () => {
    assert.deepStrictEqual(run({ architect: { models: { antigravity: 'flash' } } }), []);
    const [e] = run({ architect: { harness: 'antigravity', model: 'gemini-3.8-flash-high' } });
    assert.strictEqual(e.ok, false);
    assert.notStrictEqual(e.warningOnly, true);
    assert.match(e.detail, /inherit\|flash\|pro/);
    assert.match(e.detail, /docs\/agent-models\.md/);
});

test('an old --init-default file: tier warns, its gemini model errors, claude/codex models pass', () => {
    const res = run({
        architect: { enabled: true, harness: 'claude', tier: 'reasoning_max', model: 'opus' },
        techlead: { enabled: true, harness: 'antigravity', tier: 'standard_fast', model: 'gemini-3.8-flash-high' },
        reviewer: { enabled: true, harness: 'codex', tier: 'reasoning_max', model: 'o3-mini' },
    });
    const tiers = res.filter((r) => r.name.startsWith('Agent tier'));
    assert.strictEqual(tiers.length, 3);
    assert.ok(tiers.every((r) => !r.ok && r.warningOnly === true && /Remove "tier"/.test(r.fix)));
    assert.deepStrictEqual(res.filter((r) => !r.ok && !r.warningOnly).map((r) => r.name), ['Agent model techlead/antigravity']);
});

test('a role key matching no agent warns (inert override)', () => {
    const res = run({ uix: { models: { claude: 'fable' } }, godmode_ui_ux: { models: { claude: 'fable' } } });
    assert.deepStrictEqual(res.map((r) => r.name), ['Agent role uix']);
    assert.strictEqual(res[0].warningOnly, true);
});

test('dispatcher node ids and helper roles are valid keys', () => {
    const m = { models: { claude: 'haiku' } };
    assert.deepStrictEqual(run({ ui_ux: m, load_registry: m, merge_state: m, archify_verify: m, validate_skills: m }), []);
});

test('models that is not an object is an error, not "unknown harness 0"', () => {
    const res = run({ architect: { models: ['claude'] } });
    assert.deepStrictEqual(res.map((r) => r.name), ['Agent models architect']);
    assert.match(res[0].detail, /must be an object/);
});

test('a broken pipeline.json is reported, not silently ignored', () => {
    const [e] = run('{ nope');
    assert.strictEqual(e.ok, false);
    assert.match(e.detail, /not valid JSON/);
});
