'use strict';

const fs = require('node:fs');
const path = require('node:path');

const KNOWN_ROLES = Object.freeze([
  'architect',
  'techlead',
  'reviewer',
  'builder',
  'scout',
]);

const KNOWN_TARGETS = Object.freeze([
  'claude',
  'opencode-go',
  'agy',
  'codex',
  'claude-glm',
]);

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '..', '..', 'config', 'router.json');

let cachedTable = null;

/**
 * Deep-merge plain JSON objects. Arrays are replaced, objects are merged
 * recursively, scalar values are overwritten. Later overrides beat earlier
 * bases, supporting project > user > shipped layering.
 */
function deepMerge(base, ...overrides) {
  const out = JSON.parse(JSON.stringify(base || {}));
  for (const override of overrides) {
    if (!override || typeof override !== 'object' || Array.isArray(override)) continue;
    for (const [key, value] of Object.entries(override)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        out[key] = [...value];
      } else if (value !== null && typeof value === 'object' && !Array.isArray(out[key]) && out[key] !== null && typeof out[key] === 'object') {
        out[key] = deepMerge(out[key], value);
      } else {
        out[key] = value;
      }
    }
  }
  return out;
}

function layerPath(home, projectRoot) {
  const user = home ? path.resolve(home, '.aos', 'router.json') : null;
  const project = projectRoot ? path.resolve(projectRoot, '.aos', 'router.json') : null;
  return { user, project };
}

function loadJsonIfExists(resolvedPath) {
  if (!resolvedPath) return null;
  try {
    return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw new Error(`Failed to read router config at "${resolvedPath}": ${err.message}`);
  }
}

function validateRouterTable(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Router config must be a non-null object');
  }

  // 1. Roles
  let rolesList = [];
  if (Array.isArray(config.roles)) {
    if (config.roles.length === 0) {
      throw new Error('Router config "roles" must not be empty');
    }
    for (const r of config.roles) {
      if (typeof r !== 'string' || !KNOWN_ROLES.includes(r)) {
        throw new Error(`Unknown role "${r}" in router config. Valid roles are: ${KNOWN_ROLES.join(', ')}`);
      }
    }
    rolesList = [...config.roles];
  } else if (config.roles && typeof config.roles === 'object') {
    const keys = Object.keys(config.roles);
    if (keys.length === 0) {
      throw new Error('Router config "roles" must not be empty');
    }
    for (const r of keys) {
      if (!KNOWN_ROLES.includes(r)) {
        throw new Error(`Unknown role "${r}" in router config. Valid roles are: ${KNOWN_ROLES.join(', ')}`);
      }
    }
    rolesList = keys;
  } else {
    throw new Error('Router config must define "roles" as an array or object');
  }

  // 2. Targets
  let targetsMap = {};
  if (config.targets && typeof config.targets === 'object' && !Array.isArray(config.targets)) {
    const targetKeys = Object.keys(config.targets);
    if (targetKeys.length === 0) {
      throw new Error('Router config "targets" must not be empty');
    }
    for (const t of targetKeys) {
      if (!KNOWN_TARGETS.includes(t)) {
        throw new Error(`Unknown target "${t}" in router config. Valid targets are: ${KNOWN_TARGETS.join(', ')}`);
      }
      const entry = config.targets[t] || {};
      targetsMap[t] = {
        model: entry.model !== undefined ? entry.model : (t === 'opencode-go' ? 'glm-5.3-flash' : null),
        limits: entry.limits || null,
        description: entry.description || null,
      };
    }
  } else if (Array.isArray(config.targets)) {
    if (config.targets.length === 0) {
      throw new Error('Router config "targets" must not be empty');
    }
    for (const t of config.targets) {
      if (typeof t !== 'string' || !KNOWN_TARGETS.includes(t)) {
        throw new Error(`Unknown target "${t}" in router config. Valid targets are: ${KNOWN_TARGETS.join(', ')}`);
      }
      targetsMap[t] = {
        model: t === 'opencode-go' ? 'glm-5.3-flash' : null,
        limits: null,
        description: null,
      };
    }
  } else {
    throw new Error('Router config must define "targets" as an object or array');
  }

  // 3. Preferences (per-role ordered target preference)
  const preferences = {};
  const rawPrefs = config.preferences || (typeof config.roles === 'object' && !Array.isArray(config.roles) ? config.roles : {});

  for (const role of rolesList) {
    let list = null;
    if (rawPrefs[role]) {
      list = Array.isArray(rawPrefs[role]) ? rawPrefs[role] : rawPrefs[role].targets;
    }
    if (list) {
      if (!Array.isArray(list) || list.length === 0) {
        throw new Error(`Preferences for role "${role}" must be a non-empty array of target names`);
      }
      for (const t of list) {
        if (!KNOWN_TARGETS.includes(t)) {
          throw new Error(`Unknown target "${t}" in preference list for role "${role}". Valid targets are: ${KNOWN_TARGETS.join(', ')}`);
        }
      }
      preferences[role] = [...list];
    } else {
      // Default fallback if not explicitly configured for this role
      preferences[role] = ['claude', 'opencode-go', 'agy', 'codex', 'claude-glm'].filter((t) => targetsMap[t]);
    }
  }

  // Validate that no unknown roles exist in preferences keys
  if (config.preferences && typeof config.preferences === 'object') {
    for (const r of Object.keys(config.preferences)) {
      if (!KNOWN_ROLES.includes(r)) {
        throw new Error(`Unknown role "${r}" in preferences. Valid roles are: ${KNOWN_ROLES.join(', ')}`);
      }
    }
  }

  // 4. Window limits (data only)
  let limits = null;
  if (config.limits !== undefined) {
    if (!config.limits || typeof config.limits !== 'object' || Array.isArray(config.limits)) {
      throw new Error('Router config "limits" must be an object');
    }
    limits = {};
    for (const [windowKey, windowLimits] of Object.entries(config.limits)) {
      if (!windowLimits || typeof windowLimits !== 'object') {
        throw new Error(`Window limit "${windowKey}" must be an object`);
      }
      const soft = windowLimits.soft !== undefined ? Number(windowLimits.soft) : undefined;
      const hard = windowLimits.hard !== undefined ? Number(windowLimits.hard) : undefined;
      if (soft !== undefined && (isNaN(soft) || soft < 0 || soft > 1)) {
        throw new Error(`Soft limit for "${windowKey}" must be a number between 0 and 1`);
      }
      if (hard !== undefined && (isNaN(hard) || hard < 0 || hard > 1)) {
        throw new Error(`Hard limit for "${windowKey}" must be a number between 0 and 1`);
      }
      if (soft !== undefined && hard !== undefined && soft > hard) {
        throw new Error(`Soft limit (${soft}) cannot exceed hard limit (${hard}) for "${windowKey}"`);
      }
      limits[windowKey] = { soft, hard };
    }
  }

  const enforce = Boolean(config.enforce);

  return Object.freeze({
    enforce,
    roles: Object.freeze(rolesList),
    targets: Object.freeze(targetsMap),
    preferences: Object.freeze(preferences),
    limits: limits ? Object.freeze(limits) : null,
  });
}

