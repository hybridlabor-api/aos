// Dispatcher for /startcycle. Implements the node/edge table in
// .agents/graph.md as an actual runnable loop, using Claude Code's Dynamic
// Workflows runtime (this script IS the dispatcher F-17 requires: it holds
// the loop and the branching decisions; the seven agents below are leaves
// that never invoke each other or this script).
//
// Four things this runtime doesn't give a workflow script, and how we work
// around them:
//
// 1. No direct filesystem access from the script itself ("Agents read,
//    write, and run commands. The script coordinates the agents" --
//    code.claude.com/docs/en/workflows). So this script can't read/write
//    production_artifacts/state.json directly. Every agent() call below is
//    told to read/write that file itself (agents do have file tools) AND to
//    return the same information as structured `schema`-validated JSON --
//    that structured return is what this script branches on. state.json
//    stays the durable, harness-neutral record per .agents/state.schema.json
//    (any harness, or graph-gate.mjs's Stop hook, can still inspect it
//    between runs); the schema return is this run's own control-flow signal,
//    since the script has no other way to see what happened.
//
// 2. No module loading (`import()` fails before the run starts) -- `agent`
//    and `pipeline` are ambient globals the runtime injects, not imports.
//    `args` is likewise an ambient global carrying whatever was passed to
//    `/startcycle`, not a function parameter.
//
// 3. pipeline() fans out one agent() call per build node, genuinely
//    concurrently, and every one of those was previously told to
//    read-modify-write the SAME production_artifacts/state.json -- last
//    writer wins, so concurrent findings/artifact updates were silently
//    lost. There is no lock available (the runtime gives the script no
//    filesystem access, so it can't hold one itself). Fixed by single-
//    writer-per-file: each build node in a pipeline() fan-out writes ONLY
//    its own production_artifacts/state.d/<nodeId>.json fragment (see
//    .agents/state.schema.json's $defs.stateFragment) and never touches
//    state.json. Immediately after each pipeline() call returns -- the
//    barrier where every parallel node has finished -- mergeStateD() below
//    invokes one dedicated haiku agent that folds every state.d/*.json
//    fragment into state.json, deterministically, before the run continues.
//    This still happens inside the workflow run, never deferred, because
//    graph-gate.mjs reads state.json at turn end. Sequential nodes
//    (architect, techlead, reviewer, shipping) are never inside a
//    pipeline() fan-out, so they are not part of this race and keep
//    writing state.json directly, same as before.
//
// 4. The seven node identities (persona file, model, which skills each may
//    reach for, build-node instructions) used to be hardcoded in this
//    script. They now live in .agents/nodes.json (owned by a different
//    agent than this file) so that registry can grow without touching this
//    dispatcher. Since this script has no filesystem access (see #1), it
//    can't read that file itself either -- so the very first thing this run
//    does is spawn a small haiku `load-registry` agent whose only job is to
//    read .agents/nodes.json and return it, schema-validated. Everything
//    downstream (BUILD_NODES, NODE_ENUM, NODE_NAMES, every agentType/model
//    passed to agent(), every skills allowlist, every build-node
//    instruction string) is derived from that returned object, not
//    hardcoded. If the registry fails to load or comes back with fewer
//    than the seven required node ids, this run escalates immediately --
//    it never silently falls back to a hardcoded list.
//
// max_iterations mirrors .agents/state.schema.json's default (3) --
// deliberately under Claude Code's own 8-consecutive-Stop-hook-block
// override, so this workflow's own escalation return reaches the user
// before that platform ceiling would silently end a turn instead.

export const meta = {
  name: 'startcycle-dispatch',
  description:
    'Dispatcher-mediated build pipeline: Architect -> TechLead -> {UI_UX, Engineering, Media_EventTech} -> Reviewer -> Shipping, per .agents/graph.md. Agents never invoke each other -- this script decides every next step. Node identities come from .agents/nodes.json, loaded fresh each run.',
};

const MAX_ITERATIONS = 3;

// One shared counter, matching .agents/state.schema.json's single `iteration`
// field ("Incremented by the dispatcher every time an edge sends the run back
// to a build node -- TechLead rejection, Reviewer findings, or a failed
// gate"). An earlier draft used three independent counters (one per loop),
// which let a single run take up to 9 repair rounds total before any ceiling
// applied, and never matched what got persisted to state.json anyway --
// caught by an adversarial review against this same file, not assumed
// correct on the first draft.
let iteration = 0;

