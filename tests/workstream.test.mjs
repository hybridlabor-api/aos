import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKSTREAM_CAP,
  TARGET_WORKSTREAMS,
  WORKSTREAM_ID_REGEX,
  extractWorkstreamsFlag,
  canonicalNodeId,
  canonicalAgentType,
  validateExecutionManifest,
  buildNodesFromManifest,
  deriveWorkstreamGates,
  resolveBuildPlan,
} from '../lib/roles/workstream.mjs';

test('extractWorkstreamsFlag extracts --workstreams and preserves goal', () => {
  assert.deepEqual(extractWorkstreamsFlag('build a desktop app'), {
    workstreams: false,
    goal: 'build a desktop app',
  });

  assert.deepEqual(extractWorkstreamsFlag('--workstreams build a desktop app'), {
    workstreams: true,
    goal: 'build a desktop app',
  });

  assert.deepEqual(extractWorkstreamsFlag('build a desktop app --workstreams'), {
    workstreams: true,
    goal: 'build a desktop app',
  });

  assert.deepEqual(extractWorkstreamsFlag('--workstreams'), {
    workstreams: true,
    goal: '',
  });

  assert.deepEqual(extractWorkstreamsFlag(null), {
    workstreams: false,
    goal: null,
  });
});

test('canonicalNodeId and canonicalAgentType map aliases correctly', () => {
  assert.equal(canonicalNodeId('godmode-engineering'), 'engineering');
  assert.equal(canonicalNodeId('engineering'), 'engineering');
  assert.equal(canonicalNodeId('godmode-ui-ux'), 'ui_ux');
  assert.equal(canonicalNodeId('ui_ux'), 'ui_ux');

  assert.equal(canonicalAgentType('engineering'), 'godmode-engineering');
  assert.equal(canonicalAgentType('godmode-engineering'), 'godmode-engineering');
  assert.equal(canonicalAgentType('ui_ux'), 'godmode-ui-ux');
  assert.equal(canonicalAgentType('custom_worker'), 'custom_worker');
});

test('validateExecutionManifest validates manifest structure, createdBy, and effort', () => {
  const bad1 = validateExecutionManifest(null);
  assert.equal(bad1.valid, false);

  const bad2 = validateExecutionManifest({ createdBy: 'user', workstreams: [] });
  assert.equal(bad2.valid, false);
  assert.ok(bad2.errors.some((e) => e.code === 'ERR_INVALID_CREATED_BY'));

  const bad3 = validateExecutionManifest({ createdBy: 'architect', effort: 'INVALID', workstreams: [] });
  assert.equal(bad3.valid, false);
  assert.ok(bad3.errors.some((e) => e.code === 'ERR_INVALID_EFFORT'));
});

test('validateExecutionManifest enforces min 1 and max 6 workstreams cap', () => {
  const empty = validateExecutionManifest({
    createdBy: 'architect',
    workstreams: [],
  });
  assert.equal(empty.valid, false);
  assert.ok(empty.errors.some((e) => e.code === 'ERR_EMPTY_WORKSTREAMS'));

  const sevenStreams = Array.from({ length: 7 }, (_, i) => ({
    id: `ws_${i}`,
    agentType: 'godmode-engineering',
    skills: ['godmode-engineering'],
    artifactKey: `spec_${i}`,
  }));
  const overCap = validateExecutionManifest({
    createdBy: 'architect',
    workstreams: sevenStreams,
  });
  assert.equal(overCap.valid, false);
  assert.ok(overCap.errors.some((e) => e.code === 'ERR_WORKSTREAM_CAP_EXCEEDED'));

  const sixStreams = Array.from({ length: 6 }, (_, i) => ({
    id: `ws_${i}`,
    agentType: 'godmode-engineering',
    skills: ['godmode-engineering'],
    artifactKey: `spec_${i}`,
  }));
  const atCap = validateExecutionManifest({
    createdBy: 'architect',
    workstreams: sixStreams,
  });
  assert.equal(atCap.valid, true);
});

test('validateExecutionManifest enforces regex ^[a-z0-9_]+$ and detects duplicates', () => {
  const invalidId = validateExecutionManifest({
    createdBy: 'architect',
    workstreams: [
      { id: 'WS-Invalid-Id!', agentType: 'godmode-ui-ux', skills: ['godmode-ui-ux'], artifactKey: 'frontend' },
    ],
  });
  assert.equal(invalidId.valid, false);
  assert.ok(invalidId.errors.some((e) => e.code === 'ERR_INVALID_STREAM_ID'));

  const duplicate = validateExecutionManifest({
    createdBy: 'architect',
    workstreams: [
      { id: 'ws_core', agentType: 'godmode-engineering', skills: ['godmode-engineering'], artifactKey: 'backend' },
      { id: 'ws_core', agentType: 'godmode-ui-ux', skills: ['godmode-ui-ux'], artifactKey: 'frontend' },
    ],
  });
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.errors.some((e) => e.code === 'ERR_DUPLICATE_STREAM_ID'));
});

