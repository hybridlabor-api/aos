#!/usr/bin/env node

/**
 * skills/global_config/subagent-setup/scripts/setup-subagents.mjs
 *
 * CLI tool to configure subagent roles and optional per-harness model overrides across:
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

// Installed copies live under ~/.agents/skills, nowhere near installer.js: look it up by
// AOS_HOME (the folder holding installer.js), the repo checkout, then the global npm package.
function loadInstaller() {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
        process.env.AOS_HOME && path.join(process.env.AOS_HOME, 'installer.js'),
        path.resolve(here, '../../../../installer.js'),
        path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', '@hybridlabor-api', 'aos', 'installer.js'),
    ].filter(Boolean);
    try { candidates.push(require.resolve('@hybridlabor-api/aos/installer.js')); } catch { /* not resolvable from here */ }
    // An explicit AOS_HOME is the user's choice: a wrong one must fail, not fall through to another copy.
    const found = process.env.AOS_HOME ? (fs.existsSync(candidates[0]) ? candidates[0] : null) : candidates.find((c) => fs.existsSync(c));
    if (!found) {
        console.error(`setup-subagents: cannot find the AOS installer module (installer.js).\nSet AOS_HOME to the AOS package folder (the one containing installer.js), or install @hybridlabor-api/aos.\nTried:\n${candidates.map((c) => `  ${c}`).join('\n')}`);
        process.exit(2);
    }
    try {
        return require(found);
    } catch (err) {
        console.error(`setup-subagents: found installer.js at ${found} but it failed to load: ${err.message}\nInstall the AOS package dependencies in ${path.dirname(found)} (npm install) and retry.`);
        process.exit(2);
    }
}

const installer = loadInstaller();

const {
    loadPipelineConfig,
    resolveAgentConfig,
    parseAgentsMd,
    compileClaudeAgents,
    compileOpenCodeAgents,
    compileCodexAgents
} = installer;

const ROLES = [
    { key: 'architect', label: 'Architect', defaultHarness: 'claude' },
    { key: 'techlead', label: 'TechLead', defaultHarness: 'antigravity' },
    { key: 'godmode_ui_ux', label: 'Godmode_UI_UX', defaultHarness: 'claude' },
    { key: 'godmode_engineering', label: 'Godmode_Engineering', defaultHarness: 'claude' },
    { key: 'godmode_media_eventtech', label: 'Godmode_Media_EventTech', defaultHarness: 'antigravity', defaultEnabled: false },
    { key: 'reviewer', label: 'Reviewer', defaultHarness: 'codex' },
    { key: 'godmode_shipping', label: 'Godmode_Shipping', defaultHarness: 'opencode' }
];

// Short keys older docs and pipelines used; accepted on input, the real agent slug is written.
const ROLE_ALIASES = { ui_ux: 'godmode_ui_ux', engineering: 'godmode_engineering', media_eventtech: 'godmode_media_eventtech', shipping: 'godmode_shipping' };

function printPipeline(pipeline) {
    console.log('\n=== AOS Multi-Harness Subagent Pipeline ===\n');
    console.log(
        'Role'.padEnd(20) +
        'Status'.padEnd(10) +
        'Harness'.padEnd(15) +
        'Model'
    );
    console.log('-'.repeat(80));

    for (const r of ROLES) {
        const cfg = pipeline[r.key] || {};
        const enabled = cfg.enabled !== false;
        const harness = cfg.harness || r.defaultHarness;
        const model = resolveAgentConfig(r.key, harness, pipeline).model || 'inherit (session model)';

        console.log(
            r.label.padEnd(20) +
            (enabled ? '✔ ON' : '✖ OFF').padEnd(10) +
            harness.padEnd(15) +
            model
        );
    }
    console.log('\nConfig file: .aos/pipeline.json\n');
}

function getDefaultPipeline() {
    const pipeline = {};
    for (const r of ROLES) {
        pipeline[r.key] = {
            enabled: r.defaultEnabled !== false,
            harness: r.defaultHarness
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
        const given = args[setRoleIdx + 1].toLowerCase().replace(/-/g, '_');
        const role = ROLE_ALIASES[given] || given;
        if (pipeline[given] && role !== given && !pipeline[role]) { pipeline[role] = pipeline[given]; delete pipeline[given]; }
        const harnessIdx = args.indexOf('--harness');
        const modelIdx = args.indexOf('--model');
        const disableFlag = args.includes('--disable');
        const enableFlag = args.includes('--enable');

        if (!pipeline[role]) {
            pipeline[role] = {};
        }

        if (harnessIdx !== -1 && args[harnessIdx + 1]) pipeline[role].harness = args[harnessIdx + 1];
        if (modelIdx !== -1 && args[modelIdx + 1]) {
            const h = pipeline[role].harness;
            if (!h) { console.error('--model needs --harness (or a role that already has one).'); process.exit(2); }
            pipeline[role].models = { ...pipeline[role].models, [h]: args[modelIdx + 1] };
        }
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
    console.log('  node setup-subagents.mjs --set-role <role> --harness <claude|antigravity|opencode|codex> --model <model>');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