// Every sequential (non-build-role) agent gets the same note: read the full
// state, and explicitly set state.iteration to the dispatcher's current
// count so the persisted file (which .claude/hooks/graph-gate.mjs reads)
// actually reflects reality -- nothing else in this script has filesystem
// access to write it directly.
//
// Build-role nodes get a different note: they are invoked inside a
// pipeline() fan-out alongside other build nodes writing at the same time,
// so they must NOT write state.json themselves (see comment block item #3
// above) -- they write only their own production_artifacts/state.d/<id>.json
// fragment, which the dedicated merge step folds in afterwards.
function dispatchNote(node) {
  if (node?.role === 'build') {
    const writes = node.writes || `production_artifacts/state.d/${node.id}.json`;
    return (
      'Read production_artifacts/state.json if it exists (read-only -- for context such as state.goal and ' +
      'state.artifacts.plan). Do NOT write production_artifacts/state.json yourself -- other build nodes may be ' +
      `writing concurrently in this same pass, and a shared write would race and silently lose updates. Instead ` +
      `write ONLY ${writes} (create production_artifacts/state.d/ if missing), containing just the fields you ` +
      `own: { "node": "${node.id}", "artifacts": { "${node.artifactKey || node.id}": <path to the artifact you ` +
      `produced> }, "findings": [ <status updates for any open findings you addressed, same shape as the ` +
      `top-level findings[] items> ] } per .agents/state.schema.json's $defs.stateFragment. Omit state.iteration, ` +
      'state.goal, and every field you do not own -- the dispatcher runs a dedicated merge step that folds your ' +
      'fragment into state.json afterwards; do not attempt that merge yourself.'
    );
  }
  return (
    'Read production_artifacts/state.json if it exists; otherwise this is a fresh run. ' +
    `Set state.iteration to ${iteration} in your update (this is the dispatcher's authoritative count -- ` +
    'do not increment it yourself). Update the rest of state.json per .agents/state.schema.json ' +
    '(create production_artifacts/ if missing).'
  );
}

// Reviewer gets a deliberately different note. .agents/graph.md's Reviewer
// discipline requires ARTIFACT + CONTRACT only, never `goal`, never a build
// node's reasoning -- state.json's `goal` field is required by the schema
// and is exactly the user's original request, so telling Reviewer to read
// the whole file (as dispatchNote() does for every other agent) hands it the
// one thing the discipline says it must never see. This was caught the same
// way as the iteration-counter bug: an adversarial review against
// .agents/graph.md's own text, not assumed safe because "it's just a
// generic state-sync note." Reviewer is a sequential (review-role) node --
// never inside a pipeline() fan-out -- so writing state.json directly here
// is not part of the CHANGE 1 race and this function is left untouched by
// that fix.
function reviewerStateNote() {
  return (
    'Do NOT read state.goal or any other node\'s reasoning/claims from production_artifacts/state.json -- ' +
    'your review must be based only on the plan/contract and artifact files named below, nothing else. ' +
    'You may open production_artifacts/state.json purely to merge your update into it without clobbering ' +
    'unrelated fields (or create it fresh per .agents/state.schema.json if missing), but that file access is ' +
    `for the write, not for forming your judgment. Set state.iteration to ${iteration} in your update.`
  );
}

// Injects each node's registry-declared skills as an explicit allowlist.
// Applies to every node, build and sequential alike.
function skillsNote(node) {
  const skills = Array.isArray(node?.skills) ? node.skills : [];
  if (skills.length === 0) return '';
  return (
    ` Use these skills for this work: ${skills.join(', ')}. ` +
    'Do not reach for skills outside this list unless the task genuinely requires it.'
  );
}

// "a", "a or b", "a, b, or c" -- used for NODE_NAMES, itself derived from the
// registry rather than hardcoded (see load-registry below).
function humanList(items) {
  const quoted = items.map((s) => `"${s}"`);
  if (quoted.length === 0) return '';
  if (quoted.length === 1) return quoted[0];
  if (quoted.length === 2) return quoted.join(' or ');
  return `${quoted.slice(0, -1).join(', ')}, or ${quoted[quoted.length - 1]}`;
}

