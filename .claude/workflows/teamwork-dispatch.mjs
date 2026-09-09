// Dispatcher for /teamwork-preview. Turns the 9-step prompt-crafting protocol
// from skills/basic/teamwork-preview/SKILL.md into an actual runnable sequence.
//
// Why a script and not prose: this repo has already paid for the alternative
// once, recorded verbatim in skills/basic/startcycle-graph/SKILL.md --
//
//   "an earlier version of this file embedded the full pipeline description in
//    prose, and the model followed it 'in spirit' inline instead of invoking the
//    script -- silently skipping the whole graph, with no state.json, no
//    subagents, no Reviewer, and no quality gate ever running."
//
// A 9-step protocol with acceptance criteria and integrity modes is exactly the
// kind of thing that gets followed approximately. A script either runs or it
// does not.
//
// Runtime constraints inherited from startcycle-dispatch.mjs, all four of which
// this script obeys:
//   1. No filesystem access from the script itself. Every read and write happens
//      inside an agent() call; the script branches on schema-validated returns.
//   2. No module loading. `agent`, `args` are ambient globals injected by the
//      runtime, not imports.
//   3. Concurrent agents writing one file race. This script is deliberately
//      sequential -- each step's answers reshape the next question, so there is
//      nothing to parallelise and no fragment/merge dance is needed.
//   4. Prompts are the interface. An agent that returns prose instead of the
//      declared schema breaks the branch, so every step declares one.
//
// This is NOT Antigravity's /teamwork-preview. That command is compiled into the
// agy binary (its own conductor/orchestrator/auditor agent types, maintained by
// Google). This is an independent implementation of the same idea, on a
// different runtime, and it will behave differently.

export const meta = {
  name: 'teamwork-dispatch',
  description:
    'Interactive 9-step prompt crafting for multi-agent delegation: elicit, disambiguate, set integrity mode, draft requirements, design verification, set acceptance criteria, then assemble and validate a spec. Produces prompt_draft.md; does not build anything.',
};

// The user's answers accumulate here. Each step gets the answers so far, so a
// later question can be shaped by an earlier one -- which is the whole point of
// an interview and the reason these run sequentially rather than in parallel.
const spec = {
  idea: null,
  scale: null,
  integrityMode: null,
  requirements: [],
  verification: null,
  acceptanceCriteria: [],
  infrastructure: null,
  workingDirectory: null,
};

// One shared preamble. Every step is an interview turn, not a build turn: the
// agent asks, the human answers, nothing gets implemented. Stated once here
// rather than restated nine times, where the ninth copy would drift.
const INTERVIEW_RULE =
  'You are conducting one step of an interactive interview. Ask the user, wait for their answer, and record it. ' +
  'Do NOT implement anything, do NOT write project code, and do NOT proceed past your own step. ' +
  'Finding facts is your job, not the user\'s: if a question can be answered by reading the filesystem or running a command, ' +
  'do that yourself instead of asking. The decisions are the user\'s: put each to them and wait. ' +
  'If the user has already answered something in an earlier step, do not ask it again -- the answers so far are given below.';

function answersSoFar() {
  const known = Object.entries(spec).filter(([, v]) =>
    Array.isArray(v) ? v.length > 0 : v !== null
  );
  if (known.length === 0) return 'Nothing settled yet -- this is the first step.';
  return `Answers settled so far:\n${JSON.stringify(Object.fromEntries(known), null, 2)}`;
}

async function step(n, title, instruction, schema, label) {
  return await agent(
    `${INTERVIEW_RULE}\n\n` +
      `## Step ${n} of 9: ${title}\n\n${instruction}\n\n` +
      `${answersSoFar()}\n\n` +
      'Return only the declared JSON.',
    { label: label || `step-${n}`, schema }
  );
}

const goal = typeof args === 'string' ? args : args?.goal;

// ---------------------------------------------------------------------
// Steps 1-3: what is this, how big, and what is it allowed to use
// ---------------------------------------------------------------------

