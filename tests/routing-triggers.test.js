// WP-ROUTING: every routing-relevant SKILL.md description must carry its
// trigger words and stay inside the Agent Skills description limit (1024) and
// the validator's YAML rules (non-empty, category present, no leaked paths).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

const SKILL_DIR = {
  'plan-canvas': join(REPO, 'skills', 'global_config', 'plan-canvas'),
  'prototype': join(REPO, 'skills', 'global_config', 'prototype'),
  'bdbrainstorm': join(REPO, 'skills', 'bdbrainstorm'),
  'grill-me': join(REPO, 'skills', 'global_config', 'grill-me'),
  'startcycle': join(REPO, 'skills', 'basic', 'startcycle'),
  'startcycle-graph': join(REPO, 'skills', 'basic', 'startcycle-graph'),
  'startcycle-graph-user': join(REPO, 'skills', 'basic', 'startcycle-graph-user'),
  'agenttrail': join(REPO, 'skills', 'global_config', 'agenttrail'),
  'subagent-driven-development': join(REPO, 'skills', 'global_config', 'subagent-driven-development'),
  'dispatching-parallel-agents': join(REPO, 'skills', 'global_config', 'dispatching-parallel-agents'),
};

// Simple frontmatter parse: only the scalars we need. A folded (>-) block
// scalar runs to the first line with less indentation.
function readDescription(skillDir) {
  const text = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
  const lines = text.split(/\r?\n/);
  assert.equal(lines[0].trim(), '---', `${skillDir}: frontmatter missing`);
  let desc = null;
  let category = null;
  for (let i = 1; lines[i].trim() !== '---'; i++) {
    const m = /^description:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (m[1] === '>-') {
      const block = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === '' || /^\s/.test(lines[j])) block.push(lines[j].trim());
        else break;
      }
      desc = block.join(' ');
    } else {
      desc = m[1].replace(/^["']|["']$/g, '');
    }
  }
  for (let i = 1; lines[i].trim() !== '---'; i++) {
    const c = /^category:\s*(\S+)\s*$/.exec(lines[i]);
    if (c) category = c[1];
  }
  return { desc, category };
}

const TRIGGERS = {
  'plan-canvas': ['planning', 'plan', 'roadmap', '/plan-canvas', 'visualize the plan', 'brainstorm'],
  'prototype': ['/prototype', 'prototype', 'UI', 'plan-canvas', 'brainstorm'],
  'bdbrainstorm': ['brainstorm', '/grill-me', 'godmode-engineering', 'plan-canvas', '/startcycle-graph'],
  'grill-me': ['grill', 'interview', 'stress-test', 'plan'],
  'startcycle': ['/startcycle', 'production_artifacts/', '/bdbrainstorm', '/grill-me', 'startcycle-graph'],
  'startcycle-graph': ['/startcycle-graph', 'production_artifacts/state.json', '.agents/graph.md', 'bdbrainstorm'],
  'startcycle-graph-user': ['fan-out', 'parallel workers', '/startcycle-graph', 'throwaway'],
  'agenttrail': ['agenttrail', 'multi-agent', 'live map', 'plan-canvas', '/startcycle'],
  'subagent-driven-development': ['implementation plans', 'independent tasks', 'subagent', 'spec compliance'],
  'dispatching-parallel-agents': ['parallel', 'independent', 'shared state'],
};

const DESC_LIMIT = 1024;

for (const [name, dir] of Object.entries(SKILL_DIR)) {
  const { desc, category } = readDescription(dir);

  assert.ok(desc && desc.trim().length > 0, `${name}: description must be non-empty`);
  assert.ok(typeof category === 'string' && category.length > 0, `${name}: category must be present on its own line`);

  // Agent Skills spec limits the description; scripts/validate-skills.mjs
  // enforces name (64) but not this limit, so here.
  assert.ok(desc.length <= DESC_LIMIT, `${name}: description is ${desc.length} chars, limit ${DESC_LIMIT}`);

  for (const t of TRIGGERS[name]) {
    assert.ok(desc.toLowerCase().includes(t.toLowerCase()), `${name}: description must contain trigger "${t}" — got: ${desc}`);
  }

  assert.ok(!/\/Users\/|\/home\/[a-z]/i.test(desc), `${name}: description must not leak a machine path`);
  assert.ok(!desc.includes('Claude Sonnet') && !desc.includes('GPT') && !desc.includes('Gemini 3'),
    `${name}: description must not name a specific model`);
}

// The validator still runs on everything; this file only pins what it cannot
// see (trigger words).

console.log('✓ routing-triggers.test.js passed');