test('validateExecutionManifest checks skill and playbook existence via options', () => {
  const availableSkills = new Set(['godmode-engineering', 'godmode-ui-ux', 'webapp-testing']);
  const availablePlaybooks = new Set(['pb-tauri-e2e', 'pb-ship']);

  const validManifest = {
    createdBy: 'architect',
    effort: 'M',
    workstreams: [
      {
        id: 'ws_core',
        agentType: 'godmode-engineering',
        skills: ['godmode-engineering', 'webapp-testing'],
        playbooks: ['pb-tauri-e2e'],
        artifactKey: 'backend',
        gates: ['tests', 'typecheck'],
      },
      {
        id: 'ws_ui',
        agentType: 'godmode-ui-ux',
        skills: ['godmode-ui-ux'],
        playbooks: [{ id: 'pb-ship', phase: 'after' }],
        artifactKey: 'frontend',
        gates: ['lint', 'a11y'],
      },
    ],
  };

  const okResult = validateExecutionManifest(validManifest, { availableSkills, availablePlaybooks });
  assert.equal(okResult.valid, true);
  assert.equal(okResult.errors.length, 0);

  // Nonexistent skill
  const badSkill = validateExecutionManifest({
    createdBy: 'architect',
    workstreams: [
      { id: 'ws_core', agentType: 'godmode-engineering', skills: ['nonexistent-skill-xyz'], artifactKey: 'backend' },
    ],
  }, { availableSkills, availablePlaybooks });
  assert.equal(badSkill.valid, false);
  assert.ok(badSkill.errors.some((e) => e.code === 'ERR_UNRESOLVED_SKILL'));

  // Nonexistent playbook
  const badPlaybook = validateExecutionManifest({
    createdBy: 'architect',
    workstreams: [
      {
        id: 'ws_core',
        agentType: 'godmode-engineering',
        skills: ['godmode-engineering'],
        playbooks: ['nonexistent-playbook-123'],
        artifactKey: 'backend',
      },
    ],
  }, { availableSkills, availablePlaybooks });
  assert.equal(badPlaybook.valid, false);
  assert.ok(badPlaybook.errors.some((e) => e.code === 'ERR_UNRESOLVED_PLAYBOOK'));
});

test('buildNodesFromManifest produces pipeline build nodes with state.d writes paths', () => {
  const manifest = {
    createdBy: 'architect',
    workstreams: [
      {
        id: 'ws_backend',
        label: 'Backend Worker',
        agentType: 'godmode-engineering',
        skills: ['godmode-engineering'],
        playbooks: ['pb-tauri-e2e'],
        artifactKey: 'backend',
        gates: ['tests'],
      },
      {
        id: 'ws_frontend',
        agentType: 'godmode-ui-ux',
        skills: ['godmode-ui-ux'],
        artifactKey: 'frontend',
      },
    ],
  };

  const nodes = buildNodesFromManifest(manifest);
  assert.equal(nodes.length, 2);

  assert.equal(nodes[0].id, 'ws_backend');
  assert.equal(nodes[0].label, 'Backend Worker');
  assert.equal(nodes[0].agentType, 'godmode-engineering');
  assert.equal(nodes[0].role, 'build');
  assert.equal(nodes[0].writes, 'production_artifacts/state.d/ws_backend.json');
  assert.deepEqual(nodes[0].gates, ['tests']);

  assert.equal(nodes[1].id, 'ws_frontend');
  assert.equal(nodes[1].writes, 'production_artifacts/state.d/ws_frontend.json');
  assert.equal(nodes[1].role, 'build');
});

test('deriveWorkstreamGates merges custom gates or falls back to standard', () => {
  const streamsWithGates = [
    { id: 'ws_1', gates: ['ipc_latency', 'tests'] },
    { id: 'ws_2', gates: ['binary_security', 'tests'] },
  ];
  assert.deepEqual(deriveWorkstreamGates(streamsWithGates), ['ipc_latency', 'tests', 'binary_security']);

  const streamsWithoutGates = [
    { id: 'ws_1' },
    { id: 'ws_2', gates: [] },
  ];
  assert.deepEqual(deriveWorkstreamGates(streamsWithoutGates), ['lint', 'typecheck', 'tests', 'a11y', 'seo', 'security']);
});

