'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getRouterTable } = require('./table.js');

// Router target -> harness key used in .aos/pipeline.json `models.<harness>`.
// Targets not listed here are used as-is (claude, codex).
const TARGET_HARNESS_KEY = Object.freeze({
  agy: 'antigravity',
  'opencode-go': 'opencode',
  'claude-glm': 'claude',
});

function harnessKeyFor(target) {
  return TARGET_HARNESS_KEY[target] || target;
}

/**
 * Reads `pipeline.<role>.models.<harnessKey>` from <projectRoot>/.aos/pipeline.json.
 * Missing, unreadable or invalid files yield null (default model), never a throw.
 */
function pipelineModelFor(projectRoot, role, target) {
  if (!projectRoot) return null;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.resolve(projectRoot, '.aos', 'pipeline.json'), 'utf8'));
  } catch {
    return null;
  }
  const models = data && data.pipeline && data.pipeline[role] && data.pipeline[role].models;
  if (!models || typeof models !== 'object') return null;
  const value = models[harnessKeyFor(target)];
  if (typeof value !== 'string' || value.trim() === '' || /\s/.test(value)) return null;
  return value;
}

/**
 * Resolves the role for a given node specification.
 * Falls back to 'builder' for unknown nodes.
 *
 * @param {string|object|null|undefined} node
 * @param {object} table Validated router table
 * @returns {{ role: string, isDefault: boolean, nodeName: string }}
 */
function resolveRole(node, table) {
  const roles = table.roles || [];

  if (!node) {
    return { role: 'builder', isDefault: true, nodeName: 'anonymous' };
  }

  // String node identifier
  if (typeof node === 'string') {
    const raw = node.trim();
    const normalized = raw.toLowerCase().replace(/[-\s]/g, '_');

    if (roles.includes(raw)) {
      return { role: raw, isDefault: false, nodeName: raw };
    }
    if (roles.includes(normalized)) {
      return { role: normalized, isDefault: false, nodeName: raw };
    }

    // Common build node aliases
    if (['ui_ux', 'engineering', 'media_eventtech', 'build', 'builder'].includes(normalized)) {
      return { role: 'builder', isDefault: false, nodeName: raw };
    }

    // Unknown string node -> builder default
    return { role: 'builder', isDefault: true, nodeName: raw };
  }

  // Object node specification
  if (typeof node === 'object') {
    const nodeName = node.id || node.agentType || node.label || node.role || 'unnamed-node';

    // 1. Direct role property
    if (node.role) {
      const r = String(node.role).trim().toLowerCase();
      if (roles.includes(r)) {
        return { role: r, isDefault: false, nodeName };
      }
      if (r === 'plan') return { role: 'architect', isDefault: false, nodeName };
      if (r === 'approve') return { role: 'techlead', isDefault: false, nodeName };
      if (r === 'review') return { role: 'reviewer', isDefault: false, nodeName };
      if (r === 'build') return { role: 'builder', isDefault: false, nodeName };
      if (r === 'scout') return { role: 'scout', isDefault: false, nodeName };
    }
    // 2. Executor
    if (node.executor === 'builder') {
      return { role: 'builder', isDefault: false, nodeName };
    }
    if (node.executor === 'reviewer') {
      return { role: 'reviewer', isDefault: false, nodeName };
    }
    if (node.executor === 'planner') {
      return { role: 'architect', isDefault: false, nodeName };
    }

    // 3. ID / agentType match
    const candidates = [node.id, node.agentType, node.label]
      .filter(Boolean)
      .map((s) => String(s).toLowerCase().replace(/[-\s]/g, '_'));

    for (const cand of candidates) {
      if (roles.includes(cand)) {
        return { role: cand, isDefault: false, nodeName };
      }
      if (cand.includes('architect')) return { role: 'architect', isDefault: false, nodeName };
      if (cand.includes('techlead')) return { role: 'techlead', isDefault: false, nodeName };
      if (cand.includes('reviewer')) return { role: 'reviewer', isDefault: false, nodeName };
      if (cand.includes('scout')) return { role: 'scout', isDefault: false, nodeName };
      if (cand.includes('ui_ux') || cand.includes('engineering') || cand.includes('media_eventtech') || cand.includes('godmode')) {
        return { role: 'builder', isDefault: false, nodeName };
      }
    }

    // Unknown object node -> builder default
    return { role: 'builder', isDefault: true, nodeName };
  }

  return { role: 'builder', isDefault: true, nodeName: String(node) };
}

/**
 * Pure route resolution function.
 * Given a node and context, returns { target, model, reason }.
 *
 * @param {string|object} node Node identifier or specification
 * @param {object} [ctx] Context options (may include { table }, { target }, { model })
 * @returns {{ target: string, model: string|null, reason: string }}
 */
function routeFor(node, ctx = {}) {
  // Extract table: either ctx.table, ctx directly if passed as table, or loaded table
  let table;
  if (ctx && ctx.table && ctx.table.roles && ctx.table.targets) {
    table = ctx.table;
  } else if (ctx && ctx.roles && ctx.targets) {
    table = ctx;
  } else {
    const home = ctx && ctx.home;
    const projectRoot = ctx && ctx.projectRoot;
    table = getRouterTable({ home, projectRoot });
  }

  const { role, isDefault, nodeName } = resolveRole(node, table);

  // Preference order for the role
  const preferences = table.preferences?.[role] || table.preferences?.builder || ['opencode-go'];

  // Target selection
  let target;
  let reason;

  if (ctx && ctx.target && table.targets?.[ctx.target]) {
    target = ctx.target;
    reason = `target override via ctx: "${target}"`;
  } else if (isDefault) {
    target = preferences[0] || 'opencode-go';
    reason = `unknown node "${nodeName}", fell back to builder role default -> "${target}"`;
  } else {
    target = preferences[0] || 'opencode-go';
    reason = `primary preference for role "${role}" -> "${target}"`;
  }

  // Model selection: explicit override in ctx takes precedence, then the project's
  // pipeline.json models.<harness> (advisor role only), otherwise the configured model.
  let model;
  const pinned = role === 'advisor' ? pipelineModelFor(ctx && ctx.projectRoot, role, target) : null;
  if (ctx && ctx.model !== undefined) {
    model = ctx.model;
  } else if (pinned) {
    model = pinned;
  } else {
    const targetConfig = table.targets?.[target];
    model = targetConfig?.model !== undefined ? targetConfig.model : (target === 'opencode-go' ? 'glm-5.3-flash' : null);
  }

  return { target, model, reason };
}

module.exports = {
  routeFor,
  resolveRole,
  harnessKeyFor,
  pipelineModelFor,
};