// Centralizes every escalation path through one place, so `needs_human` and
// `phase: escalated` actually land in state.json instead of only in this
// script's return value (found the same way: grep for "needs_human" in an
// earlier draft returned zero matches across 8 separate `return { phase:
// 'escalated', ... }` sites -- the field was silently dropped end to end
// every single time, since none of those `return`s routed through an
// agent() call that could persist it). Escalation is inherently a single,
// sequential call (never inside a pipeline() fan-out), so it writes
// state.json directly like the other sequential nodes.
async function escalate(reason, extra = {}) {
  await agent(
    'You are recording a /startcycle escalation. Update production_artifacts/state.json per ' +
      '.agents/state.schema.json: set phase to "escalated", needs_human to true, iteration to ' +
      `${iteration}, and append this reason to the record: ${JSON.stringify(reason)}. ` +
      'Create production_artifacts/ if missing.',
    { label: 'escalate' }
  );
  return { phase: 'escalated', reason, iteration, ...extra };
}

// The single-writer-per-file fix from comment block item #3. Called once,
// immediately after every pipeline() call returns (the barrier where all
// parallel build nodes have finished this pass) -- never deferred, since
// .claude/hooks/graph-gate.mjs reads production_artifacts/state.json at turn
// end and needs the merged result to already be there. Deterministic fold
// only: model 'haiku', explicitly told not to invent, reinterpret, or drop
// any field.
async function mergeStateD() {
  return await agent(
    'You are the dedicated /startcycle state-merge step -- a deterministic fold, not a reasoning task. ' +
      'Read every file matching production_artifacts/state.d/*.json (if that directory does not exist or is ' +
      'empty, there is nothing to merge -- just confirm production_artifacts/state.json still exists and is ' +
      'valid per .agents/state.schema.json, and return merged: 0). Read the current ' +
      'production_artifacts/state.json. For each fragment file, per .agents/state.schema.json\'s ' +
      '$defs.stateFragment shape: merge fragment.artifacts into state.artifacts by key -- only the key(s) ' +
      'present in that specific fragment change, every other artifacts key is left exactly as it was; merge ' +
      'fragment.findings into state.findings by matching "id" -- an existing finding with that id gets its ' +
      'fields (status, etc.) updated in place, a finding id not already present is appended, and findings not ' +
      'mentioned in any fragment are left completely untouched. ' +
      `Set state.iteration to ${iteration}. Do not change state.goal, state.phase, state.gate, state.approvals, ` +
      'state.run_id, or state.needs_human -- this step folds state.d fragments into state.json and nothing ' +
      'else. Do NOT invent, guess, reinterpret, or silently drop any field: if a fragment is malformed or is ' +
      'missing its required "node" field, skip that exact file and report it in "skipped" with a short reason, ' +
      'rather than guessing its intent. Write the merged result back to production_artifacts/state.json, then ' +
      'delete the production_artifacts/state.d/*.json files you just merged so a stale fragment is never ' +
      're-read on the next pass.\n\n' +
      'Return only: { "merged": number, "skipped": string[] } -- merged is how many fragment files were folded ' +
      'in; skipped lists any fragment filenames that could not be merged, each with a short reason.',
    {
      label: `merge-${iteration}`,
      model: 'haiku',
      schema: {
        type: 'object',
        required: ['merged', 'skipped'],
        properties: {
          merged: { type: 'number' },
          skipped: { type: 'array', items: { type: 'string' } },
        },
      },
    }
  );
}

// ---------------------------------------------------------------------
// Load the node registry. First thing this run does, per comment block
// item #4 -- everything below is derived from this, nothing is hardcoded.
// ---------------------------------------------------------------------

