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

const STATE_SCHEMA_NOTE =
  'Read production_artifacts/state.json if it exists; otherwise this is a fresh run. ' +
  'After your part is done, update it per .agents/state.schema.json (create production_artifacts/ if missing).';

const goal = typeof args === 'string' ? args : args?.goal;
if (!goal) {
  return {
    phase: 'escalated',
    reason:
      'startcycle needs a goal, e.g. "Run /startcycle on: add OAuth login with Google" -- nothing was invoked.',
  };
}

// ---------------------------------------------------------------------
// Architect <-> TechLead: plan, then capability-map approval.
// ---------------------------------------------------------------------

let planPath = null;
let needsMedia = false;
let approved = false;
let planIteration = 0;
let lastRejectionReason = '';

while (!approved && planIteration < MAX_ITERATIONS) {
  const architectResult = await agent(
    `You are acting as the Architect agent (.claude/agents/architect.md). ${STATE_SCHEMA_NOTE}\n\n` +
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
      label: `architect-${planIteration}`,
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
    return { phase: 'escalated', reason: 'Architect did not return a plan path.', planIteration };
  }

  const techLeadResult = await agent(
    `You are acting as the TechLead agent (.claude/agents/techlead.md). ${STATE_SCHEMA_NOTE}\n\n` +
      `Read the plan at ${planPath}. Approve it only if it has an explicit capability map: ` +
      `module boundaries, dependency direction, and build order are all stated, not implicit. ` +
      `Record your decision in state.json (plan approval, state.phase = "build" if approved).\n\n` +
      `Return only: { "approved": boolean, "reason": string }.`,
    {
      label: `techlead-${planIteration}`,
      schema: {
        type: 'object',
        required: ['approved', 'reason'],
        properties: { approved: { type: 'boolean' }, reason: { type: 'string' } },
      },
    }
  );

  approved = !!techLeadResult?.approved;
  lastRejectionReason = techLeadResult?.reason ?? '';

  if (!approved) planIteration++;
}

if (!approved) {
  return {
    phase: 'escalated',
    reason: `TechLead never approved the plan within ${MAX_ITERATIONS} iterations. Last reason: ${lastRejectionReason}`,
    planPath,
  };
}

// ---------------------------------------------------------------------
// Build nodes (parallel, dispatcher-invoked independently -- pipeline()
// fans out one agent() per node; none of them call each other) <-> Reviewer
// repair loop. On the first pass every applicable node runs; on a repair
// pass only the nodes that own an open finding run again.
// ---------------------------------------------------------------------

const BUILD_NODES = [
  {
    node: 'ui_ux',
    label: 'Godmode_UI_UX',
    instructions:
      'Implement the frontend per the plan: responsive UI, DTCG design tokens, Anti-Slop taste. ' +
      'Write production_artifacts/01_frontend_spec.md and the code.',
  },
  {
    node: 'engineering',
    label: 'Godmode_Engineering',
    instructions:
      'Implement the backend per the plan: DDD models, type-safe schemas, API routes, Clean Architecture. ' +
      'Write production_artifacts/02_backend_schema.md and the code.',
  },
];
if (needsMedia) {
  BUILD_NODES.push({
    node: 'media_eventtech',
    label: 'Godmode_Media_EventTech',
    instructions:
      'Implement the media/show-control piece per the plan (TouchDesigner/Unreal/DaVinci/DMX as applicable). ' +
      'Write production_artifacts/03_media_pipeline.md.',
  });
}

let findings = [];
let buildIteration = 0;
let reviewedClean = false;
let nodesToRun = BUILD_NODES; // first pass: everyone applicable
let previousBlockingIds = new Set(); // for the no-progress guard below

