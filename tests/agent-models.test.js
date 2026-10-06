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
            godmode_shipping: { model: 'prov/anything' },
        };
        assert.strictEqual(resolveAgentConfig('architect', 'claude', pipeline).model, 'fable');
        assert.strictEqual(resolveAgentConfig('architect', 'opencode', pipeline).model, 'myprov/My-Model.1');
        assert.strictEqual(resolveAgentConfig('architect', 'codex', pipeline).model, 'o3-mini');
        assert.strictEqual(resolveAgentConfig('architect', 'antigravity', pipeline).model, 'pro');
        assert.strictEqual(resolveAgentConfig('reviewer', 'claude', pipeline).model, 'Claude-Opus-5-5');
        assert.strictEqual(resolveAgentConfig('reviewer', 'codex', pipeline).model, null, 'legacy model is bound to its harness');
        assert.strictEqual(resolveAgentConfig('godmode-shipping', 'opencode', pipeline).model, 'prov/anything', 'no harness = every harness');
    });

    test('malformed overrides are dropped, never written, never replaced; empty models[h] does not fall through', () => {
        for (const bad of ['', 'a b', 'a\nb', 5, null]) {
            const p = { architect: { harness: 'claude', model: 'legacy-ok', models: { claude: bad } } };
            assert.strictEqual(resolveAgentConfig('architect', 'claude', p).model, null, JSON.stringify(bad));
        }
        assert.strictEqual(resolveAgentConfig('architect', 'opencode', { architect: { models: { opencode: 'fable' } } }).model, null);
        assert.strictEqual(resolveAgentConfig('architect', 'claude', { architect: { models: 'x' } }).model, null);
        const d = tmp();
        const pipeline = { architect: { models: { claude: 'a b', opencode: 'nope', codex: '' } } };
        compileClaudeAgents(agents, path.join(d, 'c'), pipeline);
        compileOpenCodeAgents(agents, path.join(d, 'o'), pipeline);
        compileCodexAgents(agents, path.join(d, 'x'), pipeline);
        assert.strictEqual(modelOf(path.join(d, 'c', 'architect.md')), undefined);
        assert.strictEqual(modelOf(path.join(d, 'o', 'architect.md')), undefined);
        assert.strictEqual(modelOf(path.join(d, 'x', 'architect.toml')), undefined);
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
            assert.ok(files.length >= agents.length, sub);
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

    test('Antigravity agent.md carries no model and no tier unless overridden', () => {
        const src = fs.readFileSync(path.join(root, 'installer.js'), 'utf8');
        assert.ok(!/model_tier/.test(src));
        const d = tmp();
        const { compileAgyAgents } = require('../installer.js');
        compileAgyAgents(agents, path.join(d, 'agy'));
        for (const slug of fs.readdirSync(path.join(d, 'agy'))) {
            assert.doesNotMatch(fs.readFileSync(path.join(d, 'agy', slug, 'agent.md'), 'utf8'), /^model/m, slug);
        }
        const o = path.join(d, 'agy-override');
        compileAgyAgents(agents, o, { architect: { models: { antigravity: 'pro' } } });
        assert.match(fs.readFileSync(path.join(o, 'architect', 'agent.md'), 'utf8'), /^model: pro$/m);
        assert.doesNotMatch(fs.readFileSync(path.join(o, 'reviewer', 'agent.md'), 'utf8'), /^model/m);
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

describe('Model lines in agent definitions', () => {
    test('no committed agent definition or copy carries a "- **Model**:" line', () => {
        const files = [path.join(root, '.agents', 'AGENTS.md'), path.join(root, '.cursor', 'rules', 'bdb_agents.mdc'),
            ...fs.readdirSync(path.join(root, '.codex', 'agents')).filter((f) => f.endsWith('.md')).map((f) => path.join(root, '.codex', 'agents', f))];
        for (const f of files) assert.ok(!/\*\*Model\*\*/.test(fs.readFileSync(f, 'utf8')), f);
    });

    test('parseAgentsMd ignores and strips a legacy Model line', () => {
        const [a] = parseAgentsMd('# T\n\n## Foo\n- **Role**: does foo\n- **Model**: opus\n- **Primary Skills**:\n  - x\n', []);
        assert.strictEqual(a.model, undefined);
        assert.ok(!/Model/.test(a.systemPrompt));
        assert.deepStrictEqual(a.skills, ['x']);
    });
});

describe('global Claude override after the manifest copy', () => {
    const { computeFileHash } = inst;
    const setupGlobal = () => {
        const d = tmp();
        const src = path.join(d, 'src');
        const dst = path.join(d, 'home', '.claude', 'agents');
        fs.mkdirSync(src, { recursive: true });
        const body = fs.readFileSync(path.join(root, '.claude', 'agents', 'architect.md'), 'utf8');
        fs.writeFileSync(path.join(src, 'architect.md'), body);
        const manifest = {};
        const copy = () => resolveFileConflict(path.join(src, 'architect.md'), path.join(dst, 'architect.md'), manifest, buildKnownSourceHashes([src]));
        copy();
        return { file: path.join(dst, 'architect.md'), dst, manifest, copy, body, src };
    };
    const pipeline = { architect: { models: { claude: 'fable' } } };
    const list = [{ name: 'Architect' }];

    test('writes the model, records the hash, and a later update restores and re-applies without a .new', () => {
        const { file, dst, manifest, copy, body } = setupGlobal();
        assert.deepStrictEqual(inst.applyClaudeModelOverrides(list, dst, pipeline, manifest), [file]);
        assert.strictEqual(modelOf(file), 'fable');
        assert.strictEqual(manifest[file].sha256, computeFileHash(file));
        assert.strictEqual(copy(), 'wrote');
        assert.strictEqual(fs.readFileSync(file, 'utf8'), body);
        assert.ok(!fs.existsSync(`${file}.new`));
        inst.applyClaudeModelOverrides(list, dst, pipeline, manifest);
        assert.strictEqual(modelOf(file), 'fable');
        inst.applyClaudeModelOverrides(list, dst, {}, manifest);
        assert.strictEqual(copy(), 'wrote');
        assert.strictEqual(modelOf(file), undefined, 'removing the override restores the shipped file');
    });

    test('a user-edited file and a malformed override are left alone', () => {
        const { file, dst, manifest } = setupGlobal();
        fs.appendFileSync(file, '\nmine\n');
        assert.deepStrictEqual(inst.applyClaudeModelOverrides(list, dst, pipeline, manifest), []);
        assert.strictEqual(modelOf(file), undefined);
        const g = setupGlobal();
        assert.deepStrictEqual(inst.applyClaudeModelOverrides(list, g.dst, { architect: { models: { claude: 'a b' } } }, g.manifest), []);
        assert.strictEqual(modelOf(g.file), undefined);
    });
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