const REGISTRY_SCHEMA = {
  type: 'object',
  required: ['version', 'nodes'],
  properties: {
    version: { type: 'number' },
    description: { type: 'string' },
    nodes: {
      type: 'object',
      minProperties: 1,
      additionalProperties: {
        type: 'object',
        required: ['label', 'agentType', 'personaFile', 'model', 'role'],
        properties: {
          label: { type: 'string' },
          agentType: { type: 'string' },
          personaFile: { type: 'string' },
          model: { type: 'string' },
          role: { type: 'string', enum: ['plan', 'approve', 'build', 'review', 'gate'] },
          // artifactKey/writes/instructions are null on nodes where they don't apply (e.g. techlead
          // has no artifactKey, architect/techlead/reviewer/shipping have writes: null and
          // instructions: null since they are sequential nodes with hardcoded prompt text below,
          // not build nodes reading a registry instruction string) -- must accept null, not just string.
          artifactKey: { type: ['string', 'null'] },
          writes: { type: ['string', 'null'] },
          optional: { type: 'boolean' },
          skills: { type: 'array', items: { type: 'string' } },
          instructions: { type: ['string', 'null'] },
        },
      },
    },
  },
};

const REQUIRED_NODE_IDS = ['architect', 'techlead', 'ui_ux', 'engineering', 'media_eventtech', 'reviewer', 'shipping'];

const registryResult = await agent(
  'Read the file .agents/nodes.json (repository root) and return its exact contents, parsed as JSON, matching ' +
    'the given schema. This is a read-only lookup, not a reasoning task: do not invent, modify, reinterpret, ' +
    'merge, or add any field that is not literally present in the file. If the file is missing, unreadable, or ' +
    'not valid JSON, return { "version": 0, "nodes": {} } rather than guessing at its contents.',
  { label: 'load-registry', model: 'haiku', schema: REGISTRY_SCHEMA }
);

const registryNodes = registryResult?.nodes ?? {};
const missingNodeIds = REQUIRED_NODE_IDS.filter((id) => !registryNodes[id]);
if (missingNodeIds.length > 0) {
  return await escalate(
    `.agents/nodes.json failed to load, or is missing required node id(s): ${missingNodeIds.join(', ')}. ` +
      'Refusing to fall back to a hardcoded node list -- fix the registry and re-run /startcycle.'
  );
}

const architectNode = { id: 'architect', ...registryNodes.architect };
const techleadNode = { id: 'techlead', ...registryNodes.techlead };
const reviewerNode = { id: 'reviewer', ...registryNodes.reviewer };
const shippingNode = { id: 'shipping', ...registryNodes.shipping };

const goal = typeof args === 'string' ? args : args?.goal;
if (!goal) {
  return escalate(
    'startcycle needs a goal, e.g. "Run /startcycle on: add OAuth login with Google" -- nothing was invoked.'
  );
}

// ---------------------------------------------------------------------
// Architect <-> TechLead: plan, then capability-map approval. Sequential --
// not part of the CHANGE 1 race, writes state.json directly as before.
// ---------------------------------------------------------------------

let planPath = null;
let needsMedia = false;
let approved = false;
let lastRejectionReason = '';

while (!approved) {
  const architectResult = await agent(
    `You are acting as the ${architectNode.label} agent (${architectNode.personaFile}). ${dispatchNote(architectNode)}${skillsNote(architectNode)}\n\n` +
      `Goal: ${JSON.stringify(goal)}\n` +
      (lastRejectionReason
        ? `TechLead rejected your previous plan for this reason -- address it: ${lastRejectionReason}\n`
        : '') +
      `Turn this goal into a system plan with an explicit capability map (module boundaries, ` +
      `dependency direction, build order). Write it to production_artifacts/00_execution_plan.md. ` +
      `Set state.goal, state.phase = "plan", state.artifacts.plan to that path. ` +
      `Decide whether the goal needs the Media_EventTech build node (TouchDesigner/show-control/3D/media work) -- most goals don't.\n\n` +
      `Return only: { "planPath": string, "needsMedia": boolean }.`,
    {
      label: `architect-${iteration}`,
      agentType: architectNode.agentType,
      model: architectNode.model,
      schema: {
        type: 'object',
        required: ['planPath', 'needsMedia'],
        properties: { planPath: { type: 'string' }, needsMedia: { type: 'boolean' } },
      },
    }
  );

  planPath = architectResult?.planPath;
  needsMedia = !!architectResult?.needsMedia;

  if (!planPath) {
    return await escalate('Architect did not return a plan path.');
  }

  const techLeadResult = await agent(
    `You are acting as the ${techleadNode.label} agent (${techleadNode.personaFile}). ${dispatchNote(techleadNode)}${skillsNote(techleadNode)}\n\n` +
      `Read the plan at ${planPath}. Approve it only if it has an explicit capability map: ` +
      `module boundaries, dependency direction, and build order are all stated, not implicit. ` +
      `Record your decision in state.json (plan approval, state.phase = "build" if approved).\n\n` +
      `Return only: { "approved": boolean, "reason": string }.`,
    {
      label: `techlead-${iteration}`,
      agentType: techleadNode.agentType,
      model: techleadNode.model,
      schema: {
        type: 'object',
        required: ['approved', 'reason'],
        properties: { approved: { type: 'boolean' }, reason: { type: 'string' } },
      },
    }
  );

  approved = !!techLeadResult?.approved;
  lastRejectionReason = techLeadResult?.reason ?? '';

  if (!approved) {
    iteration++;
    if (iteration >= MAX_ITERATIONS) {
      return await escalate(
        `TechLead never approved the plan within ${MAX_ITERATIONS} iterations. Last reason: ${lastRejectionReason}`,
        { planPath }
      );
    }
  }
}