test('resolveBuildPlan preserves 100% byte-identical legacy node resolution when workstreamsFlag is false', () => {
  const effectiveNodes = {
    architect: { label: 'Architect', role: 'plan', agentType: 'architect' },
    techlead: { label: 'TechLead', role: 'approve', agentType: 'techlead' },
    ui_ux: {
      label: 'UI/UX',
      agentType: 'godmode-ui-ux',
      personaFile: '.claude/agents/godmode-ui-ux.md',
      role: 'build',
      artifactKey: 'frontend',
      writes: 'production_artifacts/state.d/ui_ux.json',
      skills: ['godmode-ui-ux'],
    },
    engineering: {
      label: 'Engineering',
      agentType: 'godmode-engineering',
      personaFile: '.claude/agents/godmode-engineering.md',
      role: 'build',
      artifactKey: 'backend',
      writes: 'production_artifacts/state.d/engineering.json',
      skills: ['godmode-engineering'],
    },
    media_eventtech: {
      label: 'Media EventTech',
      agentType: 'godmode-media-eventtech',
      personaFile: '.claude/agents/godmode-media-eventtech.md',
      role: 'build',
      artifactKey: 'media',
      writes: 'production_artifacts/state.d/media_eventtech.json',
      skills: ['godmode-eventtech'],
    },
    reviewer: { label: 'Reviewer', role: 'review', agentType: 'reviewer' },
    shipping: { label: 'Shipping', role: 'gate', agentType: 'godmode-shipping' },
  };

  // Case 1: needsMedia = false
  const legacyNoMedia = Object.keys(effectiveNodes)
    .filter((id) => effectiveNodes[id]?.role === 'build')
    .filter((id) => id !== 'media_eventtech')
    .map((id) => ({ id, ...effectiveNodes[id] }));

  const planNoMediaWithoutFlag = resolveBuildPlan({
    workstreamsFlag: false,
    effectiveNodes,
    needsMedia: false,
  });

  assert.deepEqual(planNoMediaWithoutFlag, legacyNoMedia);
  assert.equal(JSON.stringify(planNoMediaWithoutFlag), JSON.stringify(legacyNoMedia));

  // Case 2: needsMedia = true
  const legacyWithMedia = Object.keys(effectiveNodes)
    .filter((id) => effectiveNodes[id]?.role === 'build')
    .map((id) => ({ id, ...effectiveNodes[id] }));

  const planWithMediaWithoutFlag = resolveBuildPlan({
    workstreamsFlag: false,
    effectiveNodes,
    needsMedia: true,
  });

  assert.deepEqual(planWithMediaWithoutFlag, legacyWithMedia);
  assert.equal(JSON.stringify(planWithMediaWithoutFlag), JSON.stringify(legacyWithMedia));

  // Case 3: When workstreamsFlag is true with manifest, dynamic nodes are returned
  const manifest = {
    createdBy: 'architect',
    workstreams: [
      { id: 'ws_core', agentType: 'godmode-engineering', skills: ['godmode-engineering'], artifactKey: 'backend' },
      { id: 'ws_ui', agentType: 'godmode-ui-ux', skills: ['godmode-ui-ux'], artifactKey: 'frontend' },
    ],
  };

  const planWithFlag = resolveBuildPlan({
    workstreamsFlag: true,
    executionManifest: manifest,
    effectiveNodes,
    needsMedia: false,
  });

  assert.equal(planWithFlag.length, 2);
  assert.equal(planWithFlag[0].id, 'ws_core');
  assert.equal(planWithFlag[0].writes, 'production_artifacts/state.d/ws_core.json');
  assert.equal(planWithFlag[1].id, 'ws_ui');
  assert.equal(planWithFlag[1].writes, 'production_artifacts/state.d/ws_ui.json');
});

test('validateExecutionManifest validates ad-hoc and registered roles', () => {
  const roleRegistry = {
    has(id) {
      return ['tauri_expert', 'ui_ux', 'engineering', 'godmode-engineering'].includes(id);
    },
    get(id) {
      if (id === 'tauri_expert') {
        return { id: 'tauri_expert', skills: ['webapp-testing'] };
      }
      return null;
    },
    availableSkills: new Set(['godmode-engineering', 'webapp-testing', 'custom-skill-1']),
    availablePlaybooks: new Set(['pb-tauri-e2e']),
  };

  // Known role
  const resKnown = validateExecutionManifest({
    createdBy: 'architect',
    workstreams: [
      { id: 'ws_tauri', agentType: 'tauri_expert', skills: ['webapp-testing'], artifactKey: 'desktop' },
    ],
  }, { roleRegistry });
  assert.equal(resKnown.valid, true);

  // Ad-hoc role with valid skills
  const resAdHoc = validateExecutionManifest({
    createdBy: 'architect',
    workstreams: [
      { id: 'ws_adhoc', agentType: 'specialist_agent', skills: ['custom-skill-1'], artifactKey: 'special' },
    ],
  }, { roleRegistry });
  assert.equal(resAdHoc.valid, true);

  // Ad-hoc role with nonexistent skills
  const resBadAdHoc = validateExecutionManifest({
    createdBy: 'architect',
    workstreams: [
      { id: 'ws_adhoc', agentType: 'specialist_agent', skills: ['nonexistent-skill'], artifactKey: 'special' },
    ],
  }, { roleRegistry });
  assert.equal(resBadAdHoc.valid, false);
  assert.ok(resBadAdHoc.errors.some((e) => e.code === 'ERR_UNRESOLVED_SKILL'));

  // Empty skills array
  const resEmptySkills = validateExecutionManifest({
    createdBy: 'architect',
    workstreams: [
      { id: 'ws_adhoc', agentType: 'specialist_agent', skills: [], artifactKey: 'special' },
    ],
  }, { roleRegistry });
  assert.equal(resEmptySkills.valid, false);
  assert.ok(resEmptySkills.errors.some((e) => e.code === 'ERR_EMPTY_SKILLS'));
});

