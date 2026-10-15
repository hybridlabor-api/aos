import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';

export const EFFORTS = new Set(['S', 'M', 'L']);
export const ID_REGEX = /^[a-z0-9_-]+$/;
export const ALLOWED_TEAM_FIELDS = new Set(['id', 'label', 'roles', 'playbooks', 'gates', 'effort']);

/**
 * Maps effort tier to repair loop rounds:
 * S = 3, M = 4, L = 5
 * @param {string} effort
 * @returns {number}
 */
export function effortRounds(effort = 'S') {
  switch (effort) {
    case 'L': return 5;
    case 'M': return 4;
    case 'S':
    default: return 3;
  }
}

export const SHIPPED_DEFAULT_TEAM = Object.freeze({
  id: 'default',
  label: 'Default Team',
  roles: ['architect', 'techlead', 'ui_ux', 'engineering', 'media_eventtech', 'reviewer', 'shipping'],
  playbooks: [],
  gates: [],
  effort: 'S',
  _tier: 'shipped',
});

/**
 * Validate raw team object fields against the team schema.
 * @param {any} raw
 * @returns {{ valid: boolean, errors: Array<{ code: string, message: string, field?: string }> }}
 */
export function validateTeamFields(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      valid: false,
      errors: [{ code: 'ERR_INVALID_OBJECT', message: 'Team definition must be a JSON object' }]
    };
  }

  // Reject unknown fields
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_TEAM_FIELDS.has(key)) {
      errors.push({ code: 'ERR_UNKNOWN_FIELD', field: key, message: `Unknown field "${key}" in team definition` });
    }
  }

  // id: ^[a-z0-9_-]+$
  if (typeof raw.id !== 'string' || !ID_REGEX.test(raw.id)) {
    errors.push({ code: 'ERR_INVALID_ID', field: 'id', message: `Invalid or missing team id "${raw.id}". Must match ^[a-z0-9_-]+$` });
  }

  // label
  if (typeof raw.label !== 'string' || !raw.label.trim()) {
    errors.push({ code: 'ERR_INVALID_LABEL', field: 'label', message: 'Team label is required and must be a non-empty string' });
  }

  // roles: string[]
  if (!Array.isArray(raw.roles) || raw.roles.length === 0 || !raw.roles.every((r) => typeof r === 'string' && r.trim().length > 0)) {
    errors.push({ code: 'ERR_INVALID_ROLES', field: 'roles', message: 'Team roles must be a non-empty array of role IDs' });
  }

  // playbooks
  if (raw.playbooks !== undefined) {
    if (!Array.isArray(raw.playbooks)) {
      errors.push({ code: 'ERR_INVALID_PLAYBOOKS', field: 'playbooks', message: 'Team playbooks must be an array' });
    }
  }

  // gates
  if (raw.gates !== undefined) {
    if (!Array.isArray(raw.gates) || !raw.gates.every((g) => typeof g === 'string')) {
      errors.push({ code: 'ERR_INVALID_GATES', field: 'gates', message: 'Team gates must be an array of strings' });
    }
  }

  // effort
  if (raw.effort !== undefined) {
    if (typeof raw.effort !== 'string' || !EFFORTS.has(raw.effort)) {
      errors.push({ code: 'ERR_INVALID_EFFORT', field: 'effort', message: `Team effort must be one of: S, M, L` });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Normalizes a team into standard runtime shape.
 * @param {any} raw
 * @param {{ tier?: string, file?: string, overrides?: string }} [meta]
 * @returns {object}
 */
export function normalizeTeam(raw, meta = {}) {
  const playbooks = Array.isArray(raw.playbooks)
    ? raw.playbooks.map((pb) => (typeof pb === 'string' ? { id: pb, phase: 'during' } : { id: pb.id, phase: pb.phase || 'during' }))
    : [];

  const team = {
    id: raw.id,
    label: raw.label,
    roles: Array.isArray(raw.roles) ? [...raw.roles] : [],
    playbooks,
    gates: Array.isArray(raw.gates) ? [...raw.gates] : [],
    effort: raw.effort && EFFORTS.has(raw.effort) ? raw.effort : 'S',
    _tier: meta.tier || 'shipped',
  };

  if (meta.file) team._file = meta.file;
  if (meta.overrides) team._overrides = meta.overrides;

  return team;
}

/**
 * Loads teams from a specific directory tier.
 * @param {string} dirPath
 * @param {string} tier
 * @param {Array<object>} errors
 * @returns {Map<string, object>}
 */
function loadTierTeams(dirPath, tier, errors) {
  const tierTeams = new Map();
  if (!dirPath || !existsSync(dirPath)) return tierTeams;

  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    errors.push({ tier, file: dirPath, code: 'ERR_READ_DIR', message: err.message });
    return tierTeams;
  }

  const jsonFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => e.name)
    .sort();

  for (const name of jsonFiles) {
    const fullPath = join(dirPath, name);
    let parsed;
    try {
      const text = readFileSync(fullPath, 'utf8');
      parsed = JSON.parse(text);
    } catch (err) {
      errors.push({
        tier,
        file: fullPath,
        code: 'ERR_INVALID_JSON',
        message: `Failed to parse JSON in ${fullPath}: ${err.message}`
      });
      continue;
    }

    const { valid, errors: valErrors } = validateTeamFields(parsed);
    if (!valid) {
      for (const err of valErrors) {
        errors.push({
          tier,
          file: fullPath,
          teamId: parsed?.id,
          ...err
        });
      }
      continue;
    }

    if (tierTeams.has(parsed.id)) {
      errors.push({
        tier,
        file: fullPath,
        teamId: parsed.id,
        code: 'ERR_DUPLICATE_ID',
        message: `Duplicate team id "${parsed.id}" in ${tier} tier (already defined in ${tierTeams.get(parsed.id)._file})`
      });
      continue;
    }

    tierTeams.set(parsed.id, normalizeTeam(parsed, { tier, file: fullPath }));
  }

  return tierTeams;
}

