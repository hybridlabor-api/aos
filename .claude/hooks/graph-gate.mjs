#!/usr/bin/env node
// Stop hook — the deterministic half of the /startcycle loop-keeper described
// in .agents/graph.md. Blocks turn-end while production_artifacts/state.json
// shows a failing quality gate and the run hasn't hit its iteration ceiling,
// so an unattended /startcycle repair loop doesn't stop just because the
// model's own turn ended -- it keeps going until the gate passes or
// max_iterations forces an escalation.
//
// Deliberately fails OPEN, unlike go-gate.mjs's fail-closed default: a
// missing or malformed state.json most likely means this isn't a /startcycle
// run at all (the common case, since this hook fires on every Stop event in
// every session, not just graph runs), or the run hasn't reached a gate step
// yet. Blocking indefinitely on an unreadable state file would be a worse
// failure than occasionally letting an ordinary turn end normally -- unlike
// go-gate.mjs, where a false-negative risks an unauthorized push/publish, a
// false-negative here just means a normal stop, fully recoverable by the
// dispatcher's next turn.
//
// max_iterations defaults to 3 (.agents/state.schema.json) -- deliberately
// under Claude Code's own 8-consecutive-Stop-hook-block override (itself
// tunable via CLAUDE_CODE_STOP_HOOK_BLOCK_CAP), so this hook's own escalation
// message reaches the user before that platform ceiling would silently end
// the turn without one.
//
// Progress requirement: this hook only blocks while the run is DEMONSTRABLY
// advancing. Two guards enforce that, because "gate is red" alone is not a
// good enough reason to keep a session alive indefinitely:
//
//   a) `stop_hook_active` in the hook input is true when this stop is itself
//      the result of a previous Stop-hook block. The hooks guide names
//      checking it as the way a Stop hook avoids driving a runaway loop. On
//      its own, though, exiting early whenever it's true would let this hook
//      block exactly once ever -- useless for a repair loop that legitimately
//      spans several turns. So it's combined with (b) rather than used alone.
//
//   b) `state.iteration` must have CHANGED since the last time this hook
//      blocked (tracked in a sibling marker file). If the dispatcher is
//      working the repair loop, iteration advances every round and blocking
//      is justified. If it hasn't moved, nothing is actually being repaired
//      -- something is stuck or nobody is driving the loop -- and blocking
//      again would just burn turns until the platform cap force-overrides us
//      with a warning. In that case: allow the stop and let the human see it.

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function allow() {
  process.exit(0);
}

function block(reason) {
  process.stderr.write(`Blocked by graph-gate hook: ${reason}\n`);
  process.exit(2);
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    allow(); // can't read hook input -- fail open, this hook has no opinion without it
    return;
  }

  const cwd = input?.cwd || process.cwd();
  const statePath = join(cwd, "production_artifacts", "state.json");
  const markerPath = join(cwd, "production_artifacts", ".graph-gate-last-block");

  if (!existsSync(statePath)) {
    allow(); // no active /startcycle run in this cwd -- most sessions, most of the time
    return;
  }

  let state;
  try {
    state = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    allow(); // malformed state -- fail open, see file header
    return;
  }

  const iteration = Number.isInteger(state.iteration) ? state.iteration : 0;
  const maxIterations = Number.isInteger(state.max_iterations) ? state.max_iterations : 3;

  if (iteration >= maxIterations) {
    // Ceiling reached: this is the dispatcher's job to have already set
    // phase: "escalated" and needs_human: true per .agents/graph.md's edge
    // table. The hook does not loop past this -- it only enforces "don't
    // stop with a known-failing gate," never "keep going forever."
    allow();
    return;
  }

  const gate = state.gate && typeof state.gate === "object" ? state.gate : {};
  const failing = Object.entries(gate)
    .filter(([, v]) => v === "fail")
    .map(([k]) => k);

  if (failing.length === 0) {
    allow();
    return;
  }

  // Progress check (see file header). Only relevant once we've already
  // blocked at least once this run -- stop_hook_active tells us that.
  if (input?.stop_hook_active) {
    let lastBlockedIteration = null;
    try {
      lastBlockedIteration = JSON.parse(readFileSync(markerPath, "utf8"))?.iteration ?? null;
    } catch {
      // No readable marker: treat as "no evidence of a prior block by us",
      // fall through and block once, writing the marker below.
    }

    if (lastBlockedIteration === iteration) {
      // We blocked before at this same iteration and the dispatcher hasn't
      // advanced it since. Nothing is being repaired -- blocking again would
      // just burn turns until the platform's consecutive-block cap
      // force-overrides us with a warning the user has to decipher. Let the
      // stop through so the failing gate surfaces plainly instead.
      process.stderr.write(
        `graph-gate: gate still failing (${failing.join(", ")}) but iteration has not advanced ` +
          `past ${iteration} since the last block -- the repair loop is not progressing. ` +
          `Allowing this turn to end so it surfaces instead of looping.\n`
      );
      allow();
      return;
    }
  }

  try {
    writeFileSync(markerPath, JSON.stringify({ iteration, at: new Date().toISOString() }));
  } catch {
    // Marker is an optimization, not a correctness requirement -- if we can't
    // write it, the platform's own consecutive-block cap still bounds us.
  }

  block(
    `production_artifacts/state.json shows failing gate check(s): ${failing.join(", ")} ` +
    `(iteration ${iteration}/${maxIterations}). Per .agents/graph.md, the dispatcher should ` +
    `invoke the owning build node for a repair pass before this run stops.`
  );
}

main();
