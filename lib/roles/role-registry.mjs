import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROLE_TYPES = new Set(['plan', 'approve', 'build', 'review', 'gate', 'specialist']);
export const MODEL_TIERS = new Set(['flash_lo', 'flash', 'pro']);
export const PLAYBOOK_PHASES = new Set(['before', 'during', 'after']);
export const ID_REGEX = /^[a-z0-9_]+$/;
export const ALLOWED_ROLE_FIELDS = new Set([
  'id', 'label', 'role', 'persona', 'personaFile',
  'skills', 'playbooks', 'tools', 'gates', 'model_tier'
]);

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SHIPPED_ROLES_DIR = join(__dirname, 'shipped-roles');

/**
 * Scan a skills directory for all skill IDs (directories containing SKILL.md).
 * @param {string} skillsDir
 * @returns {Set<string>}
 */
export function indexSkills(skillsDir) {
  const skills = new Set();
  if (!skillsDir || !existsSync(skillsDir)) return skills;

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (existsSync(join(full, 'SKILL.md'))) {
          skills.add(e.name);
        }
        walk(full);
      }
    }
  }

  walk(skillsDir);
  return skills;
}

/**
 * Scan playbooks directory for playbook IDs (directories under playbooks/ containing SKILL.md).
 * @param {string} playbooksDir
 * @returns {Set<string>}
 */
export function indexPlaybooks(playbooksDir) {
  const playbooks = new Set();
  if (!playbooksDir || !existsSync(playbooksDir)) return playbooks;

  let entries;
  try {
    entries = readdirSync(playbooksDir, { withFileTypes: true });
  } catch {
    return playbooks;
  }

  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) {
      if (existsSync(join(playbooksDir, e.name, 'SKILL.md'))) {
        playbooks.add(e.name);
      }
    }
  }
  return playbooks;
}

/**
 * Validate raw fields of a role object against the role contract.
 * @param {any} raw
 * @returns {{ valid: boolean, errors: Array<{ code: string, message: string, field?: string }> }}
 */