/**
 * Loads team registry across three tiers:
 * Precedence: project (.aos/teams/*.json) > user (~/.aos/teams/*.json) > shipped (default team).
 *
 * @param {object} [options]
 * @param {string} [options.cwd] Project directory (default: process.cwd())
 * @param {string|null} [options.home] User HOME directory (explicit parameter, never process.env.HOME)
 * @param {string} [options.projectTeamsDir] Path to project teams directory (default: <cwd>/.aos/teams)
 * @param {string} [options.userTeamsDir] Path to user teams directory (default: <home>/.aos/teams if home provided)
 * @param {object} [options.roleRegistry] Optional RoleRegistry instance to cross-check role existence
 * @returns {TeamRegistry}
 */
export function loadTeamRegistry(options = {}) {
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  const home = typeof options.home === 'string' && options.home.trim().length > 0 ? resolve(options.home) : null;
  const projectTeamsDir = options.projectTeamsDir ? resolve(options.projectTeamsDir) : join(cwd, '.aos', 'teams');
  const userTeamsDir = options.userTeamsDir ? resolve(options.userTeamsDir) : (home ? join(home, '.aos', 'teams') : null);

  const errors = [];
  const warnings = [];

  // 1. Shipped tier
  const shippedTeamsMap = new Map();
  shippedTeamsMap.set('default', { ...SHIPPED_DEFAULT_TEAM });

  // 2. User tier
  const userTeamsMap = userTeamsDir ? loadTierTeams(userTeamsDir, 'user', errors) : new Map();

  // 3. Project tier
  const projectTeamsMap = loadTierTeams(projectTeamsDir, 'project', errors);

  // Resolution
  const resolvedTeams = new Map();
  const overrides = [];

  // Add shipped
  for (const [id, team] of shippedTeamsMap) {
    resolvedTeams.set(id, team);
  }

  // Override with user
  for (const [id, team] of userTeamsMap) {
    if (resolvedTeams.has(id)) {
      const overridden = resolvedTeams.get(id);
      team._overrides = overridden._tier;
      overrides.push({ id, tier: 'user', overrides: overridden._tier });
    }
    resolvedTeams.set(id, team);
  }

  // Override with project
  for (const [id, team] of projectTeamsMap) {
    if (resolvedTeams.has(id)) {
      const overridden = resolvedTeams.get(id);
      team._overrides = overridden._tier;
      overrides.push({ id, tier: 'project', overrides: overridden._tier });
    }
    resolvedTeams.set(id, team);
  }

  // Role existence cross-check if roleRegistry is supplied
  if (options.roleRegistry) {
    for (const team of resolvedTeams.values()) {
      for (const roleId of team.roles) {
        if (!options.roleRegistry.has(roleId)) {
          warnings.push({
            teamId: team.id,
            roleId,
            tier: team._tier,
            code: 'WARN_UNKNOWN_ROLE',
            message: `Team "${team.id}" references role "${roleId}" which is not found in role registry`
          });
        }
      }
    }
  }

  return {
    teams: resolvedTeams,
    errors,
    warnings,
    overrides,
    shippedTeams: shippedTeamsMap,
    userTeams: userTeamsMap,
    projectTeams: projectTeamsMap,

    get(id) {
      return resolvedTeams.get(id);
    },
    has(id) {
      return resolvedRolesOrTeamsHas(resolvedTeams, id);
    },
    list() {
      return Array.from(resolvedTeams.values());
    }
  };
}

