'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const DISPATCH = path.join(ROOT, '.claude', 'workflows', 'fabric-dispatch.mjs');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-models-'));
test.after(() => fs.rmSync(base, { recursive: true, force: true }));

// Imports the dispatcher with a recording agent() and returns the spawn options it passed, in order.
function spawnOpts({ userPipeline, projectPipeline, installDefault }) {
    const dir = fs.mkdtempSync(path.join(base, 'case-'));
    const home = path.join(dir, 'home');
    const cwd = path.join(dir, 'proj');
    fs.mkdirSync(path.join(home, '.aos'), { recursive: true });
    fs.mkdirSync(path.join(cwd, '.aos'), { recursive: true });
    if (installDefault) {
        const inst = spawnSync(process.execPath, ['-e',
            `process.env.HOME=${JSON.stringify(home)};require(${JSON.stringify(path.join(ROOT, 'installer.js'))}).installPipelineDefault({targetHome:${JSON.stringify(home)}})`],
            { env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: '', CODEX_HOME: '' }, encoding: 'utf8' });
        assert.strictEqual(inst.status, 0, inst.stderr);
    }
    if (userPipeline) fs.writeFileSync(path.join(home, '.aos', 'pipeline.json'), JSON.stringify(userPipeline));
    if (projectPipeline) fs.writeFileSync(path.join(cwd, '.aos', 'pipeline.json'), JSON.stringify(projectPipeline));
    const harness = path.join(dir, 'run.mjs');
    fs.writeFileSync(harness, `
import fs from 'node:fs';
const calls = [];
globalThis.args = { goal: '--skill=foo build a thing' };
globalThis.pipeline = (items, fn) => Promise.all(items.map(fn));
globalThis.agent = async (prompt, opts) => {
  calls.push(opts);
  if (opts.label === 'load-registry') return JSON.parse(fs.readFileSync(${JSON.stringify(path.join(ROOT, '.agents', 'nodes.json'))}, 'utf8'));
  if (opts.label === 'validate-mandatory-skills') return { found: ['foo'], missing: [], store_matches: [] };
  if (opts.label.startsWith('architect')) return { planPath: 'p.md', needsMedia: false, deliverOk: true };
  throw new Error('stop');
};
await import(${JSON.stringify(pathToFileURL(DISPATCH).href)});
process.stdout.write(JSON.stringify(calls));
`);
    const r = spawnSync(process.execPath, [harness], {
        cwd, env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.strictEqual(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
}
const byLabel = (calls, re) => calls.find((c) => re.test(c.label));

test('no config: no spawn carries a model', () => {
    const calls = spawnOpts({});
    assert.ok(byLabel(calls, /^architect/) && byLabel(calls, /^load-registry/) && byLabel(calls, /^validate/) && byLabel(calls, /^archify-verify/));
    for (const c of calls) assert.ok(!('model' in c), `${c.label} has no model`);
});

test('pipeline override: node model passed verbatim (slug key, then node id), others still inherit', () => {
    const calls = spawnOpts({ userPipeline: { version: 1, pipeline: { architect: { models: { claude: 'my-model.X' } }, load_registry: { model: 'weird-id' } } } });
    assert.strictEqual(byLabel(calls, /^architect/).model, 'my-model.X');
    assert.strictEqual(byLabel(calls, /^load-registry/).model, 'weird-id');
    assert.ok(!('model' in byLabel(calls, /^validate/)));
});

test('a bad override value is not passed and not replaced', () => {
    const calls = spawnOpts({ userPipeline: { pipeline: { architect: { models: { claude: 'a b' } } } } });
    assert.ok(!('model' in byLabel(calls, /^architect/)));
});

test('shipped default: helper agents get haiku, nodes inherit', () => {
    const calls = spawnOpts({ installDefault: true });
    for (const re of [/^load-registry/, /^validate/, /^archify-verify/]) assert.strictEqual(byLabel(calls, re).model, 'haiku', String(re));
    assert.ok(!('model' in byLabel(calls, /^architect/)));
    assert.match(fs.readFileSync(DISPATCH, 'utf8'), /modelOpt\('merge_state'\)/);
});

test('a user pipeline.json replaces the default whole; project file replaces the user file', () => {
    const user = spawnOpts({ installDefault: true, userPipeline: { pipeline: { architect: { models: { claude: 'opus' } } } } });
    assert.strictEqual(byLabel(user, /^architect/).model, 'opus');
    assert.ok(!('model' in byLabel(user, /^archify-verify/)), 'user file has no helper entry, so it inherits');
    const proj = spawnOpts({ userPipeline: { pipeline: { architect: { model: 'user-m' } } }, projectPipeline: { pipeline: { architect: { model: 'proj-m' } } } });
    assert.strictEqual(byLabel(proj, /^architect/).model, 'proj-m');
});

test('installPipelineDefault writes once and never overwrites a user file', () => {
    const home = fs.mkdtempSync(path.join(base, 'inst-'));
    const run = () => spawnSync(process.execPath, ['-e',
        `console.log(require(${JSON.stringify(path.join(ROOT, 'installer.js'))}).installPipelineDefault({targetHome:${JSON.stringify(home)}}))`],
        { env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: '', CODEX_HOME: '' }, encoding: 'utf8' });
    assert.strictEqual(run().stdout.trim().split('\n').pop(), 'true');
    const file = path.join(home, '.aos', 'pipeline.json');
    const written = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(written._comment && written.pipeline.merge_state.models.claude === 'haiku');
    fs.writeFileSync(file, '{"pipeline":{}}');
    assert.strictEqual(run().stdout.trim().split('\n').pop(), 'false');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), '{"pipeline":{}}');
});

test('nodes.json pins no model and the dispatcher hardcodes none', () => {
    const nodes = JSON.parse(fs.readFileSync(path.join(ROOT, '.agents', 'nodes.json'), 'utf8'));
    for (const [id, n] of Object.entries(nodes.nodes)) assert.ok(!('model' in n), id);
    assert.doesNotMatch(fs.readFileSync(DISPATCH, 'utf8'), /model:\s*'(haiku|sonnet|opus)'/);
});
