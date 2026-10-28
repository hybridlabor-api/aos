# The router (R1), shipped in 5.3.0

R1 is the first, deliberately read-only slice of model/harness routing for
the dispatcher graph. It does not change behaviour: it centralises the
routing table and logs what it *would* choose. Landed through
`feat(router): merge feat/router-r1 (table, route resolution, dispatcher
advisory)` (b5605c1, part of the release/5.2.2-bundle merge PR #167).

## `config/router.json`

The single declarative table (config/router.json), four sections:

- `roles`: `architect`, `techlead`, `reviewer`, `builder`, `scout`, `advisor` (see `docs/agent-models.md`).
- `targets`: `claude`, `opencode-go` (`model: glm-5.3-flash`), `agy`,
  `codex`, `claude-glm`; each with percent `limits`
  (`window_5h` / `weekly`, soft 0.8, hard 0.95) held as data.
- `preferences`: per role, an ordered target list. Review/planning roles
  start with `claude`; `builder` and `scout` start with `opencode-go`.
- `enforce`: `false` — R1 is advisory only.

## `lib/router/table.js`

Loads and strictly validates the table (lib/router/table.js:26-163): roles
must be in the known set, targets in the known set, preference lists
non-empty and known, limits numbers in [0,1] with `soft <= hard`, anything
extra rejected with a named error. The validated table is frozen and cached
(`getRouterTable`, lib/router/table.js:184-192, `DEFAULT_CONFIG_PATH`
resolves to `config/router.json`).

## `lib/router/route.js`

`resolveRole(node, table)` maps a pipeline node spec to a role in this order
(lib/router/route.js:13-92):

1. direct `role` property (with alias mapping `plan`->architect,
   `approve`->techlead, `review`->reviewer, `build`->builder),
2. `executor` property,
3. substring match of the node id/agentType/label (`architect`,
   `techlead`, `reviewer`, `scout`, and the build aliases
   `ui_ux`/`engineering`/`media_eventtech`/`godmode`->builder).

Unknown nodes fall back to `builder` with `isDefault: true`, so a typo never
routes work to a privileged role. `routeFor(node, ctx)` then picks the first
target of the role's preference list, honours a `ctx.target` override, and
selects the model from the target config (lib/router/route.js:102-143). The
function is pure: table in, `{ target, model, reason }` out.

## The advisory hook in the dispatcher

`.claude/workflows/fabric-dispatch.mjs` imports `routeFor` lazily and
logs each node's would-be target to stderr:
`[router] advisory node <id> -> target: <target>` (fabric-dispatch.mjs:
72-76, 657-666). Two boundaries matter:

- when `enforce` is false it only logs; the returned model options are still
  those the dispatcher computed before R1 (commit b7421dfa: "without altering
  dispatch options when enforce is false");
- the log goes to stderr, never stdout, so it cannot corrupt dispatcher
  output consumed by the graph contract (a3d58f1).

The dynamic import plus the self-test came from 99f4c86; the suite covering
table validation, route resolution and the advisory line is
tests/router-route.test.js (fdf93dd).

## What R2 will add

R2 is planned, not shipped; nothing in `lib/router/` implements it yet
(`enforce` exists in the table schema, no enforcement caller exists). R2
consumes the data R1 already carries to make the routing real:

- a limit ledger: usage accounting per target against the
  `window_5h`/`weekly` limits that are already validated in `config/router.json`
  and returned as table data (`limits`, lib/router/table.js:128-152), so a
  role routes away from a target that is near its hard line;
- failover: when the primary target of a role is unavailable or exhausted,
  walk the rest of that role's preference list instead of failing.

Both depend on a real usage source per target; until that exists the table's
`limits` remain inert data — stated here as intent (the R1 merge message and
the R1 review in PR #167 treat R2 as the follow-up), not as an implemented
mechanism.