// ---------------------------------------------------------------------
// Build nodes (parallel, dispatcher-invoked independently -- pipeline()
// fans out one agent() per node; none of them call each other) <-> Reviewer
// repair loop. On the first pass every applicable node runs; on a repair
// pass only the nodes that own an open finding run again. Derived entirely
// from the registry loaded above, filtered to role: 'build' and (for
// media_eventtech specifically) Architect's needsMedia decision.
// ---------------------------------------------------------------------

const BUILD_NODES = Object.keys(registryNodes)
  .filter((id) => registryNodes[id]?.role === 'build')
  .filter((id) => id !== 'media_eventtech' || needsMedia)
  .map((id) => ({ id, ...registryNodes[id] }));

if (BUILD_NODES.length === 0) {
  return await escalate('No build-role nodes resolved from .agents/nodes.json for this goal.');
}

const NODE_ENUM = BUILD_NODES.map((n) => n.id);
const NODE_NAMES = humanList(NODE_ENUM);

let findings = [];
let reviewedClean = false;
let nodesToRun = BUILD_NODES; // first pass: everyone applicable
let previousBlockingIds = new Set(); // for the no-progress guard below

while (!reviewedClean) {
  await pipeline(nodesToRun, (n) => {
    const openFindings = findings.filter((f) => f.node === n.id && f.status === 'open');
    return agent(
      `You are acting as the ${n.label} agent (${n.personaFile}). ${dispatchNote(n)}${skillsNote(n)}\n\n` +
        `Read the plan at ${planPath}. ${n.instructions}\n` +
        (openFindings.length
          ? `Address these open Reviewer findings before anything else: ${JSON.stringify(openFindings)}\n`
          : ''),
      { label: n.id, agentType: n.agentType, model: n.model }
    );
  });

  // Barrier: every build node in this pass has returned and written only its
  // own production_artifacts/state.d/<id>.json fragment (dispatchNote()'s
  // build-role branch). Fold them into state.json now, before Reviewer (or
  // anything else) reads it -- this is the CHANGE 1 fix from comment block
  // item #3, and it must happen inside this run since graph-gate.mjs reads
  // state.json at turn end.
  const mergeResult = await mergeStateD();
  if (mergeResult?.skipped?.length) {
    return await escalate(
      `State merge could not fold fragment(s) after the build pass: ${mergeResult.skipped.join(', ')}`,
      { skipped: mergeResult.skipped }
    );
  }

  // Reviewer: ARTIFACT + CONTRACT only, per .agents/graph.md's discipline --
  // reviewerStateNote() (not dispatchNote()) is what actually enforces this;
  // see that function's own comment for why the distinction matters.
  const reviewResult = await agent(
    `You are acting as the ${reviewerNode.label} agent (${reviewerNode.personaFile}). ${reviewerStateNote()}${skillsNote(reviewerNode)}\n\n` +
      `Read the plan/contract at ${planPath} and the artifacts it produced ` +
      `(production_artifacts/01_frontend_spec.md, 02_backend_schema.md${
        needsMedia ? ', 03_media_pipeline.md' : ''
      }, and the actual code). ` +
      `Do an adversarial review against the contract: find what is wrong, do not validate, do not summarize. ` +
      `Do not assume the implementation is correct just because it exists. ` +
      `Classify every finding by precedence: contract misread > valid & actionable (blocking) > valid trade-off (advisory) > noise (discard). ` +
      `Each finding must name which node owns fixing it: ${NODE_NAMES} -- no other value is valid. ` +
      `If you are re-reviewing after a repair round and an issue you flagged before is still present and still unfixed, ` +
      `reuse the exact same "id" you gave it last time; only mint a new id for a genuinely new issue. This id ` +
      `stability is what lets the dispatcher detect a repair round that made no real progress, so do not renumber ` +
      `findings between cycles just because this is a fresh review call.\n` +
      `Write production_artifacts/review_findings.md and update state.findings.\n\n` +
      `Return only: { "findings": [{ "id": string, "severity": "blocking"|"advisory", "node": string, "summary": string, "status": "open"|"fixed"|"wont_fix" }], "blockingCount": number }.`,
    {
      label: `reviewer-${iteration}`,
      agentType: reviewerNode.agentType,
      model: reviewerNode.model,
      schema: {
        type: 'object',
        required: ['findings', 'blockingCount'],
        properties: {
          findings: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'severity', 'node', 'summary', 'status'],
              properties: {
                id: { type: 'string' },
                severity: { type: 'string', enum: ['blocking', 'advisory'] },
                node: { type: 'string', enum: NODE_ENUM },
                summary: { type: 'string' },
                status: { type: 'string', enum: ['open', 'fixed', 'wont_fix'] },
              },
            },
          },
          blockingCount: { type: 'number' },
        },
      },
    }
  );

  findings = reviewResult?.findings ?? [];
  const blockingCount = reviewResult?.blockingCount ?? findings.filter((f) => f.severity === 'blocking').length;

  if (blockingCount === 0) {
    // Clean. Note on .agents/graph.md's original "doubt theater" guard (2
    // consecutive clean reviews escalate): that check has no reachable
    // trigger in this control flow -- a clean result exits this loop
    // immediately, so Reviewer is never asked to re-confirm an
    // already-clean artifact. What this loop *can* actually detect, and
    // does below, is the opposite failure mode: a repair round that
    // changes nothing. Same underlying intent, a form this structure can
    // genuinely reach.
    reviewedClean = true;
  } else {
    const blockingIds = new Set(findings.filter((f) => f.severity === 'blocking').map((f) => f.id));
    const sameAsLastTime =
      iteration > 0 &&
      blockingIds.size > 0 &&
      blockingIds.size === previousBlockingIds.size &&
      [...blockingIds].every((id) => previousBlockingIds.has(id));

    if (sameAsLastTime) {
      // No-progress guard: the build node(s) supposedly addressed these
      // exact findings last round, and Reviewer is reporting the identical
      // finding IDs again. Depends on Reviewer actually reusing IDs for
      // still-open issues (see the prompt instruction above) -- escalate
      // now instead of burning the remaining iterations on an identical
      // repeat.
      return await escalate(
        'No progress: Reviewer reported the exact same blocking finding(s) after a repair round that was supposed to address them. Escalating rather than repeating an identical cycle.',
        { findings }
      );
    }

    previousBlockingIds = blockingIds;
    nodesToRun = BUILD_NODES.filter((n) => findings.some((f) => f.node === n.id && f.status === 'open'));
    if (nodesToRun.length === 0) {
      // Findings exist but none map to a known node -- Reviewer mis-tagged
      // ownership (the schema's enum constraint above should make this rare,
      // but a model can still return status values that don't leave any
      // "open" finding for a real node). Don't loop on nothing; escalate.
      return await escalate('Reviewer reported blocking findings but none left an open finding on a recognized node.', {
        findings,
      });
    }

    iteration++;
    if (iteration >= MAX_ITERATIONS) {
      return await escalate(`Build/review repair loop hit ${MAX_ITERATIONS} iterations with findings still open.`, {
        findings,
      });
    }
  }
}