export function validateRoleFields(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      valid: false,
      errors: [{ code: 'ERR_INVALID_OBJECT', message: 'Role definition must be a JSON object' }]
    };
  }

  // Reject unknown fields
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_ROLE_FIELDS.has(key)) {
      errors.push({ code: 'ERR_UNKNOWN_FIELD', field: key, message: `Unknown field "${key}" in role definition` });
    }
  }

  // id: ^[a-z0-9_]+$
  if (typeof raw.id !== 'string' || !ID_REGEX.test(raw.id)) {
    errors.push({ code: 'ERR_INVALID_ID', field: 'id', message: `Invalid or missing id "${raw.id}". Must match ^[a-z0-9_]+$` });
  }

  // label
  if (typeof raw.label !== 'string' || !raw.label.trim()) {
    errors.push({ code: 'ERR_INVALID_LABEL', field: 'label', message: 'Role label is required and must be a non-empty string' });
  }

  // role enum
  if (typeof raw.role !== 'string' || !ROLE_TYPES.has(raw.role)) {
    errors.push({
      code: 'ERR_INVALID_ROLE_TYPE',
      field: 'role',
      message: `Invalid role type "${raw.role}". Must be one of: ${[...ROLE_TYPES].join(', ')}`
    });
  }

  // persona or personaFile
  const hasPersona = typeof raw.persona === 'string' && raw.persona.trim().length > 0;
  const hasPersonaFile = typeof raw.personaFile === 'string' && raw.personaFile.trim().length > 0;
  if (!hasPersona && !hasPersonaFile) {
    errors.push({
      code: 'ERR_MISSING_PERSONA',
      message: 'Role must define either "persona" (string) or "personaFile" (string path)'
    });
  }

  // skills: string[]
  if (raw.skills !== undefined) {
    if (!Array.isArray(raw.skills) || !raw.skills.every((s) => typeof s === 'string' && s.trim().length > 0)) {
      errors.push({ code: 'ERR_INVALID_SKILLS', field: 'skills', message: 'Role skills must be an array of non-empty strings' });
    }
  }

  // playbooks: (string | { id, phase })[]
  if (raw.playbooks !== undefined) {
    if (!Array.isArray(raw.playbooks)) {
      errors.push({ code: 'ERR_INVALID_PLAYBOOKS', field: 'playbooks', message: 'Role playbooks must be an array' });
    } else {
      for (let i = 0; i < raw.playbooks.length; i++) {
        const pb = raw.playbooks[i];
        if (typeof pb === 'string') {
          if (!pb.trim()) {
            errors.push({ code: 'ERR_INVALID_PLAYBOOK', field: `playbooks[${i}]`, message: 'Playbook id cannot be empty' });
          }
        } else if (pb && typeof pb === 'object' && !Array.isArray(pb)) {
          if (typeof pb.id !== 'string' || !pb.id.trim()) {
            errors.push({ code: 'ERR_INVALID_PLAYBOOK', field: `playbooks[${i}].id`, message: 'Playbook object must have a non-empty string "id"' });
          }
          if (pb.phase !== undefined && !PLAYBOOK_PHASES.has(pb.phase)) {
            errors.push({
              code: 'ERR_INVALID_PLAYBOOK_PHASE',
              field: `playbooks[${i}].phase`,
              message: `Playbook phase must be one of: ${[...PLAYBOOK_PHASES].join(', ')}`
            });
          }
          for (const k of Object.keys(pb)) {
            if (k !== 'id' && k !== 'phase') {
              errors.push({ code: 'ERR_UNKNOWN_FIELD', field: `playbooks[${i}].${k}`, message: `Unknown field "${k}" in playbook object` });
            }
          }
        } else {
          errors.push({ code: 'ERR_INVALID_PLAYBOOK', field: `playbooks[${i}]`, message: 'Each playbook entry must be a string or { id, phase } object' });
        }
      }
    }
  }

  // tools: string[]
  if (raw.tools !== undefined) {
    if (!Array.isArray(raw.tools) || !raw.tools.every((t) => typeof t === 'string' && t.trim().length > 0)) {
      errors.push({ code: 'ERR_INVALID_TOOLS', field: 'tools', message: 'Role tools must be an array of non-empty strings' });
    }
  }

  // gates: string[]
  if (raw.gates !== undefined) {
    if (!Array.isArray(raw.gates) || !raw.gates.every((g) => typeof g === 'string' && g.trim().length > 0)) {
      errors.push({ code: 'ERR_INVALID_GATES', field: 'gates', message: 'Role gates must be an array of non-empty strings' });
    }
  }

  // model_tier
  if (raw.model_tier !== undefined) {
    if (typeof raw.model_tier !== 'string' || !MODEL_TIERS.has(raw.model_tier)) {
      errors.push({
        code: 'ERR_INVALID_MODEL_TIER',
        field: 'model_tier',
        message: `Invalid model_tier "${raw.model_tier}". Must be one of: ${[...MODEL_TIERS].join(', ')}`
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

export function normalizePlaybooks(list) {
  return Array.isArray(list)
    ? list.map((pb) => (typeof pb === 'string' ? { id: pb, phase: 'during' } : { id: pb.id, phase: pb.phase || 'during' }))
    : [];
}

/**
 * Normalizes a role into standard runtime shape.
 * @param {any} raw
 * @param {{ tier?: string, file?: string, overrides?: string }} [meta]
 * @returns {object}
 */
export function normalizeRole(raw, meta = {}) {
  const playbooks = normalizePlaybooks(raw.playbooks);

  const role = {
    id: raw.id,
    label: raw.label,
    role: raw.role,
    ...(raw.persona ? { persona: raw.persona } : {}),
    ...(raw.personaFile ? { personaFile: raw.personaFile } : {}),
    skills: Array.isArray(raw.skills) ? [...raw.skills] : [],
    playbooks,
    tools: Array.isArray(raw.tools) ? [...raw.tools] : [],
    gates: Array.isArray(raw.gates) ? [...raw.gates] : [],
    ...(raw.model_tier ? { model_tier: raw.model_tier } : {}),
    _tier: meta.tier || 'shipped',
  };

  if (meta.file) role._file = meta.file;
  if (meta.overrides) role._overrides = meta.overrides;

  return role;
}

/**
 * Derives shipped default roles from a loaded nodes.json object.
 * @param {object} nodesJson
 * @returns {object[]}
 */
export function deriveShippedRoles(nodesJson) {
  const roles = [];
  if (!nodesJson?.nodes || typeof nodesJson.nodes !== 'object') return roles;

  for (const [nodeId, node] of Object.entries(nodesJson.nodes)) {
    const raw = {
      id: nodeId,
      label: node.label || nodeId,
      role: node.role,
      personaFile: node.personaFile,
      skills: Array.isArray(node.skills) ? [...node.skills] : [],
      playbooks: [],
      tools: [],
      gates: [],
    };
    roles.push(normalizeRole(raw, { tier: 'shipped' }));
  }

  return roles;
}

/**
 * Loads role or team JSON files from one directory tier (e.g. .aos/roles/ or ~/.aos/teams/).
 * @param {string} dirPath
 * @param {string} tier
 * @param {Array<object>} errors
 * @param {{ kind: 'role'|'team', validate: Function, normalize: Function }} spec
 * @returns {Map<string, object>}
 */
export function loadTierEntries(dirPath, tier, errors, { kind, validate, normalize }) {
  const entriesById = new Map();
  if (!dirPath || !existsSync(dirPath)) return entriesById;

  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    errors.push({ tier, file: dirPath, code: 'ERR_READ_DIR', message: err.message });
    return entriesById;
  }

  // Sort files for deterministic ordering
  const jsonFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => e.name)
    .sort();

  for (const name of jsonFiles) {
    const fullPath = join(dirPath, name);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(fullPath, 'utf8'));
    } catch (err) {
      errors.push({
        tier,
        file: fullPath,
        code: 'ERR_INVALID_JSON',
        message: `Failed to parse JSON in ${fullPath}: ${err.message}`
      });
      continue;
    }

    const { valid, errors: valErrors } = validate(parsed);
    if (!valid) {
      for (const err of valErrors) {
        errors.push({
          tier,
          file: fullPath,
          [`${kind}Id`]: parsed?.id,
          ...err
        });
      }
      continue;
    }

    if (entriesById.has(parsed.id)) {
      errors.push({
        tier,
        file: fullPath,
        [`${kind}Id`]: parsed.id,
        code: 'ERR_DUPLICATE_ID',
        message: `Duplicate ${kind} id "${parsed.id}" in ${tier} tier (already defined in ${entriesById.get(parsed.id)._file})`
      });
      continue;
    }

    entriesById.set(parsed.id, normalize(parsed, { tier, file: fullPath }));
  }

  return entriesById;
}