function loadRouterTable(customPath = DEFAULT_CONFIG_PATH) {
  const resolvedPath = path.resolve(customPath);
  let raw;
  try {
    raw = fs.readFileSync(resolvedPath, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read router config at "${resolvedPath}": ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse router config at "${resolvedPath}": ${err.message}`);
  }

  return validateRouterTable(parsed);
}

/**
 * Load the shipped table, then merge ~/.aos/router.json (user) and
 * .aos/router.json (project) on top. Project beats user beats shipped.
 * HOME and projectRoot are parameters; this function never reads process.env.
 */
function loadLayeredRouterTable({ home, projectRoot, shippedPath = DEFAULT_CONFIG_PATH } = {}) {
  const shipped = loadJsonIfExists(path.resolve(shippedPath));
  const { user, project } = layerPath(home, projectRoot);
  const userLayer = loadJsonIfExists(user);
  const projectLayer = loadJsonIfExists(project);
  const merged = deepMerge(shipped, userLayer, projectLayer);
  return validateRouterTable(merged);
}

function getRouterTable(arg) {
  if (typeof arg === 'string') {
    return loadRouterTable(arg);
  }
  if (arg && typeof arg === 'object') {
    return loadLayeredRouterTable(arg);
  }
  if (!cachedTable) {
    cachedTable = loadRouterTable(DEFAULT_CONFIG_PATH);
  }
  return cachedTable;
}

function resetRouterTableCache() {
  cachedTable = null;
}

module.exports = {
  KNOWN_ROLES,
  KNOWN_TARGETS,
  DEFAULT_CONFIG_PATH,
  validateRouterTable,
  loadRouterTable,
  loadLayeredRouterTable,
  getRouterTable,
  resetRouterTableCache,
  deepMerge,
  layerPath,
};
