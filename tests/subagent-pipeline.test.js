/**
 * tests/subagent-pipeline.test.js
 *
 * Tests for Multi-Harness Subagent Architecture:
 * - Canonical Tiers & Model Resolution across Claude, Antigravity, OpenCode, and Codex
 * - Pipeline config loading (.aos/pipeline.json)
 * - Agent compilers: compileClaudeAgents, compileOpenCodeAgents, compileCodexAgents
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
    parseAgentsMd,
    compileClaudeAgents,
    compileOpenCodeAgents,
    compileCodexAgents,
    loadPipelineConfig,
    resolveAgentConfig,
    CANONICAL_TIERS
} = require('../installer.js');

const SAMPLE_AGENTS_MD = `
# BDB Multi-Agent Team Specification

## 🧭 Architect
- **Role**: Turns the user's goal into a system plan.
- **Model**: opus
- **Primary Skills**:
  - bdbrainstorm
  - planning-with-files
- **MCP Servers**:
  - openwiki-skill
  - memb_mcp
- **Output Artifact**: production_artifacts/00_execution_plan.md

## 🔍 Reviewer
- **Role**: Adversarial review of build-node output.
- **Model**: opus
- **Primary Skills**:
  - ui-review
- **MCP Servers**:
  - github
- **Output Artifact**: production_artifacts/review_findings.md
`;

describe('Multi-Harness Subagent Architecture', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-subagent-test-'));
    });

    afterEach(() => {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {}
    });

    test('CANONICAL_TIERS covers all 4 harnesses', () => {
        const harnesses = ['claude', 'antigravity', 'opencode', 'codex'];
        for (const tier of ['reasoning_max', 'standard_fast', 'trivial_low']) {
            assert.ok(CANONICAL_TIERS[tier], `Missing tier: ${tier}`);
            for (const h of harnesses) {
                assert.ok(CANONICAL_TIERS[tier][h], `Missing harness ${h} in tier ${tier}`);
                assert.strictEqual(typeof CANONICAL_TIERS[tier][h], 'string');
            }
        }
    });

    test('resolveAgentConfig resolves overrides, tiers, and fallback defaults', () => {
        const pipelineConfig = {
            architect: { harness: 'claude', model: 'claude-opus-custom', enabled: true },
            reviewer: { harness: 'codex', tier: 'reasoning_max', enabled: true },
            shipping: { harness: 'antigravity', tier: 'standard_fast', enabled: false }
        };

        // Explicit model override
        const arch = resolveAgentConfig('architect', 'claude', pipelineConfig);
        assert.strictEqual(arch.model, 'claude-opus-custom');
        assert.strictEqual(arch.enabled, true);

        // Tier resolution for Codex
        const rev = resolveAgentConfig('reviewer', 'codex', pipelineConfig);
        assert.strictEqual(rev.model, CANONICAL_TIERS.reasoning_max.codex);
        assert.strictEqual(rev.tier, 'reasoning_max');
        assert.strictEqual(rev.enabled, true);

        // Disabled role
        const ship = resolveAgentConfig('shipping', 'antigravity', pipelineConfig);
        assert.strictEqual(ship.model, CANONICAL_TIERS.standard_fast.antigravity);
        assert.strictEqual(ship.enabled, false);

        // Fallback default without config
        const fallback = resolveAgentConfig('godmode-engineering', 'codex', null);
        assert.strictEqual(fallback.model, CANONICAL_TIERS.standard_fast.codex);
        assert.strictEqual(fallback.enabled, true);
    });

    test('loadPipelineConfig loads from .aos/pipeline.json', () => {
        const aosDir = path.join(tmpDir, '.aos');
        fs.mkdirSync(aosDir, { recursive: true });
        const configData = {
            version: 1,
            pipeline: {
                architect: { harness: 'claude', tier: 'reasoning_max' },
                reviewer: { harness: 'codex', model: 'o3-mini' }
            }
        };
        fs.writeFileSync(path.join(aosDir, 'pipeline.json'), JSON.stringify(configData, null, 2));

        const loaded = loadPipelineConfig(tmpDir);
        assert.ok(loaded);
        assert.strictEqual(loaded.architect.tier, 'reasoning_max');
        assert.strictEqual(loaded.reviewer.model, 'o3-mini');
    });

    test('compileCodexAgents emits valid .toml and .md files', () => {
        const agents = parseAgentsMd(SAMPLE_AGENTS_MD);
        const targetDir = path.join(tmpDir, '.codex', 'agents');
        const pipelineConfig = {
            architect: { harness: 'codex', model: 'o3-mini' },
            reviewer: { harness: 'codex', tier: 'reasoning_max' }
        };

        compileCodexAgents(agents, targetDir, pipelineConfig);

        // Check architect
        const archTomlPath = path.join(targetDir, 'architect.toml');
        const archMdPath = path.join(targetDir, 'architect.md');
        assert.ok(fs.existsSync(archTomlPath), 'architect.toml should exist');
        assert.ok(fs.existsSync(archMdPath), 'architect.md should exist');

        const archToml = fs.readFileSync(archTomlPath, 'utf8');
        assert.ok(archToml.includes('name = "architect"'));
        assert.ok(archToml.includes('model = "o3-mini"'));
        assert.ok(archToml.includes('prompt_file = "architect.md"'));

        const archMd = fs.readFileSync(archMdPath, 'utf8');
        assert.ok(archMd.includes('Role: Architect'));
        assert.ok(archMd.includes('**Primary skills:** bdbrainstorm, planning-with-files'));

        // Check reviewer
        const revToml = fs.readFileSync(path.join(targetDir, 'reviewer.toml'), 'utf8');
        assert.ok(revToml.includes('model = "o3-mini"'));
    });

    test('compileClaudeAgents applies pipelineConfig model', () => {
        const agents = parseAgentsMd(SAMPLE_AGENTS_MD);
        const targetDir = path.join(tmpDir, '.claude', 'agents');
        const pipelineConfig = {
            architect: { harness: 'claude', model: 'opus' },
            reviewer: { harness: 'claude', model: 'sonnet' }
        };

        compileClaudeAgents(agents, targetDir, pipelineConfig);

        const revMd = fs.readFileSync(path.join(targetDir, 'reviewer.md'), 'utf8');
        assert.ok(revMd.includes('model: sonnet'));
        assert.ok(revMd.includes('name: reviewer'));
    });

    test('compileOpenCodeAgents emits model and mode: subagent', () => {
        const agents = parseAgentsMd(SAMPLE_AGENTS_MD);
        const targetDir = path.join(tmpDir, '.opencode', 'agents');
        const pipelineConfig = {
            architect: { harness: 'opencode', model: 'opencode/muse-spark-1.3-contributor-free' }
        };

        compileOpenCodeAgents(agents, targetDir, pipelineConfig);

        const archMd = fs.readFileSync(path.join(targetDir, 'architect.md'), 'utf8');
        assert.ok(archMd.includes('mode: subagent'));
        assert.ok(archMd.includes('model: opencode/muse-spark-1.3-contributor-free'));
    });
});
