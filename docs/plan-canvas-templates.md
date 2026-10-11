# Plan Canvas: which template when

Paths relative to `skills/global_config/plan-canvas/`. Facts verified by reading code; ids listed are only those whose `meta.json` was read.

## Selection mechanism
- No code picks a template. The agent or user picks one by id: `aos-plan-canvas templates` prints `{id,label,description,useWhen,hasBoard}` (`scripts/plan-canvas.js:601-612`), SKILL.md says to offer the choice first (`SKILL.md:72-77`).
- `new <id> <dir>` copies files; unknown id or non-empty target exits 2 (`plan-canvas.js:614-629`). Server `GET /` lists the same templates read-only (`scripts/lib/plan-canvas/server.js:147-158, 661-663`).
- Templates live in `scripts/lib/plan-builder/templates/<id>/`; a folder without readable `meta.json` is skipped (`plan-canvas.js:599-610`).

## Template ids and their `useWhen` (meta.json line 1 of each)
| id | board | use when |
|---|---|---|
| `feature` | yes | planning a user-facing feature needing 3-4 screens and a build order |
| `bugfix` | no | fixing a defect; cause, fix and proof written before coding |
| `architecture` | no | designing or reshaping a service/system; structure, interfaces, trade-offs |
| `migration` | no | moving data/service old to new; cutover and rollback |
| `release` | no | shipping a version; scope, go/no-go gate, staged rollout |
| `research` | no | choosing between options; evidence and recommendation reviewed first |
| `recap` | no | work finished; quick visual summary |
| `recap-review` | no | reviewer must decide on a merge/takeover; verified vs not verified |
| `recap-board` | yes | change is mostly visible; BEFORE/AFTER artboards with numbered notes |
Other ids may exist; list them with `aos-plan-canvas templates` (directory listing was not available to this check).

## Template files vs mode
- `--mode bdb-plan-builder` (default for `new`): copies `plan.mdx` and `canvas.mdx` if present, never `meta.json`. `--mode standard`: writes `plan.md` from `standard.md` (`plan-canvas.js:620, 631`).
- `hasBoard` = template has `canvas.mdx` (design canvas with screens/arrows); test asserts this (`tests/plan-builder-templates.test.mjs:43, 56`).
- Every template needs `standard.md` with a mermaid fence or table (`tests/plan-builder-templates.test.mjs:45-46`).

## Canvas modes (for `open`, not `new`)
- `standard` (default, always available) and `bdb-plan-builder` (available iff `lib/plan-builder/index.js` exists) (`plan-canvas.js:281-304`; `tests/plan-canvas-modes.test.mjs:57-76`).
- `open --mode bdb-plan-builder` renders `plan.mdx` (+ optional `canvas.mdx`, `prototype.mdx`) into `plan.builder.html` and opens that (`plan-canvas.js:329-337`; `lib/plan-builder/index.js:25-29`).
- `standard` opens a `.md` as-is; `.md` is rendered with the built-in markdown template, `.html` is shown with the SDK injected (`server.js:578-590`).
- Unknown mode or unavailable mode: exit 2 (`plan-canvas.js:314-322`; `tests/plan-canvas-modes.test.mjs:84-110`).
- `kind: recap` frontmatter or `.plan-state.json` gives the recap header (`lib/plan-builder/README.md:138-142`).

## GET / (server root)
- Returns the home page, HTTP 200 (`server.js:661-663`). A browser navigation from another loopback port is allowed; any other request with `Sec-Fetch-Site: cross-site` or `same-site` gets 403 `forbidden fetch site` (`server.js:641-647`).
- `GET /canvas/` (no key) is 404 by design: pages need a 12-hex session key (`server.js:137, 676`).