/**
 * Merges tiers in precedence project > user > shipped, recording each override.
 * @returns {{ resolved: Map<string, object>, overrides: Array<object> }}
 */
export function resolveTiers(shipped, user, project) {
  const resolved = new Map(shipped);
  const overrides = [];
  for (const [tier, map] of [['user', user], ['project', project]]) {
    for (const [id, entry] of map) {
      if (resolved.has(id)) {
        const overridden = resolved.get(id);
        entry._overrides = overridden._tier;
        overrides.push({ id, tier, overrides: overridden._tier });
      }
      resolved.set(id, entry);
    }
  }
  return { resolved, overrides };
}

const loadTierRoles = (dirPath, tier, errors) =>
  loadTierEntries(dirPath, tier, errors, { kind: 'role', validate: validateRoleFields, normalize: normalizeRole });

/**
 * Main role registry loader.
 * Precedence: project (.aos/roles/*.json) > user (~/.aos/roles/*.json) > shipped (.agents/nodes.json + lib/roles/shipped-roles/).
 *
 * @param {object} [options]
 * @param {string} [options.cwd] Project workspace directory (default: process.cwd())
 * @param {string|null} [options.home] User HOME directory (explicitly parameter-injected, NEVER read process.env.HOME)
 * @param {string} [options.skillsDir] Path to skills directory (default: <cwd>/skills)
 * @param {string} [options.playbooksDir] Path to playbooks directory (default: <cwd>/skills/playbooks)
 * @param {string} [options.nodesJsonPath] Path to nodes.json (default: <cwd>/.agents/nodes.json)
 * @param {string} [options.shippedRolesDir] Path to shipped roles directory (default: <module-dir>/shipped-roles)
 * @param {string} [options.projectRolesDir] Path to project roles dir (default: <cwd>/.aos/roles)
 * @param {string} [options.userRolesDir] Path to user roles dir (default: <home>/.aos/roles if home provided)
 * @returns {RoleRegistry}
 */
