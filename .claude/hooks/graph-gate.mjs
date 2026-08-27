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
// under Claude Code's own 8-consecutive-Stop-hook-block override, so this
// hook's own escalation message reaches the user before that platform
// ceiling would silently end the turn without one.

import { readFileSync, existsSync } from "node:fs";
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

  block(
    `production_artifacts/state.json shows failing gate check(s): ${failing.join(", ")} ` +
    `(iteration ${iteration}/${maxIterations}). Per .agents/graph.md, the dispatcher should ` +
    `invoke the owning build node for a repair pass before this run stops.`
  );
}

main();
