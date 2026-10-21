---
name: fabric-swarm
description: >-
  Fabric mode for N similar workers taking items from one shared pool. Use for
  one list of many near-identical items (files, tickets, pages), one worker each.
category: bdb-core
---

# `/fabric-swarm` — many similar workers, one shared pool

**When:** one list of many near-identical items (files, tickets, pages) that each fit one worker. If items depend on each other, use `fabric-graph` instead.

**Agents never invoke each other.** The dispatcher (the main session) decides every next step. Workers only return a result.

## Pool file

`production_artifacts/swarm.json`, written ONLY by the dispatcher:

```json
{ "goal": "", "worker_brief": "", "max_workers": 4, "review_done": false,
  "items": [ { "id": "", "input": "", "status": "open|claimed|done|failed", "worker": "", "attempts": 0, "result": "" } ] }
```

- The dispatcher clamps `max_workers` to 1..6 on write.
- `--skill=<name>` is passed through into the `worker_brief` of every worker.
- Workers never write it; they return their result to the dispatcher.
- The claim: the dispatcher marks an item `claimed` for a worker before starting it, so no item runs twice.
- Attempt counter: `attempts` is incremented exactly once per attempt, when the dispatcher claims an item (`open` -> `claimed`). Nowhere else. Max 2 attempts per item.
- `review_done` is `false` until the one review pass has run (see Loop step 4).
- Resume: the file is the source of truth. On resume, every `claimed` item goes back to `open`; the interrupted attempt already counted at claim, so nothing is incremented. If that item already has `attempts` = 2, it becomes `failed` with result `interrupted` instead.

## Width

Default 4 workers at a time, hard cap 6 (same as workstreams). Harness or user limits may lower it. Each worker is a subagent with the same `worker_brief` plus exactly one item.

## Loop

1. Fill free slots with the next `open` item: mark it `claimed`, set `worker`, and increment `attempts` by 1. This is the only place `attempts` is incremented.
2. On a result: mark `done` with a one-line `result`.
3. On a worker failure, without touching `attempts`: if `attempts` < 2, set the item back to `open`; if `attempts` = 2, mark it `failed` with the error as `result`.
4. When no item is `open` or `claimed` and `review_done` is `false`, run the review pass once over the `done` results (a reviewer subagent reads them against the `worker_brief`), then set `review_done` to `true`. Rejected items go back to `open` with `attempts` set to 1 (a reset, not an increment), so each gets exactly one more attempt: its next claim makes `attempts` 2. Then return to step 1. The dispatcher writes the review verdict (rejected items back to `open`) and `review_done: true` in one write of swarm.json, so a crash cannot repeat the review.
5. When no item is `open` or `claimed` and `review_done` is `true`, the run ends: report done/failed counts. No second review round.

## Stop

All items `done` or `failed`, or the user stops it, or usage reaches 95 % via `stay-within-limits` (pause and keep the file).

## Safety

Workers get no push, merge or publish. A swarm run never counts as a GO. Destructive or external writes stay behind the go-gate. Models per role come from the router or `.aos/pipeline.json`, never from this skill.