function resolvedRolesOrTeamsHas(map, id) {
  return map.has(id);
}

/**
 * Extracts frontmatter string block from markdown content.
 * @param {string} content
 * @returns {string|null}
 */
function extractFrontmatterText(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  return match ? match[1] : null;
}

/**
 * Minimal zero-dependency parser for flow lists like [a, b, c] or multi-line items.
 * @param {string} val
 * @returns {string[]}
 */
function parseStringList(val) {
  if (!val) return [];
  const trimmed = val.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
  return [trimmed.replace(/^['"]|['"]$/g, '')].filter(Boolean);
}

/**
 * Parses playbook frontmatter `requires` section.
 * @param {string} fmText
 * @returns {{ name?: string, description?: string, skills: string[], agents: string[], mcps: string[], tools: string[] }}
 */
export function parsePlaybookFrontmatter(fmText) {
  const result = {
    name: '',
    description: '',
    skills: [],
    agents: [],
    mcps: [],
    tools: []
  };

  const lines = fmText.split(/\r?\n/);
  let inRequires = false;
  let currentKey = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^name:\s*(.+)$/.test(line)) {
      result.name = line.match(/^name:\s*(.+)$/)[1].trim().replace(/^['"]|['"]$/g, '');
      continue;
    }

    if (/^requires:/.test(line)) {
      inRequires = true;
      continue;
    }

    if (inRequires) {
      // Check if we exited requires block
      if (/^[a-zA-Z0-9_-]+:/.test(line) && !line.startsWith(' ') && !line.startsWith('\t')) {
        inRequires = false;
        continue;
      }

      // Check subkeys in requires: skills, agents, mcps, tools
      const subMatch = /^\s+([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line);
      if (subMatch) {
        currentKey = subMatch[1];
        const val = subMatch[2].trim();
        if (val) {
          if (currentKey === 'skills') result.skills.push(...parseStringList(val));
          else if (currentKey === 'agents') result.agents.push(...parseStringList(val));
          else if (currentKey === 'mcps') result.mcps.push(...parseStringList(val));
          else if (currentKey === 'tools') result.tools.push(...parseStringList(val));
        }
        continue;
      }

      // List item continuation under currentKey
      const itemMatch = /^\s+-\s+(.+)$/.exec(line);
      if (itemMatch && currentKey) {
        const itemVal = itemMatch[1].trim().replace(/^['"]|['"]$/g, '');
        if (currentKey === 'skills') result.skills.push(itemVal);
        else if (currentKey === 'agents') result.agents.push(itemVal);
        else if (currentKey === 'mcps') result.mcps.push(itemVal);
        else if (currentKey === 'tools') result.tools.push(itemVal);
      }
    }
  }

  return result;
}

/**
 * Resolves the path to a playbook SKILL.md.
 * Accepts:
 * - full path to SKILL.md
 * - path to playbook directory containing SKILL.md
 * - playbook name (e.g. 'pb-tauri-e2e') relative to cwd or skills/playbooks
 * @param {string} playbookSkillPath
 * @param {string} [cwd]
 * @returns {string}
 */
export function resolvePlaybookPath(playbookSkillPath, cwd = process.cwd()) {
  const candidates = [
    playbookSkillPath,
    join(playbookSkillPath, 'SKILL.md'),
    join(cwd, playbookSkillPath),
    join(cwd, playbookSkillPath, 'SKILL.md'),
    join(cwd, 'skills', 'playbooks', playbookSkillPath, 'SKILL.md'),
    join(cwd, 'skills', 'playbooks', playbookSkillPath),
  ];

  for (const c of candidates) {
    if (existsSync(c)) {
      try {
        if (statSync(c).isFile()) return c;
      } catch {}
    }
  }

  throw new Error(`Playbook not found: "${playbookSkillPath}" (searched in ${candidates.join(', ')})`);
}

/**
 * Derives a team definition from a playbook's frontmatter `requires: { skills, agents, mcps, tools }`.
 * Agents become role IDs if a role of that ID exists in the role registry, otherwise reported as missing.
 *
 * @param {string} playbookSkillPath Path to playbook SKILL.md, playbook dir, or playbook name
 * @param {object} [options]
 * @param {object} [options.roleRegistry] RoleRegistry instance
 * @param {string} [options.cwd] Project directory
 * @param {string} [options.home] User HOME directory
 * @param {string} [options.id] Custom team id
 * @param {string} [options.label] Custom team label
 * @param {string} [options.effort] Effort level ('S' | 'M' | 'L', default 'M')
 * @returns {{ team: object, missingRoles: string[], skills: string[], mcps: string[], tools: string[], playbook: string }}
 */
export function teamFromPlaybook(playbookSkillPath, options = {}) {
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  const filePath = resolvePlaybookPath(playbookSkillPath, cwd);
  const content = readFileSync(filePath, 'utf8');

  const fmText = extractFrontmatterText(content);
  if (!fmText) {
    throw new Error(`No frontmatter found in playbook at ${filePath}`);
  }

  const parsed = parsePlaybookFrontmatter(fmText);
  const playbookName = parsed.name || basename(dirname(filePath));

  const matchedRoles = [];
  const missingRoles = [];

  const roleRegistry = options.roleRegistry || null;

  for (const agent of parsed.agents) {
    if (roleRegistry) {
      if (roleRegistry.has(agent)) {
        matchedRoles.push(agent);
      } else {
        missingRoles.push(agent);
      }
    } else {
      // If no registry passed, assume agent is role id
      matchedRoles.push(agent);
    }
  }

  const teamId = options.id || playbookName.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const teamLabel = options.label || `${playbookName} Team`;
  const effort = options.effort && EFFORTS.has(options.effort) ? options.effort : 'M';

  const team = {
    id: teamId,
    label: teamLabel,
    roles: matchedRoles,
    playbooks: [playbookName],
    gates: [],
    effort
  };

  return {
    team,
    missingRoles,
    skills: parsed.skills,
    mcps: parsed.mcps,
    tools: parsed.tools,
    playbook: playbookName
  };
}