export function loadRoleRegistry(options = {}) {
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  const home = typeof options.home === 'string' && options.home.trim().length > 0 ? resolve(options.home) : null;
  const skillsDir = options.skillsDir ? resolve(options.skillsDir) : join(cwd, 'skills');
  const playbooksDir = options.playbooksDir ? resolve(options.playbooksDir) : join(skillsDir, 'playbooks');
  const nodesJsonPath = options.nodesJsonPath ? resolve(options.nodesJsonPath) : join(cwd, '.agents', 'nodes.json');
  const projectRolesDir = options.projectRolesDir ? resolve(options.projectRolesDir) : join(cwd, '.aos', 'roles');
  const userRolesDir = options.userRolesDir ? resolve(options.userRolesDir) : (home ? join(home, '.aos', 'roles') : null);

  const errors = [];
  const warnings = [];
  const unresolvedSkills = [];

  // Index available skills and playbooks for reference checks
  const availableSkills = indexSkills(skillsDir);
  const availablePlaybooks = indexPlaybooks(playbooksDir);

  // 1. Shipped defaults tier (nodes.json + lib/roles/shipped-roles/)
  const shippedRolesMap = new Map();
  if (existsSync(nodesJsonPath)) {
    try {
      const nodesData = JSON.parse(readFileSync(nodesJsonPath, 'utf8'));
      const shipped = deriveShippedRoles(nodesData);
      for (const role of shipped) {
        shippedRolesMap.set(role.id, role);
      }
    } catch (err) {
      errors.push({
        tier: 'shipped',
        file: nodesJsonPath,
        code: 'ERR_NODES_JSON',
        message: `Failed to load shipped defaults from nodes.json: ${err.message}`
      });
    }
  }

  const shippedRolesDir = options.shippedRolesDir ? resolve(options.shippedRolesDir) : SHIPPED_ROLES_DIR;
  if (existsSync(shippedRolesDir)) {
    const shippedDirRoles = loadTierRoles(shippedRolesDir, 'shipped', errors);
    for (const [id, role] of shippedDirRoles) {
      shippedRolesMap.set(id, role);
    }
  }

  // 2. User tier
  const userRolesMap = userRolesDir ? loadTierRoles(userRolesDir, 'user', errors) : new Map();

  // 3. Project tier
  const projectRolesMap = loadTierRoles(projectRolesDir, 'project', errors);

  const { resolved: resolvedRoles, overrides } = resolveTiers(shippedRolesMap, userRolesMap, projectRolesMap);

  // Cross-reference skills and playbooks for all resolved roles
  for (const role of resolvedRoles.values()) {
    // Check skills
    for (const skill of role.skills) {
      if (!availableSkills.has(skill)) {
        unresolvedSkills.push({
          roleId: role.id,
          skill,
          tier: role._tier,
          file: role._file || null
        });
        warnings.push({
          tier: role._tier,
          roleId: role.id,
          code: 'WARN_UNRESOLVED_SKILL',
          message: `Role "${role.id}" references skill "${skill}" which does not exist under ${skillsDir}`
        });
      }
    }

    // Check playbooks
    for (const pb of role.playbooks) {
      if (!availablePlaybooks.has(pb.id)) {
        errors.push({
          tier: role._tier,
          file: role._file || null,
          roleId: role.id,
          playbook: pb.id,
          code: 'ERR_UNRESOLVED_PLAYBOOK',
          message: `Role "${role.id}" references playbook "${pb.id}" which does not exist under ${playbooksDir}`
        });
      }
    }
  }

  return {
    roles: resolvedRoles,
    errors,
    warnings,
    unresolvedSkills,
    overrides,
    shippedRoles: shippedRolesMap,
    userRoles: userRolesMap,
    projectRoles: projectRolesMap,
    availableSkills,
    availablePlaybooks,

    get(id) {
      return resolvedRoles.get(id);
    },
    has(id) {
      return resolvedRoles.has(id);
    },
    list() {
      return Array.from(resolvedRoles.values());
    }
  };
}
