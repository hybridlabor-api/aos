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
    resolveAgentConfig
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

    test('resolveAgentConfig resolves overrides and enabled, never a default model', () => {
        const pipelineConfig = {
            architect: { harness: 'claude', model: 'claude-opus-custom', enabled: true },
            reviewer: { harness: 'codex', tier: 'reasoning_max', enabled: true },
            shipping: { harness: 'antigravity', enabled: false }
        };

        const arch = resolveAgentConfig('architect', 'claude', pipelineConfig);
        assert.strictEqual(arch.model, 'claude-opus-custom');
        assert.strictEqual(arch.enabled, true);

        assert.strictEqual(resolveAgentConfig('reviewer', 'codex', pipelineConfig).model, null);

        const ship = resolveAgentConfig('shipping', 'antigravity', pipelineConfig);
        assert.strictEqual(ship.model, null);
        assert.strictEqual(ship.enabled, false);

        const fallback = resolveAgentConfig('godmode-engineering', 'codex', null);
        assert.strictEqual(fallback.model, null);
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

    test('compileCodexAgents emits Codex-format toml without a fixed model', () => {
        const agents = parseAgentsMd(SAMPLE_AGENTS_MD);
        const targetDir = path.join(tmpDir, '.codex', 'agents');
        compileCodexAgents(agents, targetDir, { architect: { harness: 'codex', model: 'o3-mini' } });
        const arch = fs.readFileSync(path.join(targetDir, 'architect.toml'), 'utf8');
        assert.ok(arch.includes('name = "architect"'));
        assert.ok(arch.includes('model = "o3-mini"'), 'a model the user pinned is kept');
        assert.ok(/^developer_instructions = ".+"$/m.test(arch));
        for (const bad of ['prompt_file', 'tier =', 'enabled =']) assert.ok(!arch.includes(bad), bad);
        assert.ok(!fs.existsSync(path.join(targetDir, 'architect.md')));
        const rev = fs.readFileSync(path.join(targetDir, 'reviewer.toml'), 'utf8');
        assert.ok(!/^model\s*=/m.test(rev), 'no model unless pinned');
        assert.ok(rev.includes('sandbox_mode = "read-only"'));
        assert.ok(arch.includes('sandbox_mode = "workspace-write"'));
    });

    test('compileCodexAgents rewrites AOS-owned (incl. legacy) files and leaves user files alone', () => {
        const agents = parseAgentsMd(SAMPLE_AGENTS_MD);
        const targetDir = path.join(tmpDir, '.codex', 'agents');
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(path.join(targetDir, 'architect.toml'), '# Codex subagent configuration for architect\nname = "architect"\nmodel = "gpt-4o"\ntier = "standard_fast"\nenabled = true\nprompt_file = "architect.md"\n');
        fs.writeFileSync(path.join(targetDir, 'reviewer.toml'), 'name = "reviewer"\nmodel = "mine"\n');
        compileCodexAgents(agents, targetDir, null);
        const arch = fs.readFileSync(path.join(targetDir, 'architect.toml'), 'utf8');
        assert.ok(!arch.includes('gpt-4o') && arch.includes('developer_instructions'));
        assert.strictEqual(fs.readFileSync(path.join(targetDir, 'reviewer.toml'), 'utf8'), 'name = "reviewer"\nmodel = "mine"\n');
        compileCodexAgents(agents, targetDir, null);
        assert.strictEqual(fs.readFileSync(path.join(targetDir, 'architect.toml'), 'utf8'), arch, 'idempotent');
    });

    test('compileCodexAgents carries role skills in developer_instructions', () => {
        const agents = parseAgentsMd(SAMPLE_AGENTS_MD);
        const targetDir = path.join(tmpDir, '.codex', 'agents');
        compileCodexAgents(agents, targetDir, null);
        const arch = fs.readFileSync(path.join(targetDir, 'architect.toml'), 'utf8');
        assert.ok(arch.includes('**Primary skills:** bdbrainstorm, planning-with-files'));
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
