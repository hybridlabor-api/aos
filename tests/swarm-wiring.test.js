const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const nodes = JSON.parse(fs.readFileSync(path.join(ROOT, '.agents', 'nodes.json'), 'utf8'));
const agentsMd = fs.readFileSync(path.join(ROOT, '.agents', 'AGENTS.md'), 'utf8');
const dispatch = fs.readFileSync(path.join(ROOT, '.claude', 'workflows', 'startcycle-dispatch.mjs'), 'utf8');
const { parseAgentsMd, loadCommonSkills } = require('../installer.js');

function skillNames() {
    const names = new Set();
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name === 'SKILL.md') names.add(path.basename(dir));
        }
    };
    walk(path.join(ROOT, 'skills'));
    return names;
}

test('nodes.json declares a unique common skill list that exists', () => {
    assert.ok(Array.isArray(nodes.common) && nodes.common.length > 0);
    assert.strictEqual(new Set(nodes.common).size, nodes.common.length);
    const known = skillNames();
    for (const s of nodes.common) assert.ok(known.has(s), `common skill ${s} has no SKILL.md`);
});

test('every compiled agent lists the common skills and keeps its own', () => {
    const before = parseAgentsMd(agentsMd, []);
    const after = parseAgentsMd(agentsMd);
    assert.strictEqual(after.length, before.length);
    after.forEach((a, i) => {
        assert.strictEqual(a.name, before[i].name);
        assert.strictEqual(a.model, before[i].model);
        for (const s of before[i].skills) assert.ok(a.skills.includes(s), `${a.name} lost ${s}`);
        for (const s of nodes.common) assert.ok(a.skills.includes(s), `${a.name} misses common ${s}`);
        assert.strictEqual(new Set(a.skills).size, a.skills.length);
    });
});

test('a registry without common behaves as before', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-nodes-'));
    fs.mkdirSync(path.join(dir, '.agents'));
    fs.writeFileSync(path.join(dir, '.agents', 'nodes.json'), JSON.stringify({ version: 1, nodes: {} }));
    assert.deepStrictEqual(loadCommonSkills(dir), []);
    assert.deepStrictEqual(loadCommonSkills(path.join(dir, 'missing')), []);
});

test('dispatcher prefers skills instead of closing the list', () => {
    assert.ok(!dispatch.includes('Do not reach for skills outside this list'));
    assert.ok(dispatch.includes('Prefer these skills for this work'));
    assert.match(dispatch, /common: \{ type: 'array'/);
    assert.match(dispatch, /commonSkills = Array\.isArray\(registryResult\?\.common\)/);
});

test('the seven pipeline nodes keep their order and models', () => {
    assert.deepStrictEqual(Object.keys(nodes.nodes), ['architect', 'techlead', 'ui_ux', 'engineering', 'media_eventtech', 'reviewer', 'shipping']);
    for (const [id, n] of Object.entries(nodes.nodes)) {
        assert.ok(n.skills.length > 0, `${id} has own skills`);
        assert.ok(n.model, `${id} has a model`);
    }
});
