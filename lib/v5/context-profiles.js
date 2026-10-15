'use strict';
// Context profiles for BDB Agent OS (v5).
// Role-based profiles: full | orchestrator | worker | small.
// Controls gateway MCP presets, session startup budget, and estimates token consumption.

const CONTEXT_PROFILES = Object.freeze(['full', 'orchestrator', 'worker', 'small']);
const DEFAULT_CONTEXT_PROFILE = 'full';

const MEDIA_SERVERS = Object.freeze([
  'bdb_davinci_mcp',
  'bdb_unreal_mcp',
  'bdb_blender_mcp',
  'bdb_grandma3_mcp',
  'bdb_td_backup',
  'bdb_after_effects_mcp',
  'bdb_resolume_mcp',
  'adobe_uxp_mcp',
  'bdb_rhino_mcp',
  'bdb_vectorworks_mcp',
]);

const CORE_GATEWAY_SERVERS = Object.freeze([
  'github',
  'chrome-devtools',
  'memb_mcp',
  'deja',
  'open_design_mcp',
]);

const CONTEXT_PROFILE_DEFS = Object.freeze({
  full: {
    role: 'full',
    label: 'Full (all tools, default)',
    description: 'Exposes all 300+ gateway tools, all skills, and full memory context. Best for high-tier models with 200k+ context.',
    gatewayPreset: null,
    mediaUpstreams: 'enabled',
    maxSessionStartChars: 2000,
  },
  orchestrator: {
    role: 'orchestrator',
    label: 'Orchestrator (planning & coordination)',
    description: 'All skills for dynamic workflow routing; full or standard gateway tools for cross-domain orchestration.',
    gatewayPreset: null,
    mediaUpstreams: 'enabled',
    maxSessionStartChars: 2000,
  },
  worker: {
    role: 'worker',
    label: 'Worker (focused engineering)',
    description: 'Core developer MCP tools only (git, devtools, memory, design). Media/creative tools opt-in via preset. Saves ~21k tokens.',
    gatewayPreset: 'worker',
    mediaUpstreams: 'opt-in',
    maxSessionStartChars: 2000,
  },
  small: {
    role: 'small',
    label: 'Small (low context / fast models)',
    description: 'Aggressive context reduction for small/local models. Core tools only, capped startup context.',
    gatewayPreset: 'small',
    mediaUpstreams: 'opt-in',
    maxSessionStartChars: 1000,
  },
});

function knownContextProfile(name) {
  return typeof name === 'string' && CONTEXT_PROFILES.includes(name.trim().toLowerCase());
}

function contextProfileOf(settings) {
  if (settings && knownContextProfile(settings.context)) {
    return settings.context.trim().toLowerCase();
  }
  return DEFAULT_CONTEXT_PROFILE;
}

// Honest token estimates based on context audit measurements
function tokenEstimate(profileName = DEFAULT_CONTEXT_PROFILE) {
  const profile = knownContextProfile(profileName) ? profileName.trim().toLowerCase() : DEFAULT_CONTEXT_PROFILE;

  // Baseline measured counts from _context-audit/report.md:
  // - Gateway all: 303 tools, ~25,738 tokens (full schemas ~104k tokens)
  // - Gateway core (worker/small): ~45 tools, ~4,200 tokens (saving ~21,500 tokens)
  // - Skills (287 skills):
  //     With 250 char budget: ~11,000 tokens (vs ~17,930 before)
  // - Agents (45 agents): ~4,371 tokens (constant in Claude Code system prompt)
  // - Workspace instructions + Memory: ~3,848 tokens (constant)
  // - MCP server instructions (openwiki): ~557 tokens
  // - SessionStart hooks:
  //     full/orchestrator: ~413 tokens
  //     worker/small: ~100-250 tokens
  // - Harness preamble & base tools: ~16,093 tokens (constant)

  let gatewayTokens = 25738;
  let hookTokens = 413;
  let skillTokens = 11000;

  if (profile === 'worker') {
    gatewayTokens = 4200;
    hookTokens = 350;
  } else if (profile === 'small') {
    gatewayTokens = 4200;
    hookTokens = 250;
  }

  const breakdown = {
    mcpCatalog: gatewayTokens,
    skills: skillTokens,
    agents: 4371,
    instructionsAndMemory: 3848,
    mcpInstructions: 557,
    sessionStartHooks: hookTokens,
    harnessPreamble: 16093,
  };

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);

  return {
    profile,
    breakdown,
    totalEstTokens: total,
    savingsVsFull: (profile === 'full' || profile === 'orchestrator') ? 0 : (62020 - total),
  };
}

module.exports = {
  CONTEXT_PROFILES,
  DEFAULT_CONTEXT_PROFILE,
  MEDIA_SERVERS,
  CORE_GATEWAY_SERVERS,
  CONTEXT_PROFILE_DEFS,
  knownContextProfile,
  contextProfileOf,
  tokenEstimate,
};
