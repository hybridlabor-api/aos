#!/usr/bin/env node

/**
 * skills/global_config/subagent-setup/scripts/setup-subagents.mjs
 *
 * Interactive & CLI tool to configure subagent roles and model tiers across:
 * - Claude Code (.claude/agents/*.md)
 * - Google Antigravity (~/.gemini/config/agents/*.json)
 * - OpenCode (.opencode/agents/*.md)
 * - ChatGPT Codex CLI (.codex/agents/*.toml & *.md)
 *
 * Single Source of Truth: .aos/pipeline.json (or .aos/project.json)
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const installer = require('../../../../installer.js');

const {
    CANONICAL_TIERS,
    loadPipelineConfig,
    resolveAgentConfig,
    parseAgentsMd,
    compileClaudeAgents,
    compileOpenCodeAgents,
    compileCodexAgents
} = installer;

const ROLES = [
    { key: 'architect', label: 'Architect', defaultTier: 'reasoning_max', defaultHarness: 'claude' },
    { key: 'techlead', label: 'TechLead', defaultTier: 'standard_fast', defaultHarness: 'antigravity' },
    { key: 'ui_ux', label: 'Godmode_UI_UX', defaultTier: 'standard_fast', defaultHarness: 'claude' },
    { key: 'engineering', label: 'Godmode_Engineering', defaultTier: 'standard_fast', defaultHarness: 'claude' },
    { key: 'media_eventtech', label: 'Godmode_Media_EventTech', defaultTier: 'standard_fast', defaultHarness: 'antigravity', defaultEnabled: false },
    { key: 'reviewer', label: 'Reviewer', defaultTier: 'reasoning_max', defaultHarness: 'codex' },
    { key: 'shipping', label: 'Godmode_Shipping', defaultTier: 'standard_fast', defaultHarness: 'opencode' }
];

function printPipeline(pipeline) {
    console.log('\n=== AOS Multi-Harness Subagent Pipeline ===\n');
    console.log(
        'Role'.padEnd(20) +
        'Status'.padEnd(10) +
        'Harness'.padEnd(15) +
        'Tier'.padEnd(18) +
        'Model'
    );
    console.log('-'.repeat(80));

    for (const r of ROLES) {
        const cfg = pipeline[r.key] || {};
        const enabled = cfg.enabled !== false;
        const harness = cfg.harness || r.defaultHarness;
        const tier = cfg.tier || r.defaultTier;
        const model = cfg.model || (CANONICAL_TIERS[tier] ? CANONICAL_TIERS[tier][harness] : 'inherit');

        console.log(
            r.label.padEnd(20) +
            (enabled ? '✔ ON' : '✖ OFF').padEnd(10) +
            harness.padEnd(15) +
            tier.padEnd(18) +
            model
        );
    }
    console.log('\nConfig file: .aos/pipeline.json\n');
}

function getDefaultPipeline() {
    const pipeline = {};
    for (const r of ROLES) {
        const harness = r.defaultHarness;
        const tier = r.defaultTier;
        const model = CANONICAL_TIERS[tier] ? CANONICAL_TIERS[tier][harness] : 'inherit';
        pipeline[r.key] = {
            enabled: r.defaultEnabled !== false,
            harness,
            tier,
            model
        };
    }
    return pipeline;
}

function syncAllHarnesses(projectDir, pipeline) {
    const agentsMdSrc = path.join(projectDir, '.agents', 'agents.md');
    if (!fs.existsSync(agentsMdSrc)) {
        console.error(`Error: .agents/agents.md not found at ${agentsMdSrc}`);
        return false;
    }

    const content = fs.readFileSync(agentsMdSrc, 'utf8');
    const agents = parseAgentsMd(content);

    // 1. Claude
    const claudeDir = path.join(projectDir, '.claude', 'agents');
    compileClaudeAgents(agents, claudeDir, pipeline);
    console.log(`  ✓ Synced Claude Code agents to ${claudeDir}`);

    // 2. OpenCode
    const opencodeDir = path.join(projectDir, '.opencode', 'agents');
    compileOpenCodeAgents(agents, opencodeDir, pipeline);
    console.log(`  ✓ Synced OpenCode agents to ${opencodeDir}`);

    // 3. Codex
    const codexDir = path.join(projectDir, '.codex', 'agents');
    compileCodexAgents(agents, codexDir, pipeline);
    console.log(`  ✓ Synced Codex CLI agents to ${codexDir}`);

    return true;
}

async function main() {
    const args = process.argv.slice(2);
    const cwd = process.cwd();
    const aosDir = path.join(cwd, '.aos');
    const pipelinePath = path.join(aosDir, 'pipeline.json');

    let pipeline = loadPipelineConfig(cwd) || getDefaultPipeline();

    if (args.includes('--show')) {
        printPipeline(pipeline);
        process.exit(0);
    }

    if (args.includes('--init-default')) {
        fs.mkdirSync(aosDir, { recursive: true });
        fs.writeFileSync(pipelinePath, JSON.stringify({ version: 1, pipeline: getDefaultPipeline() }, null, 2));
        console.log(`Initialized default pipeline at ${pipelinePath}`);
        printPipeline(getDefaultPipeline());
        syncAllHarnesses(cwd, getDefaultPipeline());
        process.exit(0);
    }

    if (args.includes('--sync')) {
        console.log('Syncing all harnesses from .aos/pipeline.json...');
        syncAllHarnesses(cwd, pipeline);
        console.log('✓ All subagents synchronized.');
        process.exit(0);
    }

    const setRoleIdx = args.indexOf('--set-role');
    if (setRoleIdx !== -1 && args[setRoleIdx + 1]) {
        const role = args[setRoleIdx + 1].toLowerCase().replace(/-/g, '_');
        const harnessIdx = args.indexOf('--harness');
        const modelIdx = args.indexOf('--model');
        const tierIdx = args.indexOf('--tier');
        const disableFlag = args.includes('--disable');
        const enableFlag = args.includes('--enable');

        if (!pipeline[role]) {
            pipeline[role] = {};
        }

        if (harnessIdx !== -1 && args[harnessIdx + 1]) pipeline[role].harness = args[harnessIdx + 1];
        if (modelIdx !== -1 && args[modelIdx + 1]) pipeline[role].model = args[modelIdx + 1];
        if (tierIdx !== -1 && args[tierIdx + 1]) pipeline[role].tier = args[tierIdx + 1];
        if (disableFlag) pipeline[role].enabled = false;
        if (enableFlag) pipeline[role].enabled = true;

        fs.mkdirSync(aosDir, { recursive: true });
        fs.writeFileSync(pipelinePath, JSON.stringify({ version: 1, pipeline }, null, 2));
        console.log(`Updated role "${role}" in ${pipelinePath}`);
        printPipeline(pipeline);
        syncAllHarnesses(cwd, pipeline);
        process.exit(0);
    }

    // Default: Show pipeline and usage
    printPipeline(pipeline);
    console.log('Commands:');
    console.log('  node setup-subagents.mjs --show');
    console.log('  node setup-subagents.mjs --init-default');
    console.log('  node setup-subagents.mjs --sync');
    console.log('  node setup-subagents.mjs --set-role <role> --harness <claude|antigravity|opencode|codex> --model <model> [--tier <tier>]');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