while (!reviewedClean && buildIteration < MAX_ITERATIONS) {
  await pipeline(nodesToRun, (n) =>
    agent(
      `You are acting as the ${n.label} agent. ${STATE_SCHEMA_NOTE}\n\n` +
        `Read the plan at ${planPath}. ${n.instructions}\n` +
        (findings.some((f) => f.node === n.node && f.status === 'open')
          ? `Address these open Reviewer findings before anything else: ${JSON.stringify(
              findings.filter((f) => f.node === n.node)
            )}\n`
          : '') +
        `Update state.artifacts.${n.node === 'media_eventtech' ? 'media' : n.node} in state.json.`,
      { label: n.node }
    )
  );

  // Reviewer: ARTIFACT + CONTRACT only, per .agents/graph.md's discipline --
  // deliberately not given the build nodes' own claims or reasoning above,
  // only told where the artifacts and the plan/contract live.
  const reviewResult = await agent(
    `You are acting as the Reviewer agent (.claude/agents/reviewer.md). ${STATE_SCHEMA_NOTE}\n\n` +
      `Read the plan/contract at ${planPath} and the artifacts it produced ` +
      `(production_artifacts/01_frontend_spec.md, 02_backend_schema.md${
        needsMedia ? ', 03_media_pipeline.md' : ''
      }, and the actual code). ` +
      `Do an adversarial review against the contract: find what is wrong, do not validate, do not summarize. ` +
      `Do not assume the implementation is correct just because it exists. ` +
      `Classify every finding by precedence: contract misread > valid & actionable (blocking) > valid trade-off (advisory) > noise (discard). ` +
      `Each finding must name which node owns fixing it: "ui_ux", "engineering", or "media_eventtech". ` +
      `Write production_artifacts/review_findings.md and update state.findings.\n\n` +
      `Return only: { "findings": [{ "id": string, "severity": "blocking"|"advisory", "node": string, "summary": string, "status": "open" }], "blockingCount": number }.`,
    {
      label: `reviewer-${buildIteration}`,
      schema: {
        type: 'object',
        required: ['findings', 'blockingCount'],
        properties: {
          findings: { type: 'array' },
          blockingCount: { type: 'number' },
        },
      },
    }
  );

  findings = reviewResult?.findings ?? [];
  const blockingCount = reviewResult?.blockingCount ?? findings.filter((f) => f.severity === 'blocking').length;

  if (blockingCount === 0) {
    // Clean. Note on .agents/graph.md's "doubt theater" guard (2 consecutive
    // clean reviews escalate): that check doesn't have a reachable trigger
    // in this control flow -- a clean result exits this loop immediately,
    // so Reviewer is never asked to re-confirm an already-clean artifact,
    // and a streak counter here would just be dead code. What this loop
    // *can* actually detect, and does below, is the opposite failure mode:
    // a repair round that changes nothing. That serves the same underlying
    // intent (don't keep trusting a review loop that isn't making real
    // progress) in a form this script structure can genuinely reach.
    reviewedClean = true;
  } else {
    const blockingIds = new Set(findings.filter((f) => f.severity === 'blocking').map((f) => f.id));
    const sameAsLastTime =
      buildIteration > 0 &&
      blockingIds.size === previousBlockingIds.size &&
      [...blockingIds].every((id) => previousBlockingIds.has(id));

    if (sameAsLastTime) {
      // No-progress guard: the build node(s) supposedly addressed these
      // exact findings last round, and Reviewer is reporting the identical
      // finding IDs again. Either the fix didn't land or Reviewer isn't
      // actually re-checking -- either way, burning the remaining
      // iterations on an identical repeat won't help. Escalate now instead
      // of waiting for MAX_ITERATIONS to generically expire.
      return {
        phase: 'escalated',
        reason:
          'No progress: Reviewer reported the exact same blocking finding(s) after a repair round that was supposed to address them. Escalating rather than repeating an identical cycle.',
        findings,
        buildIteration,
      };
    }

    previousBlockingIds = blockingIds;
    nodesToRun = BUILD_NODES.filter((n) => findings.some((f) => f.node === n.node && f.status === 'open'));
    if (nodesToRun.length === 0) {
      // Findings exist but none map to a known node -- Reviewer mis-tagged
      // ownership. Don't loop on nothing; escalate with the raw findings.
      return {
        phase: 'escalated',
        reason: 'Reviewer reported blocking findings but none named a recognized owning node.',
        findings,
      };
    }
    buildIteration++;
  }
}

if (!reviewedClean) {
  return {
    phase: 'escalated',
    reason: `Build/review repair loop hit ${MAX_ITERATIONS} iterations with findings still open.`,
    findings,
    buildIteration,
  };
}

// ---------------------------------------------------------------------
// Shipping: automated gate. Deliberately a separate check from Reviewer's
// adversarial pass (mechanical gate execution vs. correctness review).
// ---------------------------------------------------------------------

let gateIteration = 0;
let allGatesPass = false;
let lastGate = null;

while (!allGatesPass && gateIteration < MAX_ITERATIONS) {
  const shipResult = await agent(
    `You are acting as the Godmode_Shipping agent. ${STATE_SCHEMA_NOTE}\n\n` +
      `Run the automated quality gate against the artifacts from the plan at ${planPath}: lint, typecheck, ` +
      `tests, a11y, seo. Use the repository's own commands (npm test / pytest / tsc --noEmit / etc -- detect ` +
      `which apply). Write production_artifacts/04_release_report.md and update state.gate.\n\n` +
      `Return only: { "gate": { "lint": "pass"|"fail"|"skip", "typecheck": "pass"|"fail"|"skip", "tests": "pass"|"fail"|"skip", "a11y": "pass"|"fail"|"skip", "seo": "pass"|"fail"|"skip" }, "blockingNodes": string[] } ` +
      `-- blockingNodes lists which build node(s) ("ui_ux" | "engineering" | "media_eventtech") own fixing each failing check.`,
    {
      label: `shipping-${gateIteration}`,
      schema: {
        type: 'object',
        required: ['gate', 'blockingNodes'],
        properties: {
          gate: { type: 'object' },
          blockingNodes: { type: 'array', items: { type: 'string' } },
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

  gateIteration++;
  if (gateIteration >= MAX_ITERATIONS) break;

  const blockingNodes = (shipResult?.blockingNodes ?? [])
    .map((n) => BUILD_NODES.find((b) => b.node === n))
    .filter(Boolean);

  if (blockingNodes.length === 0) {
    return {
      phase: 'escalated',
      reason: `Shipping gate failed (${failing.map(([k]) => k).join(', ')}) but named no owning build node to re-invoke.`,
      gate: lastGate,
    };
  }

  await pipeline(blockingNodes, (n) =>
    agent(
      `You are acting as the ${n.label} agent. ${STATE_SCHEMA_NOTE}\n\n` +
        `Shipping's quality gate failed on a check you own: ${JSON.stringify(lastGate)}. ` +
        `Read production_artifacts/04_release_report.md for details and fix it.`,
      { label: `${n.node}-gate-fix-${gateIteration}` }
    )
  );
}

if (!allGatesPass) {
  return {
    phase: 'escalated',
    reason: `Quality gate still failing after ${MAX_ITERATIONS} repair attempts.`,
    gate: lastGate,
  };
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
