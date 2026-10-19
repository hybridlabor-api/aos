import { indexSkills, indexPlaybooks } from './role-registry.mjs';

export const WORKSTREAM_CAP = 6;
export const TARGET_WORKSTREAMS = 4;
export const WORKSTREAM_ID_REGEX = /^[a-z0-9_]+$/;

export const AGENT_ALIASES = Object.freeze({
  'engineering': 'godmode-engineering',
  'godmode-engineering': 'engineering',
  'godmode_engineering': 'engineering',
  'ui_ux': 'godmode-ui-ux',
  'ui-ux': 'godmode-ui-ux',
  'godmode-ui-ux': 'ui_ux',
  'godmode_ui_ux': 'ui_ux',
  'shipping': 'godmode-shipping',
  'godmode-shipping': 'shipping',
  'godmode_shipping': 'shipping',
  'media_eventtech': 'godmode-media-eventtech',
  'media-eventtech': 'godmode-media-eventtech',
  'godmode-media-eventtech': 'media_eventtech',
  'godmode_media_eventtech': 'media_eventtech',
});

/**
 * Normalizes an agent name or alias.
 * @param {string} name
 * @returns {string}
 */
export function resolveAgentName(name) {
  if (typeof name !== 'string') return name;
  const normalized = name.trim();
  const stripped = normalized.includes(':') ? normalized.split(':').pop() : normalized;
  return AGENT_ALIASES[stripped] || stripped;
}

/**
 * Returns canonical node ID (e.g. 'engineering' instead of 'godmode-engineering').
 * @param {string} name
 * @returns {string}
 */
export function canonicalNodeId(name) {
  if (typeof name !== 'string') return name;
  const stripped = name.includes(':') ? name.split(':').pop() : name;
  if (['architect', 'techlead', 'ui_ux', 'engineering', 'media_eventtech', 'reviewer', 'shipping'].includes(stripped)) {
    return stripped;
  }
  const resolved = AGENT_ALIASES[stripped];
  if (resolved && ['architect', 'techlead', 'ui_ux', 'engineering', 'media_eventtech', 'reviewer', 'shipping'].includes(resolved)) {
    return resolved;
  }
  return stripped;
}

/**
 * Returns canonical agentType (e.g. 'godmode-engineering' instead of 'engineering').
 * @param {string} name
 * @returns {string}
 */
export function canonicalAgentType(name) {
  if (typeof name !== 'string') return name;
  const stripped = name.includes(':') ? name.split(':').pop() : name;
  if (['godmode-ui-ux', 'godmode-engineering', 'godmode-media-eventtech', 'godmode-shipping'].includes(stripped)) {
    return stripped;
  }
  const resolved = AGENT_ALIASES[stripped];
  if (resolved && ['godmode-ui-ux', 'godmode-engineering', 'godmode-media-eventtech', 'godmode-shipping'].includes(resolved)) {
    return resolved;
  }
  return stripped;
}

/**
 * Extracts --workstreams flag from input text/goal.
 * Default is OFF (workstreams: false).
 * @param {string|any} text
 * @returns {{ workstreams: boolean, goal: string|any }}
 */
export function extractWorkstreamsFlag(text) {
  if (typeof text !== 'string') return { workstreams: false, goal: text };
  const flagPattern = /--workstreams\b/i;
  const hasFlag = flagPattern.test(text);
  const goal = hasFlag ? text.replace(flagPattern, '').replace(/\s{2,}/g, ' ').trim() : text;
  return { workstreams: hasFlag, goal };
}

/**
 * Validates execution_manifest authored by Architect before TechLead approval.
 * Ensures:
 * - createdBy is 'architect'
 * - workstream count between 1 and 6 (cap 6, target 4)
 * - unique stream IDs matching ^[a-z0-9_]+$
 * - all skills exist via lib/roles indexSkills (or options.availableSkills)
 * - all playbooks exist via lib/roles indexPlaybooks (or options.availablePlaybooks)
 * - valid role types and artifact keys
 *
 * @param {any} manifest
 * @param {object} [options]
 * @param {Set<string>} [options.availableSkills]
 * @param {Set<string>} [options.availablePlaybooks]
 * @param {string} [options.skillsDir]
 * @param {string} [options.playbooksDir]
 * @param {object} [options.roleRegistry]
 * @returns {{ valid: boolean, errors: Array<{ code: string, message: string, streamId?: string, field?: string }> }}
 */
