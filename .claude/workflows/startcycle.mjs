// Dispatcher for /startcycle. Implements the node/edge table in
// .agents/graph.md as an actual runnable loop, using Claude Code's Dynamic
// Workflows runtime (this script IS the dispatcher F-17 requires: it holds
// the loop and the branching decisions; the seven agents below are leaves
// that never invoke each other or this script).
//
// Two things this runtime doesn't give a workflow script, and how we work
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
// max_iterations mirrors .agents/state.schema.json's default (3) --
// deliberately under Claude Code's own 8-consecutive-Stop-hook-block
// override, so this workflow's own escalation return reaches the user
// before that platform ceiling would silently end a turn instead.

export const meta = {
  name: 'startcycle',
  description:
    'Dispatcher-mediated build pipeline: Architect -> TechLead -> {UI_UX, Engineering, Media_EventTech} -> Reviewer -> Shipping, per .agents/graph.md. Agents never invoke each other -- this script decides every next step.',
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

// Every non-Reviewer agent gets the same note: read the full state, and
// explicitly set state.iteration to the dispatcher's current count so the
// persisted file (which .claude/hooks/graph-gate.mjs reads) actually reflects
// reality -- nothing else in this script has filesystem access to write it
// directly.
function dispatchNote() {
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
// generic state-sync note."
function reviewerStateNote() {
  return (
    'Do NOT read state.goal or any other node\'s reasoning/claims from production_artifacts/state.json -- ' +
    'your review must be based only on the plan/contract and artifact files named below, nothing else. ' +
    'You may open production_artifacts/state.json purely to merge your update into it without clobbering ' +
    'unrelated fields (or create it fresh per .agents/state.schema.json if missing), but that file access is ' +
    `for the write, not for forming your judgment. Set state.iteration to ${iteration} in your update.`
  );
}

// Centralizes every escalation path through one place, so `needs_human` and
// `phase: escalated` actually land in state.json instead of only in this
// script's return value (found the same way: grep for "needs_human" in an
// earlier draft returned zero matches across 8 separate `return { phase:
// 'escalated', ... }` sites -- the field was silently dropped end to end
// every single time, since none of those `return`s routed through an
// agent() call that could persist it).
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

const goal = typeof args === 'string' ? args : args?.goal;
if (!goal) {
  return escalate(
    'startcycle needs a goal, e.g. "Run /startcycle on: add OAuth login with Google" -- nothing was invoked.'
  );
}

// ---------------------------------------------------------------------
// Architect <-> TechLead: plan, then capability-map approval.
// ---------------------------------------------------------------------

let planPath = null;
let needsMedia = false;
let approved = false;
let lastRejectionReason = '';

while (!approved) {
  const architectResult = await agent(
    `You are acting as the Architect agent (.claude/agents/architect.md). ${dispatchNote()}\n\n` +
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
    `You are acting as the TechLead agent (.claude/agents/techlead.md). ${dispatchNote()}\n\n` +
      `Read the plan at ${planPath}. Approve it only if it has an explicit capability map: ` +
      `module boundaries, dependency direction, and build order are all stated, not implicit. ` +
      `Record your decision in state.json (plan approval, state.phase = "build" if approved).\n\n` +
      `Return only: { "approved": boolean, "reason": string }.`,
    {
      label: `techlead-${iteration}`,
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
// pass only the nodes that own an open finding run again.
// ---------------------------------------------------------------------

const NODE_NAMES = needsMedia ? '"ui_ux", "engineering", or "media_eventtech"' : '"ui_ux" or "engineering"';
const NODE_ENUM = needsMedia ? ['ui_ux', 'engineering', 'media_eventtech'] : ['ui_ux', 'engineering'];

const BUILD_NODES = [
  {
    node: 'ui_ux',
    label: 'Godmode_UI_UX',
    agentFile: '.claude/agents/godmode-ui-ux.md',
    instructions:
      'Implement the frontend per the plan: responsive UI, DTCG design tokens, Anti-Slop taste. ' +
      'Write production_artifacts/01_frontend_spec.md and the code.',
  },
  {
    node: 'engineering',
    label: 'Godmode_Engineering',
    agentFile: '.claude/agents/godmode-engineering.md',
    instructions:
      'Implement the backend per the plan: DDD models, type-safe schemas, API routes, Clean Architecture. ' +
      'Write production_artifacts/02_backend_schema.md and the code.',
  },
];
if (needsMedia) {
  BUILD_NODES.push({
    node: 'media_eventtech',
    label: 'Godmode_Media_EventTech',
    agentFile: '.claude/agents/godmode-media-eventtech.md',
    instructions:
      'Implement the media/show-control piece per the plan (TouchDesigner/Unreal/DaVinci/DMX as applicable). ' +
      'Write production_artifacts/03_media_pipeline.md.',
  });
}

let findings = [];
let reviewedClean = false;
let nodesToRun = BUILD_NODES; // first pass: everyone applicable
let previousBlockingIds = new Set(); // for the no-progress guard below

while (!reviewedClean) {
  await pipeline(nodesToRun, (n) => {
    const openFindings = findings.filter((f) => f.node === n.node && f.status === 'open');
    return agent(
      `You are acting as the ${n.label} agent (${n.agentFile}). ${dispatchNote()}\n\n` +
        `Read the plan at ${planPath}. ${n.instructions}\n` +
        (openFindings.length
          ? `Address these open Reviewer findings before anything else: ${JSON.stringify(openFindings)}\n`
          : '') +
        `Update state.artifacts.${n.node === 'media_eventtech' ? 'media' : n.node} in state.json.`,
      { label: n.node }
    );
  });

  // Reviewer: ARTIFACT + CONTRACT only, per .agents/graph.md's discipline --
  // reviewerStateNote() (not dispatchNote()) is what actually enforces this;
  // see that function's own comment for why the distinction matters.
  const reviewResult = await agent(
    `You are acting as the Reviewer agent (.claude/agents/reviewer.md). ${reviewerStateNote()}\n\n` +
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
    nodesToRun = BUILD_NODES.filter((n) => findings.some((f) => f.node === n.node && f.status === 'open'));
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
// ---------------------------------------------------------------------

const GATE_KEYS = ['lint', 'typecheck', 'tests', 'a11y', 'seo'];
const GATE_VALUE_ENUM = ['pass', 'fail', 'skip'];
let allGatesPass = false;
let lastGate = null;

while (!allGatesPass) {
  const shipResult = await agent(
    `You are acting as the Godmode_Shipping agent (.claude/agents/godmode-shipping.md). ${dispatchNote()}\n\n` +
      `Run the automated quality gate against the artifacts from the plan at ${planPath}: lint, typecheck, ` +
      `tests, a11y, seo. Use the repository's own commands (npm test / pytest / tsc --noEmit / etc -- detect ` +
      `which apply; use "skip" only for a check that genuinely doesn't apply to this repo, not for one you didn't run). ` +
      `Write production_artifacts/04_release_report.md and update state.gate.\n\n` +
      `Return only: { "gate": { "lint": "pass"|"fail"|"skip", "typecheck": "pass"|"fail"|"skip", "tests": "pass"|"fail"|"skip", "a11y": "pass"|"fail"|"skip", "seo": "pass"|"fail"|"skip" }, "blockingNodes": string[] } ` +
      `-- blockingNodes lists which build node(s) (${NODE_NAMES}) own fixing each failing check; empty if all pass.`,
    {
      label: `shipping-${iteration}`,
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
    .map((n) => BUILD_NODES.find((b) => b.node === n))
    .filter(Boolean);

  if (blockingNodes.length === 0) {
    return await escalate(
      `Shipping gate failed (${failing.map(([k]) => k).join(', ')}) but named no owning build node to re-invoke.`,
      { gate: lastGate }
    );
  }

  await pipeline(blockingNodes, (n) =>
    agent(
      `You are acting as the ${n.label} agent (${n.agentFile}). ${dispatchNote()}\n\n` +
        `Shipping's quality gate failed on a check you own: ${JSON.stringify(lastGate)}. ` +
        `Read production_artifacts/04_release_report.md for details and fix it.`,
      { label: `${n.node}-gate-fix-${iteration}` }
    )
  );
}

// All gates green. Do NOT push/ship automatically -- that's gated by
// .claude/hooks/go-gate.mjs same as any other push/publish/version bump in
// this repo, and requires a literal "GO" from the user for the reply that
// runs it. This workflow's job ends at "ready," not at "shipped."
return {
  phase: 'ready_to_ship',
  reason:
    'All quality gates passed. Reply with the literal word GO to run /ship (git commit, version tag, push) -- go-gate.mjs will not let it proceed otherwise.',
  gate: lastGate,
  planPath,
};
