const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-models-home-'));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
test.after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

const inst = require('../installer.js');
const { parseAgentsMd, compileClaudeAgents, compileOpenCodeAgents, compileCodexAgents, resolveAgentConfig, resolveFileConflict, buildKnownSourceHashes } = inst;

const root = path.join(__dirname, '..');
const agents = parseAgentsMd(fs.readFileSync(path.join(root, '.agents', 'AGENTS.md'), 'utf8'));
const modelOf = (file) => (fs.readFileSync(file, 'utf8').match(/^model\s*[:=]\s*(.+)$/m) || [])[1];
const mdFiles = (dir) => fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.md')).map((f) => path.join(root, dir, f));
const tmp = () => fs.mkdtempSync(path.join(tmpHome, 'case-'));

describe('agent model resolution', () => {
    test('no pipeline config: no model on any harness', () => {
        for (const h of ['claude', 'codex', 'opencode', 'antigravity']) {
            assert.strictEqual(resolveAgentConfig('architect', h, null).model, null, h);
            assert.strictEqual(resolveAgentConfig('reviewer', h, {}).model, null, h);
        }
    });

    test('overrides are verbatim, per role and harness', () => {
        const pipeline = {
            architect: { models: { claude: 'fable', opencode: 'myprov/My-Model.1', codex: 'o3-mini', antigravity: 'pro' } },
            reviewer: { harness: 'claude', model: 'Claude-Opus-5-5' },
            godmode_shipping: { model: 'anything' },
        };
        assert.strictEqual(resolveAgentConfig('architect', 'claude', pipeline).model, 'fable');
        assert.strictEqual(resolveAgentConfig('architect', 'opencode', pipeline).model, 'myprov/My-Model.1');
        assert.strictEqual(resolveAgentConfig('architect', 'codex', pipeline).model, 'o3-mini');
        assert.strictEqual(resolveAgentConfig('architect', 'antigravity', pipeline).model, 'pro');
        assert.strictEqual(resolveAgentConfig('reviewer', 'claude', pipeline).model, 'Claude-Opus-5-5');
        assert.strictEqual(resolveAgentConfig('reviewer', 'codex', pipeline).model, null, 'legacy model is bound to its harness');
        assert.strictEqual(resolveAgentConfig('godmode-shipping', 'opencode', pipeline).model, 'anything', 'no harness = every harness');
    });

    test('a tier is not a model', () => {
        assert.strictEqual(resolveAgentConfig('architect', 'claude', { architect: { tier: 'reasoning_max' } }).model, null);
    });
});

describe('compilers write a model only for an override', () => {
    test('no override: no model line in any harness file', () => {
        const d = tmp();
        compileClaudeAgents(agents, path.join(d, 'claude'), null);
        compileOpenCodeAgents(agents, path.join(d, 'oc'), null);
        compileCodexAgents(agents, path.join(d, 'codex'), null);
        for (const sub of ['claude', 'oc', 'codex']) {
            const files = fs.readdirSync(path.join(d, sub));
            assert.ok(files.length >= 13, sub);
            for (const f of files) assert.strictEqual(modelOf(path.join(d, sub, f)), undefined, `${sub}/${f}`);
        }
    });

    test('override lands verbatim per harness', () => {
        const d = tmp();
        const pipeline = { architect: { models: { claude: 'fable', opencode: 'custom/model-x', codex: 'gpt-x' } } };
        compileClaudeAgents(agents, path.join(d, 'claude'), pipeline);
        compileOpenCodeAgents(agents, path.join(d, 'oc'), pipeline);
        compileCodexAgents(agents, path.join(d, 'codex'), pipeline);
        assert.strictEqual(modelOf(path.join(d, 'claude', 'architect.md')), 'fable');
        assert.strictEqual(modelOf(path.join(d, 'oc', 'architect.md')), 'custom/model-x');
        assert.strictEqual(modelOf(path.join(d, 'codex', 'architect.toml')), '"gpt-x"');
        assert.strictEqual(modelOf(path.join(d, 'claude', 'reviewer.md')), undefined);
    });

    test('Antigravity JSON carries no model and no tier unless overridden', () => {
        const src = fs.readFileSync(path.join(root, 'installer.js'), 'utf8');
        assert.ok(!/model_tier/.test(src));
        assert.match(src, /\.\.\.\(resolved\.model \? \{ model: resolved\.model \} : \{\}\)/);
    });
});

describe('committed agent files carry no model', () => {
    for (const dir of ['agents', '.claude/agents', '.opencode/agents', 'plugins/bdb-aos/agents']) {
        test(dir, () => {
            for (const f of mdFiles(dir)) assert.strictEqual(modelOf(f), undefined, f);
        });
    }
    test('.codex/agents toml', () => {
        const d = path.join(root, '.codex', 'agents');
        for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.toml'))) assert.strictEqual(modelOf(path.join(d, f)), undefined, f);
    });
});

test('no tier table or tier model ids remain in installer.js or lib/', () => {
    const files = [path.join(root, 'installer.js'), ...fs.readdirSync(path.join(root, 'lib')).filter((f) => /\.(js|mjs)$/.test(f)).map((f) => path.join(root, 'lib', f))];
    for (const f of files) {
        const text = fs.readFileSync(f, 'utf8');
        for (const bad of ['CANONICAL_TIERS', 'reasoning_max', 'standard_fast', 'trivial_low', 'gemini-3.1-pro-high', 'gemini-3.8-flash']) {
            assert.ok(!text.includes(bad), `${path.basename(f)} still contains ${bad}`);
        }
    }
    assert.strictEqual(inst.CANONICAL_TIERS, undefined);
});

describe('existing installs', () => {
    const setup = (oldBody) => {
        const d = tmp();
        const src = path.join(d, 'src', 'architect.md');
        const target = path.join(d, 'home', '.claude', 'agents', 'architect.md');
        fs.mkdirSync(path.dirname(src), { recursive: true });
        fs.writeFileSync(src, oldBody);
        const manifest = {};
        assert.strictEqual(resolveFileConflict(src, target, manifest, buildKnownSourceHashes([path.dirname(src)])), 'wrote');
        return { src, target, manifest };
    };
    const newBody = fs.readFileSync(path.join(root, '.claude', 'agents', 'architect.md'), 'utf8');
    const oldBody = newBody.replace('\n---\n', '\nmodel: opus\n---\n');

    test('an unedited AOS agent file with model: opus is rewritten without a model', () => {
        assert.match(oldBody, /^model: opus$/m);
        const { src, target, manifest } = setup(oldBody);
        fs.writeFileSync(src, newBody);
        assert.strictEqual(resolveFileConflict(src, target, manifest, buildKnownSourceHashes([path.dirname(src)])), 'wrote');
        assert.strictEqual(modelOf(target), undefined);
    });

    test('a user-edited agent file is left untouched', () => {
        const { src, target, manifest } = setup(oldBody);
        fs.writeFileSync(target, oldBody + '\nmine\n');
        fs.writeFileSync(src, newBody);
        assert.strictEqual(resolveFileConflict(src, target, manifest, buildKnownSourceHashes([path.dirname(src)])), 'kept');
        assert.match(fs.readFileSync(target, 'utf8'), /mine/);
    });
});