// ---------------------------------------------------------------------
// Shipping: automated gate. Deliberately a separate check from Reviewer's
// adversarial pass (mechanical gate execution vs. correctness review).
// Shipping itself is sequential (not part of the CHANGE 1 race); the
// gate-fix repair round below IS a pipeline() fan-out, so it gets the same
// state.d + merge treatment as the build/review loop above.
// ---------------------------------------------------------------------

const GATE_KEYS = ['lint', 'typecheck', 'tests', 'a11y', 'seo'];
const GATE_VALUE_ENUM = ['pass', 'fail', 'skip'];
let allGatesPass = false;
let lastGate = null;

while (!allGatesPass) {
  const shipResult = await agent(
    `You are acting as the ${shippingNode.label} agent (${shippingNode.personaFile}). ${dispatchNote(shippingNode)}${skillsNote(shippingNode)}\n\n` +
      `Run the automated quality gate against the artifacts from the plan at ${planPath}: lint, typecheck, ` +
      `tests, a11y, seo. Use the repository's own commands (npm test / pytest / tsc --noEmit / etc -- detect ` +
      `which apply; use "skip" only for a check that genuinely doesn't apply to this repo, not for one you didn't run). ` +
      `Write production_artifacts/04_release_report.md and update state.gate.\n\n` +
      `Return only: { "gate": { "lint": "pass"|"fail"|"skip", "typecheck": "pass"|"fail"|"skip", "tests": "pass"|"fail"|"skip", "a11y": "pass"|"fail"|"skip", "seo": "pass"|"fail"|"skip" }, "blockingNodes": string[] } ` +
      `-- blockingNodes lists which build node(s) (${NODE_NAMES}) own fixing each failing check; empty if all pass.`,
    {
      label: `shipping-${iteration}`,
      agentType: shippingNode.agentType,
      model: shippingNode.model,
      schema: {
        type: 'object',
        required: ['gate', 'blockingNodes'],
        properties: {
          gate: {
            type: 'object',
            required: GATE_KEYS,
            properties: Object.fromEntries(GATE_KEYS.map((k) => [k, { type: 'string', enum: GATE_VALUE_ENUM }])),
          },
          blockingNodes: { type: 'array', items: { type: 'string', enum: NODE_ENUM } },
        },
      },
    }
  );

  lastGate = shipResult?.gate ?? {};
  const failing = Object.entries(lastGate).filter(([, v]) => v === 'fail');

  if (failing.length === 0) {
    allGatesPass = true;
    break;
  }

  iteration++;
  if (iteration >= MAX_ITERATIONS) {
    return await escalate(`Quality gate still failing after ${MAX_ITERATIONS} repair attempts.`, { gate: lastGate });
  }

  const blockingNodes = (shipResult?.blockingNodes ?? [])
    .map((n) => BUILD_NODES.find((b) => b.id === n))
    .filter(Boolean);

  if (blockingNodes.length === 0) {
    return await escalate(
      `Shipping gate failed (${failing.map(([k]) => k).join(', ')}) but named no owning build node to re-invoke.`,
      { gate: lastGate }
    );
  }

  await pipeline(blockingNodes, (n) =>
    agent(
      `You are acting as the ${n.label} agent (${n.personaFile}). ${dispatchNote(n)}${skillsNote(n)}\n\n` +
        `Shipping's quality gate failed on a check you own: ${JSON.stringify(lastGate)}. ` +
        `Read production_artifacts/04_release_report.md for details and fix it.`,
      { label: `${n.id}-gate-fix-${iteration}`, agentType: n.agentType, model: n.model }
    )
  );

  // Same barrier as the build/review loop above: this pipeline() call just
  // ran build nodes concurrently, each writing only its own state.d
  // fragment. Fold them in before Shipping re-checks the gate.
  const gateMergeResult = await mergeStateD();
  if (gateMergeResult?.skipped?.length) {
    return await escalate(
      `State merge could not fold fragment(s) after a gate-fix repair round: ${gateMergeResult.skipped.join(', ')}`,
      { skipped: gateMergeResult.skipped }
    );
  }
}

// All gates green. Do NOT push/ship automatically -- that's gated by
// .claude/hooks/go-gate.mjs same as any other push/publish/version bump in
// this repo, and requires a literal "GO" from the user for the reply that
// runs it. This workflow's job ends at "ready," not at "shipped."
return {
  phase: 'ready_to_ship',
  reason:
    'All quality gates passed. Reply with the literal word GO to authorize the push (git commit, version tag, push) -- go-gate.mjs will not let it proceed otherwise.',
  gate: lastGate,
  planPath,
};