export function validateExecutionManifest(manifest, options = {}) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return {
      valid: false,
      errors: [{ code: 'ERR_INVALID_MANIFEST', message: 'Execution manifest must be a non-null object' }]
    };
  }

  if (manifest.createdBy !== 'architect') {
    errors.push({
      code: 'ERR_INVALID_CREATED_BY',
      field: 'createdBy',
      message: `Execution manifest createdBy must be "architect", got "${manifest.createdBy}"`
    });
  }

  if (manifest.effort !== undefined) {
    if (!['S', 'M', 'L'].includes(manifest.effort)) {
      errors.push({
        code: 'ERR_INVALID_EFFORT',
        field: 'effort',
        message: `Execution manifest effort must be one of: S, M, L, got "${manifest.effort}"`
      });
    }
  }

  if (!Array.isArray(manifest.workstreams)) {
    errors.push({
      code: 'ERR_MISSING_WORKSTREAMS',
      field: 'workstreams',
      message: 'Execution manifest must contain a "workstreams" array'
    });
    return { valid: false, errors };
  }

  const streams = manifest.workstreams;
  if (streams.length === 0) {
    errors.push({
      code: 'ERR_EMPTY_WORKSTREAMS',
      field: 'workstreams',
      message: 'Execution manifest must define at least 1 workstream'
    });
  }

  if (streams.length > WORKSTREAM_CAP) {
    errors.push({
      code: 'ERR_WORKSTREAM_CAP_EXCEEDED',
      field: 'workstreams',
      message: `Workstream count (${streams.length}) exceeds hard cap of ${WORKSTREAM_CAP} (target: 1-${TARGET_WORKSTREAMS})`
    });
  }

  const availableSkills = options.availableSkills ||
    options.roleRegistry?.availableSkills ||
    (options.skillsDir ? indexSkills(options.skillsDir) : null);
  const availablePlaybooks = options.availablePlaybooks ||
    options.roleRegistry?.availablePlaybooks ||
    (options.playbooksDir ? indexPlaybooks(options.playbooksDir) : null);
  const roleRegistry = options.roleRegistry || null;

  const seenIds = new Set();

  for (let i = 0; i < streams.length; i++) {
    const ws = streams[i];
    if (!ws || typeof ws !== 'object' || Array.isArray(ws)) {
      errors.push({
        code: 'ERR_INVALID_STREAM_OBJECT',
        field: `workstreams[${i}]`,
        message: `Workstream at index ${i} must be an object`
      });
      continue;
    }

    const streamId = ws.id;

    // 1. ID validation
    if (typeof streamId !== 'string' || !WORKSTREAM_ID_REGEX.test(streamId)) {
      errors.push({
        code: 'ERR_INVALID_STREAM_ID',
        streamId,
        field: `workstreams[${i}].id`,
        message: `Workstream id "${streamId}" is invalid. Must match pattern ${WORKSTREAM_ID_REGEX}`
      });
    } else {
      if (seenIds.has(streamId)) {
        errors.push({
          code: 'ERR_DUPLICATE_STREAM_ID',
          streamId,
          field: `workstreams[${i}].id`,
          message: `Duplicate workstream id "${streamId}" at index ${i}`
        });
      }
      seenIds.add(streamId);
    }

    // 2. agentType validation
    if (typeof ws.agentType !== 'string' || !ws.agentType.trim()) {
      errors.push({
        code: 'ERR_MISSING_AGENT_TYPE',
        streamId,
        field: `workstreams[${i}].agentType`,
        message: `Workstream "${streamId || i}" is missing required "agentType"`
      });
    }

    // 3. role validation (optional field, but if present must be valid enum)
    if (ws.role !== undefined) {
      if (typeof ws.role !== 'string' || !['plan', 'approve', 'build', 'review', 'gate', 'specialist'].includes(ws.role)) {
        errors.push({
          code: 'ERR_INVALID_ROLE_TYPE',
          streamId,
          field: `workstreams[${i}].role`,
          message: `Workstream "${streamId || i}" has invalid role "${ws.role}". Must be one of: plan, approve, build, review, gate, specialist`
        });
      }
    }

    // 4. Role existence check if roleRegistry provided
    if (roleRegistry) {
      const targetRole = ws.role || ws.id;
      const canonical = canonicalNodeId(targetRole);
      const isKnown = roleRegistry.has(targetRole) || roleRegistry.has(canonical) || roleRegistry.has(ws.agentType) || roleRegistry.has(canonicalAgentType(ws.agentType));
      // If not in registry, verify it is a valid ad-hoc role: must have skills provided
      if (!isKnown && (!Array.isArray(ws.skills) || ws.skills.length === 0)) {
        errors.push({
          code: 'ERR_UNRESOLVED_ROLE',
          streamId,
          field: `workstreams[${i}].role`,
          message: `Workstream "${streamId || i}" references unknown role "${targetRole}" without providing skills for an ad-hoc composition`
        });
      }
    }

    // 5. skills validation: array of existing skills
    if (!Array.isArray(ws.skills)) {
      errors.push({
        code: 'ERR_MISSING_SKILLS',
        streamId,
        field: `workstreams[${i}].skills`,
        message: `Workstream "${streamId || i}" must specify a "skills" array`
      });
    } else if (ws.skills.length === 0) {
      errors.push({
        code: 'ERR_EMPTY_SKILLS',
        streamId,
        field: `workstreams[${i}].skills`,
        message: `Workstream "${streamId || i}" skills array must not be empty`
      });
    } else {
      for (const skill of ws.skills) {
        if (typeof skill !== 'string' || !skill.trim()) {
          errors.push({
            code: 'ERR_EMPTY_SKILL_NAME',
            streamId,
            field: `workstreams[${i}].skills`,
            message: `Workstream "${streamId || i}" contains an empty skill name`
          });
        } else if (availableSkills && !availableSkills.has(skill)) {
          errors.push({
            code: 'ERR_UNRESOLVED_SKILL',
            streamId,
            field: `workstreams[${i}].skills`,
            message: `Workstream "${streamId || i}" references nonexistent skill "${skill}"`
          });
        }
      }
    }

    // 6. playbooks validation: optional, but all referenced playbooks must exist
    if (ws.playbooks !== undefined) {
      if (!Array.isArray(ws.playbooks)) {
        errors.push({
          code: 'ERR_INVALID_PLAYBOOKS',
          streamId,
          field: `workstreams[${i}].playbooks`,
          message: `Workstream "${streamId || i}" playbooks must be an array`
        });
      } else {
        for (let pbIdx = 0; pbIdx < ws.playbooks.length; pbIdx++) {
          const pb = ws.playbooks[pbIdx];
          const pbId = typeof pb === 'string' ? pb : pb?.id;
          if (typeof pbId !== 'string' || !pbId.trim()) {
            errors.push({
              code: 'ERR_INVALID_PLAYBOOK',
              streamId,
              field: `workstreams[${i}].playbooks[${pbIdx}]`,
              message: `Workstream "${streamId || i}" contains invalid playbook entry`
            });
          } else if (availablePlaybooks && !availablePlaybooks.has(pbId)) {
            errors.push({
              code: 'ERR_UNRESOLVED_PLAYBOOK',
              streamId,
              field: `workstreams[${i}].playbooks[${pbIdx}]`,
              message: `Workstream "${streamId || i}" references nonexistent playbook "${pbId}"`
            });
          }

          if (typeof pb === 'object' && pb !== null && pb.phase !== undefined) {
            if (!['before', 'during', 'after'].includes(pb.phase)) {
              errors.push({
                code: 'ERR_INVALID_PLAYBOOK_PHASE',
                streamId,
                field: `workstreams[${i}].playbooks[${pbIdx}].phase`,
                message: `Workstream "${streamId || i}" playbook "${pbId}" has invalid phase "${pb.phase}". Must be before, during, or after`
              });
            }
          }
        }
      }
    }

    // 7. artifactKey validation
    if (typeof ws.artifactKey !== 'string' || !ws.artifactKey.trim()) {
      errors.push({
        code: 'ERR_MISSING_ARTIFACT_KEY',
        streamId,
        field: `workstreams[${i}].artifactKey`,
        message: `Workstream "${streamId || i}" is missing required "artifactKey" string`
      });
    }

    // 8. gates validation: optional array of strings
    if (ws.gates !== undefined) {
      if (!Array.isArray(ws.gates) || !ws.gates.every((g) => typeof g === 'string' && g.trim().length > 0)) {
        errors.push({
          code: 'ERR_INVALID_GATES',
          streamId,
          field: `workstreams[${i}].gates`,
          message: `Workstream "${streamId || i}" gates must be an array of non-empty strings`
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Builds runtime build nodes for pipeline() execution from an execution manifest.
 * @param {object} manifest
 * @param {object} [options]
 * @param {object} [options.roleRegistry]
 * @returns {Array<object>}
 */
export function buildNodesFromManifest(manifest, options = {}) {
  if (!manifest?.workstreams || !Array.isArray(manifest.workstreams)) return [];
  const registry = options.roleRegistry || null;

  return manifest.workstreams.map((ws) => {
    const roleId = ws.role || canonicalNodeId(ws.id);
    const roleMeta = registry?.get?.(ws.id) || registry?.get?.(roleId) || registry?.get?.(ws.agentType);

    const playbooks = Array.isArray(ws.playbooks)
      ? ws.playbooks.map((pb) => (typeof pb === 'string' ? { id: pb, phase: 'during' } : pb))
      : (roleMeta?.playbooks || []);

    const agentType = canonicalAgentType(ws.agentType || roleMeta?.agentType || ws.id);

    return {
      id: ws.id,
      label: ws.label || roleMeta?.label || ws.id,
      agentType,
      personaFile: ws.personaFile || roleMeta?.personaFile || `.claude/agents/${agentType}.md`,
      role: ws.role || 'build',
      artifactKey: ws.artifactKey || ws.id,
      writes: `production_artifacts/state.d/${ws.id}.json`,
      optional: false,
      skills: Array.isArray(ws.skills) && ws.skills.length > 0 ? [...ws.skills] : (roleMeta?.skills || []),
      playbooks,
      gates: Array.isArray(ws.gates) ? [...ws.gates] : (roleMeta?.gates || []),
      instructions: ws.instructions || `Execute workstream ${ws.id} per the execution plan. Produce ${ws.artifactKey || ws.id} artifact and implement assigned components.`,
    };
  });
}

/**
 * Collects gates defined across all workstreams, or falls back to defaults.
 * @param {Array<object>} workstreams
 * @param {Array<string>} [fallbackGates]
 * @returns {Array<string>}
 */
export function deriveWorkstreamGates(workstreams, fallbackGates = ['lint', 'typecheck', 'tests', 'a11y', 'seo', 'security']) {
  if (!Array.isArray(workstreams) || workstreams.length === 0) return [...fallbackGates];
  const custom = [];
  for (const ws of workstreams) {
    if (Array.isArray(ws.gates)) {
      for (const g of ws.gates) {
        if (typeof g === 'string' && g.trim() && !custom.includes(g)) {
          custom.push(g);
        }
      }
    }
  }
  return custom.length > 0 ? custom : [...fallbackGates];
}

/**
 * Resolves the build plan nodes for pipeline() execution.
 * When workstreamsFlag is false (default), returns the legacy build nodes
 * from effectiveNodes filtered by role: 'build' and needsMedia/skipNodes.
 * When workstreamsFlag is true and executionManifest is provided, returns
 * dynamic build nodes generated from manifest.workstreams.
 *
 * @param {object} params
 * @param {boolean} [params.workstreamsFlag=false]
 * @param {object|null} [params.executionManifest=null]
 * @param {object} params.effectiveNodes
 * @param {boolean} [params.needsMedia=false]
 * @param {Array<string>} [params.skipNodes=[]]
 * @param {object|null} [params.profile=null]
 * @param {object|null} [params.roleRegistry=null]
 * @returns {Array<object>}
 */
export function resolveBuildPlan({
  workstreamsFlag = false,
  executionManifest = null,
  effectiveNodes = {},
  needsMedia = false,
  skipNodes = [],
  profile = null,
  roleRegistry = null,
} = {}) {
  if (!workstreamsFlag || !executionManifest?.workstreams) {
    // 100% byte-identical legacy node resolution
    return Object.keys(effectiveNodes)
      .filter((id) => effectiveNodes[id]?.role === 'build')
      .filter((id) => (profile ? !skipNodes.includes(id) : (id !== 'media_eventtech' || needsMedia)))
      .map((id) => ({ id, ...effectiveNodes[id] }));
  }

  return buildNodesFromManifest(executionManifest, { roleRegistry });
}
