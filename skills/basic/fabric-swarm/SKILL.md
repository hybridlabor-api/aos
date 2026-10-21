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
{ "goal": "", "worker_brief": "", "max_workers": 4,
  "items": [ { "id": "", "input": "", "status": "open|claimed|done|failed", "worker": "", "attempts": 0, "result": "" } ] }
```

- The dispatcher clamps `max_workers` to 1..6 on write.
- `--skill=<name>` is passed through into the `worker_brief` of every worker.
- Workers never write it; they return their result to the dispatcher.
- The claim: the dispatcher marks an item `claimed` for a worker before starting it, so no item runs twice. A resumed session continues from the file: on resume every `claimed` item goes back to `open` and that counts as one attempt (`attempts` above 2 means `failed`).

## Width

Default 4 workers at a time, hard cap 6 (same as workstreams). Harness or user limits may lower it. Each worker is a subagent with the same `worker_brief` plus exactly one item.

## Loop

1. Fill free slots with the next `open` item (mark it `claimed`, set `worker`, bump `attempts`).
2. On a result: mark `done` with a one-line `result`.
3. On a failed attempt: set the item back to `open` (`attempts` + 1) until `attempts` is 2, then mark it `failed` with the error as `result`.
4. When no item is `open` or `claimed`, run one review pass over all results (a reviewer subagent reads the results against the `worker_brief`) and report done/failed counts. If the review pass rejects items, it lists them and the dispatcher sets them back to `open` once (no second review round), then reports.

## Stop

All items `done` or `failed`, or the user stops it, or usage reaches 95 % via `stay-within-limits` (pause and keep the file).

## Safety

Workers get no push, merge or publish. A swarm run never counts as a GO. Destructive or external writes stay behind the go-gate. Models per role come from the router or `.aos/pipeline.json`, never from this skill.
