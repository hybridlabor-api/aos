const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { parseAgentsMd, compileClaudeAgents, compileOpenCodeAgents, resolveAgentConfig, CANONICAL_TIERS } = require('../installer.js');

const root = path.join(__dirname, '..');
const pipeline = {
    reviewer: { enabled: true, harness: 'codex', tier: 'reasoning_max', model: 'o3-mini' },
    techlead: { enabled: true, harness: 'antigravity', tier: 'standard_fast', model: 'gemini-3.8-flash-high' },
    architect: { harness: 'claude', model: 'opus' },
};
const CLAUDE_OK = /^(opus|sonnet|haiku|inherit|claude-.+)$/;
const modelOf = (file) => (fs.readFileSync(file, 'utf8').match(/^model:\s*(.+)$/m) || [])[1];
const mdFiles = (dir) => fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.md')).map((f) => path.join(root, dir, f));

describe('agent model resolution', () => {
    test('role model applies only to its own harness', () => {
        assert.strictEqual(resolveAgentConfig('reviewer', 'codex', pipeline).model, 'o3-mini');
        assert.strictEqual(resolveAgentConfig('reviewer', 'claude', pipeline).model, CANONICAL_TIERS.reasoning_max.claude);
        assert.strictEqual(resolveAgentConfig('techlead', 'claude', pipeline).model, CANONICAL_TIERS.standard_fast.claude);
        assert.strictEqual(resolveAgentConfig('techlead', 'opencode', pipeline).model, 'inherit');
        assert.strictEqual(resolveAgentConfig('architect', 'opencode', pipeline).model, 'inherit');
    });

    test('compilers never write foreign models', () => {
        const agents = parseAgentsMd(fs.readFileSync(path.join(root, '.agents', 'agents.md'), 'utf8'));
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-models-'));
        compileClaudeAgents(agents, path.join(tmp, 'claude'), pipeline);
        compileOpenCodeAgents(agents, path.join(tmp, 'oc'), pipeline);
        for (const f of fs.readdirSync(path.join(tmp, 'claude'))) {
            assert.match(modelOf(path.join(tmp, 'claude', f)), CLAUDE_OK, f);
        }
        for (const f of fs.readdirSync(path.join(tmp, 'oc'))) {
            assert.strictEqual(modelOf(path.join(tmp, 'oc', f)), undefined, `${f}: OpenCode subagents inherit the session model`);
        }
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    test('sanity check replaces a bogus model passed through an agent definition', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-models-'));
        compileClaudeAgents([{ name: 'x', role: 'r', skills: [], mcpServers: [] }], tmp, { x: { model: 'o3-mini' } });
        assert.strictEqual(modelOf(path.join(tmp, 'x.md')), 'sonnet');
        fs.rmSync(tmp, { recursive: true, force: true });
    });
});

describe('committed agent files', () => {
    for (const dir of ['agents', '.claude/agents']) {
        test(`${dir} models are Claude-valid`, () => {
            for (const f of mdFiles(dir)) assert.match(modelOf(f), CLAUDE_OK, f);
        });
    }
    test('.opencode/agents models are provider/model', () => {
        for (const f of mdFiles('.opencode/agents')) {
            const m = modelOf(f);
            if (m) assert.ok(m.includes('/'), `${f}: ${m}`);
        }
    });
});