const s1 = await step(
  1,
  'Elicit the idea',
  'Ask what the user wants to build, what its purpose is (production, demo, eval, or prototype), and who the audience is. ' +
    'Condense their answer into a description of one or two sentences -- not a paragraph, and not a restatement of the question.' +
    (goal ? `\n\nThe user already said: ${JSON.stringify(goal)}. Start from that; ask only what it leaves open.` : ''),
  {
    type: 'object',
    required: ['description', 'purpose'],
    properties: {
      description: { type: 'string' },
      purpose: { type: 'string', enum: ['production', 'demo', 'eval', 'prototype'] },
      audience: { type: 'string' },
    },
  }
);
spec.idea = s1;

const s2 = await step(
  2,
  'Identify ambiguity and scale',
  'Probe every point that has more than one reasonable interpretation -- data sources, third-party services, where the scope stops. ' +
    'Then establish the shape of the effort:\n' +
    '- a single self-contained fix or feature (one implementer plus repeated adversarial review)\n' +
    '- math, formal proofs, or a massive search space (may warrant a large agent team)\n' +
    '- a standard multi-agent build\n\n' +
    'Ambiguity you leave unresolved here becomes a wrong assumption baked into the spec, so be thorough now rather than agreeable.',
  {
    type: 'object',
    required: ['scale'],
    properties: {
      scale: { type: 'string', enum: ['single-focused', 'large-scale', 'standard'] },
      ambiguitiesResolved: { type: 'array', items: { type: 'string' } },
    },
  }
);
spec.scale = s2;

const s3 = await step(
  3,
  'Determine integrity mode',
  'Clarify the operational boundaries: may code be copied from existing open-source projects? Are pre-built libraries allowed for the core logic ' +
    '(as opposed to the scaffolding)? May the implementer inspect the tests before writing the code?\n\n' +
    'Map the answers: unrestricted → `development`; some shortcuts acceptable because it is a showcase → `demo`; ' +
    'strict isolation, zero external leakage → `benchmark`.\n\n' +
    'The last question matters more than it looks: an implementer who can read the tests first can satisfy them without solving the problem.',
  {
    type: 'object',
    required: ['integrityMode'],
    properties: {
      integrityMode: { type: 'string', enum: ['development', 'demo', 'benchmark'] },
      rationale: { type: 'string' },
    },
  }
);
spec.integrityMode = s3.integrityMode;

// ---------------------------------------------------------------------
// Steps 4-6: what must be true, and how anyone would know
// ---------------------------------------------------------------------

const s4 = await step(
  4,
  'Draft requirements',
  'Write two to five requirement blocks (R1, R2, ...). Each states **what** is required, never **how** to implement it.\n\n' +
    'Apply the litmus test to every one: would a senior engineer feel over-constrained by this? If yes, prune it. ' +
    'A requirement that dictates implementation removes the judgement you are hiring the implementer for.',
  {
    type: 'object',
    required: ['requirements'],
    properties: {
      requirements: {
        type: 'array',
        minItems: 2,
        maxItems: 5,
        items: {
          type: 'object',
          required: ['id', 'text'],
          properties: { id: { type: 'string' }, text: { type: 'string' } },
        },
      },
    },
  }
);
spec.requirements = s4.requirements;

const s5 = await step(
  5,
  'Design the verification mechanism',
  'This is the forcing function, and it is the step that decides whether the whole exercise works.\n\n' +
    'Its job is to create an objective target that forces a real build → test → debug loop and makes premature self-certification impossible. ' +
    'An agent that can declare its own work done, will.\n\n' +
    'Prefer something programmatic: a unit test suite, a test runner invocation, a CLI script that asserts. ' +
    'Only if that is genuinely infeasible, draft an explicit agent-as-judge rubric -- and say why programmatic was not possible. ' +
    'Ask whether the user has existing test suites, schemas, or a reference implementation to hand the implementer.',
  {
    type: 'object',
    required: ['mechanism', 'isProgrammatic'],
    properties: {
      mechanism: { type: 'string' },
      isProgrammatic: { type: 'boolean' },
      resources: { type: 'array', items: { type: 'string' } },
    },
  }
);
spec.verification = s5;

const s6 = await step(
  6,
  'Set acceptance criteria',
  'Convert the verification mechanism into checkable criteria -- each one a thing that is either true or false, never a judgement call.\n\n' +
    `Calibrate to the stated purpose (${spec.idea.purpose}): a demo must be achievable in a rapid time budget; ` +
    'production needs real coverage, error handling and readiness; an eval needs reproducible metrics far more than polish.\n\n' +
    'A criterion nobody can mechanically check is a wish, not a criterion.',
  {
    type: 'object',
    required: ['criteria'],
    properties: { criteria: { type: 'array', minItems: 1, items: { type: 'string' } } },
  }
);
spec.acceptanceCriteria = s6.criteria;

// ---------------------------------------------------------------------
// Steps 7-8: where it runs
// ---------------------------------------------------------------------

const s7 = await step(
  7,
  'Infrastructure constraints',
  'Only if the work reaches outside the local workspace: define the sandboxing or controlled APIs for remote file operations, ' +
    'job launching, and outbound network calls.\n\n' +
    'If the project stays entirely within local workspace files, say so and skip -- do not invent constraints to fill this step.',
  {
    type: 'object',
    required: ['applicable'],
    properties: { applicable: { type: 'boolean' }, constraints: { type: 'string' } },
  }
);
spec.infrastructure = s7.applicable ? s7.constraints : null;

const s8 = await step(
  8,
  'Choose the working directory',
  'Confirm where this runs. Default to a path inside the current repository if the work belongs to it, ' +
    `otherwise \`~/teamwork_projects/<project_name>\`. Check that the path exists or can be created, and say which.`,
  {
    type: 'object',
    required: ['workingDirectory'],
    properties: { workingDirectory: { type: 'string' }, exists: { type: 'boolean' } },
  }
);
spec.workingDirectory = s8.workingDirectory;

// ---------------------------------------------------------------------
// Step 9: assemble, validate, and stop for approval
// ---------------------------------------------------------------------

const s9 = await agent(
  'You are assembling the final specification from a completed 9-step interview. Do NOT implement any of it.\n\n' +
    `Write \`prompt_draft.md\` into ${JSON.stringify(spec.workingDirectory)} with this structure:\n\n` +
    '- the one-to-two sentence project description\n' +
    '- `Working directory: <path>`\n' +
    '- `Integrity mode: <mode>`\n' +
    '- a team-scaling directive, if the scale calls for one\n' +
    '- `## Requirements` — the R1..Rn blocks\n' +
    '- `## Verification` — the mechanism, and the resources it may use\n' +
    '- `## Acceptance Criteria` — as markdown checkboxes (`- [ ]`)\n' +
    (spec.infrastructure ? '- `## Infrastructure Constraints`\n' : '') +
    '\nThen validate it against three checks and report each honestly:\n' +
    '1. Does every acceptance criterion trace back to a stated requirement? An orphan criterion means the interview missed a requirement.\n' +
    '2. Is every criterion mechanically checkable — true or false, no judgement call?\n' +
    '3. Does any requirement dictate *how* rather than *what*?\n\n' +
    'Report failures rather than quietly fixing them: a validation step that edits its own input proves nothing.\n\n' +
    `The interview produced:\n${JSON.stringify(spec, null, 2)}`,
  {
    label: 'step-9-assemble',
    schema: {
      type: 'object',
      required: ['draftPath', 'validationsPassed'],
      properties: {
        draftPath: { type: 'string' },
        validationsPassed: { type: 'boolean' },
        issues: { type: 'array', items: { type: 'string' } },
      },
    },
  }
);

// Deliberately stops here. Delegation is a separate, human-approved act: the
// spec is the deliverable of this workflow, not a launch command. Handing an
// unapproved spec straight to a swarm is precisely the premature
// self-certification step 5 exists to prevent.
return {
  phase: s9.validationsPassed ? 'ready_for_approval' : 'validation_failed',
  draftPath: s9.draftPath,
  issues: s9.issues ?? [],
  integrityMode: spec.integrityMode,
  reason: s9.validationsPassed
    ? `Spec assembled at ${s9.draftPath}. Review it, then delegate to the execution harness of your choice — this workflow deliberately does not launch anything.`
    : `Spec assembled at ${s9.draftPath} but validation found issues; resolve them before delegating.`,
};
