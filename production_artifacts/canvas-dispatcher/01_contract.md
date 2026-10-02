# Canvas dispatcher: wave-1/2 interface contract

Source plan: `aos-wt-cmds/production_artifacts/harness-audit/03_plan_canvas_dispatcher.md` (sections 0-7, decisions in 6).
Base: `feat/canvas-dispatcher` (origin/main + C1-C7). All paths are relative to the repo root; `PC` = `skills/global_config/plan-canvas/scripts`.
Everything below was read from code unless it says **UNVERIFIED**.

## 0. Facts read from code (the contract builds on these)

| Fact | Where |
|---|---|
| Feedback kinds are `chat`, `annotation`, `verdict`; verdicts `approve`, `request-changes`. Item ids `fb-<counter>`, `at` ISO string | `PC/lib/plan-canvas/sessions.js` `normalizeFeedbackItem` |
| Annotation today: `{id, kind:"annotation", text, at, anchor:{selector≤500, tag≤60, snippet≤400, textRange?:{text≤1000}}}`; `text` required; sanitizing is length truncation only (no control/bidi strip) | same |
| `await` output: `{status:"feedback", items:[...], sessionEnded?, endedBy?, next_step}` / `{status:"ended", endedBy}` / `{status:"waiting"}` / `{status:"missing"}` / `{status:"no-server"}` | `sessions.js takeFeedback`, `PC/plan-canvas.js cmdAwait` |
| State: `<AOS_PLAN_CANVAS_STATE_DIR or ~/.claude/aos-plan-canvas>/sessions.json` (`{sessions:{<key>:{key,file,status,endedBy?,chat[],pendingFeedback[],createdAt,updatedAt}}, feedbackCounter}`), plus `server.json`, `server.log` | `sessions.js`, `plan-canvas.js` |
| Session key = `sha256(realpath(file)).slice(0,12)`: deterministic, so the canvas URL `/canvas/<key>` is the same after any restart. `open` resumes an existing session; a session ended **by the user** refuses a plain `open` (HTTP 409) unless `--reopen` | `sessions.js open`, `server.js POST /api/sessions` |
| The annotation layer lives in `PC/lib/plan-canvas/sdk.js` (injected into the sandboxed iframe, no `allow-same-origin`), not in `ui.js`. postMessage protocol: iframe→chrome `pc:ready`, `pc:queue{item}`, `pc:queue-and-send{item}`, `pc:scroll{x,y}`, `pc:toggle-mode`; chrome→iframe `pc:set-mode{annotate}`, `pc:restore-scroll{x,y}` | `sdk.js`, `ui.js canvasClientJs` |
| Global request gate, in order: Host allowlist → Origin must be loopback **and** same port → `Sec-Fetch-Site` must be `same-origin`/`none`/absent, except `GET` on `STATIC_READ_PATH` (`/sdk.js`, `/artifact/<key>/...`) | `server.js createServer`, `PC/lib/loopback-guard.js` |
| Server `workspaceRoot` = cwd of whoever first spawned the detached server; artifacts outside it get 403 | `server.js confinedArtifactPath`, `plan-canvas.js ensureServer` |
| Port 4519 default (`AOS_PLAN_CANVAS_PORT`), idle shutdown 30 min (`AOS_PLAN_CANVAS_IDLE_MS`) | `server.js` |
| `aos-trail --ensure [--cwd] [--plan] [--session] [--json]` prints one JSON line `{url, started, opened, reason, plan, hint}`, always exits 0, reuses a running map for the same repo (`/whoami` on ports 5330-5344, `AOS_TRAIL_PORTS` override), opens the browser at most once per `--session` | `skills/global_config/agenttrail/bin/{agenttrail.mjs,ensure.mjs}` |
| `ensure` plan marker: `/^##\s+.+?\s*\{#[a-z0-9][a-z0-9-]*\}\s*$/im`; plan-builder folders become such a file through `writeTrail(dir,{out,force,workspaceRoot})` | `ensure.mjs`, `PC/lib/plan-builder/trail.js` |
| Installer retires removed skills via fixed set `SKILLS_REMOVED_IN_4_4_2` + `pruneRemovedSkills(manifest)` (called at `installer.js:5715`, `:6244`). **Bug (read, not executed):** a user-edited file is backed up to `<file>.<ts>.bak` *inside* the skill dir, then the whole dir is `rmSync`'d, so the backup is deleted too | `installer.js:686-768` |
| Backup convention that works: `~/.agents/backups/<name>-<stamp>/<path relative to HOME>`, hash-checked against the manifest, all derived from a `home` parameter | `lib/plugin-migration.js removeLooseCopies`, line 402 |
| No browser/test deps installed (no vite, react, playwright, puppeteer, jsdom) | `node_modules` |

## 1. Annotation item schema (delivered by `await`)

Additive only. Existing fields keep name, type and cap. New fields: `target`, `shapes`, `viewport`, `page`, `anchor.classes`, `route`.

```json
{
  "id": "fb-41", "kind": "annotation", "text": "make this bigger", "at": "2026-10-02T10:00:00.000Z",
  "anchor": { "selector": "main > div:nth-of-type(2) > button:nth-of-type(1)", "tag": "button",
              "snippet": "Sign up", "classes": ["btn", "btn-primary"], "textRange": { "text": "..." } },
  "target": { "origin": "app", "url": "http://localhost:5173/signup", "srcLoc": "src/Signup.jsx:42" },
  "shapes": [ { "type": "arrow", "points": [[-0.5, -1.2], [0.5, 0.5]], "color": "red" } ],
  "viewport": { "w": 1440, "h": 900, "dpr": 2 },
  "page": { "x": 312, "y": 1180, "w": 240, "h": 96 },
  "route": "visual-edit"
}
```

| Field | Rule (server-enforced in `annotation-schema.js`; client mirrors the caps) |
|---|---|
| `target.origin` | `"canvas"` or `"app"`. **Set by the server from the endpoint**, never taken from the body: `/api/session/<key>/feedback` → `canvas`, `/api/annotate/<key>` → `app` |
| `target.url` | `app`: parsed with `URL`, must be `http:`, host `127.0.0.1`/`localhost`/`[::1]`, port 1024-65535, origin equal to the token's bound origin; output `origin + pathname` only (query, hash, userinfo dropped), ≤300 chars; else replaced by the bound origin. `canvas`: always `null` |
| `target.srcLoc` | optional, `app` only, read client-side from the nearest `[data-aos-src]`; same rule as `cleanSrcLoc` in `bdb-visual-edit/scripts/sanitize-element.mjs` (`relative/path.ext:line`, no `..`, absolute, hidden, `node_modules`, scheme); invalid → field omitted |
| `anchor` | required (as today). `selector`≤500, `tag` must match `^[a-z][a-z0-9-]{0,59}$` or equal `text`, `snippet`≤400 (client sends ≤200), `textRange.text`≤1000, `classes` ≤12 entries matching `^[A-Za-z0-9_-]{1,64}$` (others dropped) |
| `shapes` | optional array, 1-16 entries. Absent = element (or text when `anchor.textRange` exists): every existing item stays valid |
| `shapes[].type` | `element` (no points), `text` (no points; uses `anchor.textRange`), `rect` (2 points: corners), `arrow` (2 points: tail, head; `anchor` = element under the head), `freehand` (2-512 points polyline), `blur` (2 points: corners), `comment` (1 point: pin) |
| `shapes[].points` | **anchor-relative units**: `x = (pageX - box.left)/box.width`, `y = (pageY - box.top)/box.height` of the anchor element's bounding box at capture; finite numbers, rounded to 4 decimals, clamped to [-4, 5]; ≤2048 points per item in total. Viewport- and scroll-independent; the agent re-projects on any width |
| `shapes[].color` | optional enum `red`, `yellow`, `blue`, `green`; else dropped |
| `viewport` | `{w,h}` integers 1-100000, `dpr` 0.5-8; optional context only |
| `page` | document-px bbox of the whole annotation, integers clamped to [0, 100000] (same limit as `BBOX_LIMIT`); optional |
| `blur` meaning | the client masks the region on screen and **does not capture** `snippet`/`textRange` of any element fully inside it; the server stores the rect only. No screenshots are ever sent |

**Sanitizing (all string fields):** strip C0/C1 control chars and bidi/zero-width chars (`\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩`), then truncate. Unknown keys are dropped (whitelist output), `__proto__`/`constructor` keys have no effect, non-string/non-number types are dropped, never coerced. The CJS port of the regexes lives in `annotation-schema.js`; a parity test runs the same corpus through it and through `sanitize-element.mjs`. All rendering of item data (chat, queue pills, home page, toolbar) uses `textContent`/`escapeHtml`; never `innerHTML` with item data.

**Caps per request/session:** ≤20 items per POST, ≤200 pending items per session (`429 queue_full`), annotate body ≤256 KiB (canvas `/feedback` keeps `MAX_BODY_BYTES` 1 MiB). The app endpoint accepts `kind:"annotation"` only; `chat`/`verdict` items are dropped and counted in `rejected` (approval can never come from an app page).

Chat transcript line (`chatLineFor`): canvas unchanged `[snippet] text`; app `[app <pathname>] [snippet] text`; a `shapes` summary `(arrow, rect)` is appended when shapes exist.

## 2. `route`

Added per item by the CLI in `cmdAwait`, after the HTTP response, via a pure function in `PC/lib/plan-canvas/route.js`:

```js
routeFor(item, { planHasComponents }) // -> 'artifact' | 'visual-edit' | 'build'
```

| # | Condition (first match wins) | route |
|---|---|---|
| 1 | `kind==="annotation" && target?.origin==="app"` | `visual-edit` |
| 2 | `kind==="verdict" && verdict==="approve" && planHasComponents` | `build` |
| 3 | anything else (`chat`, canvas annotations, `request-changes`, approve on a plan without components, items with no `target`) | `artifact` |

`planHasComponents` = `planComponents(session.file).length > 0` from `trail-on-approve.js` (section 5). Backward compatibility: `route` is a new key on each item; `status`, `items`, `sessionEnded`, `endedBy`, `next_step` are unchanged; `/api/await` over HTTP stays byte-compatible (route is added by the CLI only). When any item routes to `visual-edit` or `build`, `next_step` gets one extra sentence: `visual-edit` → "hand these items to bdb-visual-edit (diff plan, wait for a yes in the canvas, then edit one file)"; `build` → "the plan is approved: continue with the build pipeline; agenttrail was started by the canvas". Delivery to other sessions stays on `aos-bus`; no new channel.

## 3. HTTP surface (V2a)

All new routes are handled by `annotate-server.js`. `server.js` dispatches to it **after the Host check and before the Origin/fetch-site checks** when `pathname === '/annotate.js'` or starts with `/api/annotate/`. Every other route keeps today's gate unchanged.

| Method + path | Caller | Checks | Response |
|---|---|---|---|
| `GET /annotate.js` (`?v=<VERSION>` optional, ignored) | `<script>` in the dev app | Host only (classic script loads send no Origin; a module script would) | static JS, no secrets. Headers: `content-type: text/javascript; charset=utf-8`, `cache-control: no-cache`, `x-content-type-options: nosniff`, `cross-origin-resource-policy: cross-origin`, `x-aos-annotate-version: <VERSION>` |
| `POST /api/annotate/<key>/token` body `{origin, ttlMs?}` | CLI only | 403 if the request has an `Origin` **or** a `Sec-Fetch-Site` header (browsers always send one); `origin` must be `http://(127.0.0.1\|localhost\|[::1]):<1024-65535>` with nothing after the port (400 `bad_origin`); session exists and not ended (404/409) | `{token, origin, expiresAt, scriptTag, bookmarklet}` |
| `OPTIONS /api/annotate/<key>` | browser preflight | `Origin` equals the session's bound origin (an expired token still passes, so the following POST can answer a readable 401 `token_expired`) | 204 + CORS headers; else 403 without CORS headers |
| `POST /api/annotate/<key>` | `/annotate.js` | see order below | 200 `{status:"queued", accepted, rejected, pending}` |

**Token.** `crypto.randomBytes(32).toString('base64url')`. Stored in the session as `annotate:{tokenSha256, origin, createdAt, expiresAt}` (never the raw token, so `sessions.json` leaks nothing usable). One active token per session; a new `/token` call rotates it. TTL default 8 h, max 24 h, survives server restarts (persisted), invalid once the session ends; a reopened session needs a new token. Compare with `crypto.timingSafeEqual` on the SHA-256 digests. Sent as header `X-AOS-Annotate-Token`. The script reads `data-session` and `data-token` from `document.currentScript`, keeps the token in a closure, never writes it to storage, never puts it in a URL.

**POST order and codes** (body `{error, code}`): 404 `unknown_session` → 401 `no_token` → 401 `token` when the session has no token record (there is no bound origin to compare, so no 403 is possible) → 401 `token_expired` → 403 `origin` (Origin missing or not equal to bound origin) → 401 `token` → 429 `rate` (`Retry-After`, 60 POSTs/min per session, in-memory token bucket) → 415 `content_type` (must be `application/json`) → 413 `too_large` (>256 KiB, stream aborted) → 400 `json` → 400 `items` (not an array of 1-20) → 409 `ended` → 429 `queue_full`. Every response to the bound origin, including the 401 token errors, carries the CORS headers so the page can read the error; any other origin gets none.

**CORS** (only on `/api/annotate/<key>`): `Access-Control-Allow-Origin: <exact bound origin>` (never `*`), `Vary: Origin`, `Access-Control-Allow-Methods: POST`, `Access-Control-Allow-Headers: content-type, x-aos-annotate-token`, `Access-Control-Max-Age: 600`, no `Allow-Credentials`. If a preflight carries `Access-Control-Request-Private-Network: true`, answer `Access-Control-Allow-Private-Network: true` for the bound origin only.

**Side effects of an accepted POST:** identical to `/feedback`: `wake.emit('wake:<key>')`, `broadcast(key,'chat-sync',...)`, `broadcastPresence(key)`. `server.js` passes these in.

**CSP of the target app:** with a strict CSP the app must allow `script-src http://127.0.0.1:4519` and `connect-src http://127.0.0.1:4519` in dev; the bookmarklet only helps when the human cannot edit `index.html`, not against CSP. Vite dev serves no CSP by default (**UNVERIFIED** for every template, see section 11).

**CLI** (`plan-canvas.js`, V2a region): `aos-plan-canvas annotate <app-url> [--session <file>] [--ttl-ms <n>]`. Without `--session` it writes `production_artifacts/canvas-annotations/<host>-<port>.md` (one heading: "Annotations for <origin>") under cwd if missing, opens a session on it (normal `open` path, `--no-open` respected), calls `/token`, prints `{status:"ready", url, scriptTag, bookmarklet, expiresAt, next_step}`. `scriptTag` = `<script src="http://127.0.0.1:<port>/annotate.js?v=<VERSION>" data-session="<key>" data-token="<token>"></script>`. Add `/api/annotate/<key>/token` to the CLI's `validateRequestPath` allowlist.

**Module interface:**

```js
// PC/lib/plan-canvas/annotation-schema.js (CJS, pure)
normalizeAnnotation(raw, { origin, boundOrigin }) // -> item fields or null
cleanText(value, max)                              // strip + truncate
// PC/lib/plan-canvas/annotate-server.js
createAnnotateHandler({ store, version, onQueued /* (key)=>void */, now = Date.now, log })
  // -> { handles(pathname): boolean, handle(req, res, url): Promise<void>, issueToken(key, origin, ttlMs) }
```

`sessions.js`: `normalizeFeedbackItem(raw, counter, ctx)` delegates `kind:"annotation"` to `normalizeAnnotation`; `queueFeedback(key, items, { endSession, origin = 'canvas', boundOrigin })`; new `setAnnotateToken(key, record)` / `getAnnotateToken(key)`. `list()` output unchanged.

## 4. Client drawing layer (V2b) vs server (V2a)

Pattern stays as today: Node modules return JS source strings that the server serves; nothing is bundled at build time; no third-party code (no `bug-reporting-tool`, no `agentecho`).

| File | Exports | Content |
|---|---|---|
| `PC/lib/plan-canvas/annotate-client/geometry.js` | `toAnchorUnits(pt, box)`, `fromAnchorUnits(pt, box)`, `simplify(points, eps=0.002)` (Ramer-Douglas-Peucker), `clampPoint`, `roundPoint` | pure functions, unit-tested in Node, inlined into the bundle with `fn.toString()` |
| `.../annotate-client/toolbar.js` | `toolbarCss()`, `toolbarHtml()` | static markup only (no data interpolation) for the shadow-root toolbar, card and the app-mode mini queue |
| `.../annotate-client/index.js` | `annotateClientJs({ transport: 'postMessage' \| 'fetch', version })` | assembles the layer; both hosts get the same tools |
| `PC/lib/plan-canvas/sdk.js` | `artifactSdkJs()` (unchanged name) | returns `annotateClientJs({transport:'postMessage'})`; keeps the `window.parent === window` guard |
| `annotate-server.js` (V2a) | serves `annotateClientJs({transport:'fetch', version})` at `/annotate.js` | |

**Layer behaviour (both hosts):** shadow root (`mode:'open'`), SVG overlay in document coordinates, tools `element` (V), `text` (T), `rect` (R), `arrow` (A), `freehand` (F), `blur` (B), `comment` (C); Esc cancels, Cmd/Ctrl+Z undoes the last unqueued shape, Enter queues, Cmd/Ctrl+Enter queues and sends. Toggle: Cmd/Ctrl+I in the canvas (as today), Alt+Shift+A in an app (does not collide with app shortcuts); tool keys are live only while the layer is on. Form controls (`input`, `textarea`, `select`, contenteditable) never contribute `snippet`; values, cookies and storage are never read. SVG nodes are built with `createElementNS` + numeric `setAttribute`; text only via `textContent`.

**postMessage (canvas):** existing messages unchanged; `pc:queue`/`pc:queue-and-send` carry the section-1 item minus server-set fields (`id`, `at`, `target.origin`, `route`). New, optional: chrome→iframe `pc:set-tool{tool}`, iframe→chrome `pc:tool{tool}`. The chrome keeps `e.source === frame.contentWindow` and ignores unknown `type`s.

**fetch (app):** POST `/api/annotate/<key>` per section 3; the layer shows its own mini queue and Send button; on 401/403 it shows "canvas link expired: run `aos-plan-canvas annotate <url>` again" and drops nothing from its in-memory queue.

**Canvas page (`ui.js`):** only `renderQueue` (pill shows shape summary + `where`) and the message handler block change; no new toolbar in the chrome (the layer brings its own).

## 5. Approve → `aos-trail --ensure` (V4)

`PC/lib/plan-canvas/trail-on-approve.js`:

```js
planComponents(file)                              // -> string[] of component ids
ensureTrailOnApprove({ file, key, log, spawnImpl = child_process.spawn, env = process.env }) // -> void, never throws
```

| Rule | Value |
|---|---|
| Trigger | a `/api/session/<key>/feedback` batch whose accepted items contain `kind:"verdict", verdict:"approve"`. Only the canvas endpoint can carry verdicts |
| Plan detection | `.md`/`.markdown` file: ids from the `ensure` marker regex. `plan.builder.html`: `derive(dirname(file)).graph` ids from `PC/lib/plan-builder/trail.js`. Anything else: `[]` → nothing happens |
| Repo path | `git rev-parse --show-toplevel` (`spawnSync`, `shell:false`, `cwd: dirname(file)`, 1 s timeout), else `dirname(file)` |
| Plan arg | md → `--plan <file>`. builder → if `<repo>/production_artifacts/00_execution_plan.md` is missing, `writeTrail(dir, { workspaceRoot: repo })` (no `--force`, never overwrites); then `--plan` that file; on `TrailError` call `ensure` without `--plan` (its own selection) |
| Binary | `AOS_PLAN_CANVAS_TRAIL_BIN` if set (tests), else `path.resolve(__dirname, '../../../../agenttrail/bin/agenttrail.mjs')` run with `process.execPath`; if missing and not win32, `aos-trail` from PATH; else log `agenttrail not installed` and return |
| Spawn | argv `['--ensure','--cwd',repo,'--plan',plan,'--session','plan-canvas-<key>','--json']`, `shell:false`, `detached:true`, `stdio` → `server.log`, killed after 10 s; not awaited in the request path |
| Off switch | `AOS_PLAN_CANVAS_TRAIL=off` |
| Failure | never changes the HTTP response, the queue or the verdict; one log line `[plan-canvas] trail: <reason>` |
| Idempotency | `ensure` reuses the repo's running map (`started:false`) and opens the browser at most once per `--session` id, so a second approve starts nothing and opens nothing |

Call site (V4 adds exactly these two lines to the `feedback` branch of `server.js handleApi`, after `broadcastPresence(key)`): `const { ensureTrailOnApprove } = require('./trail-on-approve');` at the top of the file, and `if (result.accepted.some(i => i.kind === 'verdict' && i.verdict === 'approve')) ensureTrailOnApprove({ file: session.file, key, log });`.

## 6. Stable link (V5)

| Item | Contract |
|---|---|
| Revive | verified: same key after restart; `open <file>` restarts the server and resumes. V5 adds a test, not a mechanism |
| Idempotent `open` | `POST /api/sessions` response gains `resumed:boolean` (session existed) and `viewers:number` (SSE clients for the key). The CLI does not launch a browser when `viewers > 0`; output gains `resumed`, `viewers`, `browser:"already open"` |
| Home page | lists every session (already does); ended sessions get a "Resume" button: `<form method="post" action="/api/session/<key>/resume">`, still no `<script>` on the page. The global gate already requires same-origin, so a foreign page cannot post it. `resume` = `store.open(file,{reopen:true})` + `watchSession` + 303 to `/canvas/<key>`; 404 if the file no longer exists |
| Port | 4519 is the documented fixed default (`SKILL.md` section "Stable links"); `AOS_PLAN_CANVAS_PORT` stays the only override |
| Must NOT change | default port, the key derivation, the `sessions.json` layout (new keys only), the user-ended refusal for agents (`open` without `--reopen` still 409), idle timeout default, the CLI JSON of `await`/`pending`/`end`, no launchd/login service (separate GO) |

## 7. bdb-visual-edit as `visual-edit` handler (V3)

| Step | Contract |
|---|---|
| Input | one `await` item with `route:"visual-edit"` plus the canvas file it came from. `item.text` is `human_text`; everything else (`anchor`, `target`, `shapes`) is `untrusted_page_data` |
| Sanitize | new export `fromAnnotation(item)` in `sanitize-element.mjs` maps to `{tag: anchor.tag, classes: anchor.classes, srcLoc: target.srcLoc, selector: anchor.selector, bbox: page}` and runs `sanitizeElement`; `toEnvelope(clean, item.text)` |
| Locate | `srcLoc` present and `resolveSrcLoc` passes (inside git root, tracked) → `confidence:"exact"`. Otherwise new `scripts/locate-source.mjs` (`locateSource({anchor}, {root}) → {confidence, candidates:[{file, line, score, why}]}`, CLI reads the item JSON on stdin) |
| Search (no `data-aos-src`) | files: `git ls-files -z` (fixed argv, `shell:false`), extensions `.jsx .tsx .js .ts .vue .svelte .astro .html .mdx`, skip `node_modules`, `dist`, `build`, files >512 KiB, stop after 5000 files. Per line: +3 if it contains `snippet` literally (`String.includes`, never a regex from page data, snippet ≥3 chars), +1 per sanitized class name found on the line, +1 if the line contains `<` + tag. Top 3 with score ≥3 |
| Confidence | `likely`: exactly one top candidate with a snippet hit plus ≥1 class hit and ≥2 points ahead of the next; `ambiguous`: anything else with candidates; `none`: no candidates |
| Diff plan | posted with `aos-plan-canvas await <file> --reply "<plan>"`: file, line, change, why, `confidence`, and the candidate list when not `exact`. For `likely`/`ambiguous` the human must name the file ("yes, 1"); `none` → ask, never guess |
| Approval | proceed only on a following `await` batch with a **canvas-origin** item: `chat` with an explicit yes or `verdict:"approve"`. App-origin items never count as approval |
| Edit | one file, the approved one; then reply what changed and what was not verified; a second file needs a new plan and a new yes |
| Removed | `scripts/pick-snippet.js`, capture path A (chrome-devtools, dedicated Chrome profile) and its tests; SKILL.md no longer mentions chrome-devtools. Capture path B (pasted pin JSON) stays as fallback. Rule 6 becomes: never read input values, cookies or storage; the ≤200-char visible `snippet` is untrusted page data |
| Kept | `sanitize-element.mjs`, `resolveSrcLoc`, `references/vite-react-source-attr.md` (`data-aos-src` stays the precise path) |

## 8. Deletions and references (V1)

Delete: `skills/global_config/visual-edit/`, `skills/global_config/visual-plan/`, `skills/global_config/visual-recap/` (15 tracked files). `plan-arbiter` stays (no agent-native reference).

| File:line | Fix |
|---|---|
| `plugin-commands.json:61,66` | drop `visual-plan` from `plan.skills`; body: "Plan Builder (`aos-plan-canvas open <dir> --mode bdb-plan-builder`)" instead of "Plan Builder (`visual-plan`)" |
| `commands/plan.md:5`, `.opencode/commands/bdb-aos-plan.md:5`, `plugins/bdb-aos-codex/skills/plan/SKILL.md:6`, `plugin.json:225-227`, `.claude-plugin/plugin.json:226-228`, `plugins/bdb-aos/plugin.json:225-227`, `plugins/bdb-aos/.claude-plugin/plugin.json:226-228` | regenerate with `npm run plugin:build`, never hand-edit; `npm run plugin:check` must pass |
| `skills.sh.json:97,127,128` | remove the three names |
| `THIRD_PARTY_NOTICES.md:312,321` | "Eight skills", drop the three names; delete the "In the three visual skills ..." paragraph start up to "are **not** vendored." and keep the rest of the not-vendored note (it documents why the plugin surface is refused) |
| `CHANGELOG.md:52,54` | unchanged (history) |
| `skills/playbooks/pb-ship/SKILL.md:13,36`, `pb-release-aos/SKILL.md:13,36`, `pb-worktrees-land/SKILL.md:13,42` | `visual-recap` → `pr-recap` (step text: recap file from `pr-recap`; fallback line unchanged in shape) |
| `skills/playbooks/pb-idea-to-launch/SKILL.md:13,36`, `pb-redesign-app/SKILL.md:14,36` | `visual-plan` → `plan-canvas` (Plan Builder mode) |
| `skills/playbooks/pb-redesign-app/SKILL.md:14,38` | `visual-edit` → `bdb-visual-edit` (annotate in the running app via `aos-plan-canvas annotate`) |
| `skills/global_config/plan-arbiter/SKILL.md:29` | "visual-plan links" → "plan-canvas links" |
| `PC/plan-canvas.js:280-290` | delete the `builder` mode from `resolveModes`; `--mode builder` then fails as "Unknown mode" (exit 2) |
| `skills/global_config/plan-canvas/SKILL.md:247` | drop the `builder` mode sentence |
| `PC/lib/plan-canvas/ui.js:627` | `VISUAL_SKILLS = ['bdb-visual-edit','pr-recap','prototype','archify','agenttrail']` (`visual-review` does not exist either) |
| `PC/lib/plan-builder/README.md:52`, `render.js:94,647` | "the Plan Builder block registry" instead of the skill names |
| `tests/plan-canvas-modes.test.mjs:80-115` | remove the `builder`-mode tests; add one asserting `builder` is not listed |
| `tests/plan-canvas-home.test.mjs:68` | assert on `bdb-visual-edit` instead of `visual-plan` |
| `tests/bdb-visual-edit.test.mjs:335-338` | invert: the three dirs must not exist |

"Agent-Native-style" in `plan-canvas/SKILL.md:251`, `plan-builder/{README.md:3,index.js:4,mdx.js:4}` names a file format, not the site; it stays.

**Installer migration.** New `lib/retired-skills.js` (pure, every path from a `home` parameter, like `plugin-migration.js`): `RETIRED_SKILLS = { bdbsaastraining:'4.4.2', 'bdb-dev-os-skill':'4.4.2', bdbsaashost:'4.4.2', 'bdb-ecosystem-health':'4.4.2', 'bdbsaas-ops':'4.4.2', 'visual-edit':'<next>', 'visual-plan':'<next>', 'visual-recap':'<next>' }` and `pruneRetiredSkills({ home, manifest, roots, backupDir, log }) → { removed, backedUp }`. Files whose hash matches the manifest are deleted; edited files are **copied to `backupDir/<path relative to home>` before** the dir is removed (fixes the bug in section 0); `backupDir = ~/.agents/backups/retired-skills-<stamp>`. Manifest entries are deleted. Only manifest-listed paths under the six `globalSkillDestRoots()` are touched; nothing the installer did not write. `installer.js` keeps its two call sites, replacing `pruneRemovedSkills` with the module call.

**Acceptance test** `tests/no-builderio-visual.test.mjs`:
1. "no tracked file under skills/ contains `agent-native.com`" (`git ls-files skills`, case-insensitive).
2. "the three BuilderIO visual skill dirs are gone".
3. "no tracked file outside CHANGELOG.md, installer.js, lib/retired-skills.js and this test names visual-edit, visual-plan or visual-recap" (regex `(^|[^-\w])visual-(edit|plan|recap)([^-\w]|$)`).
4. `tests/retired-skills.test.mjs` (temp HOME): untouched copy removed; edited copy survives in `backupDir`; manifest entries gone; a non-manifest file in the same dir is backed up, not lost.

## 9. File ownership

Only the dispatcher edits `package.json` (test script; builders list their new test files in the handback) and bumps `VERSION` in `PC/plan-canvas.js` plus `metadata.version` in `plan-canvas/SKILL.md` to `1.1.0` at integration. Merge order: V1 → V2a → V2b → V4 → V5 → V3 → W3; a later builder rebases on the earlier ones.

| Builder | Exclusive files | Shared file: allowed region only |
|---|---|---|
| V1 | the three deleted dirs; every file in the section-8 table except those named for others below; `lib/retired-skills.js`; `installer.js:686-768` + the two call sites; `tests/no-builderio-visual.test.mjs`, `tests/retired-skills.test.mjs`; `tests/plan-canvas-modes.test.mjs` | `plan-canvas.js`: `resolveModes()`. `ui.js`: `VISUAL_SKILLS` line. `plan-canvas/SKILL.md`: line 247. `tests/plan-canvas-home.test.mjs`: line 68. `tests/bdb-visual-edit.test.mjs`: lines 335-338 |
| V2a | `annotate-server.js`, `annotation-schema.js`, `sessions.js`, `loopback-guard.js`; `tests/plan-canvas-annotate-server.test.mjs`, `tests/plan-canvas-annotation-schema.test.mjs` | `server.js`: everything except the V4 lines and V5 regions. `plan-canvas.js`: `validateRequestPath` allowlist, new `cmdAnnotate`, one dispatch line, one usage line. `SKILL.md`: new section "Annotate a running app" |
| V2b | `annotate-client/*`, `sdk.js`; `tests/plan-canvas-annotate-client.test.mjs` | `ui.js`: `canvasClientJs` → `renderQueue` and the `window.addEventListener('message', ...)` block; `canvasCss` pill rules |
| V4 | `trail-on-approve.js`; `tests/plan-canvas-trail-on-approve.test.mjs` | `server.js`: the require line + the one call in the `feedback` branch (section 5) |
| V5 | `tests/plan-canvas-revive.test.mjs` | `server.js`: `POST /api/sessions` response, `GET /`, the `sessionMatch` regex + new `resume` branch. `ui.js`: `renderHomeHtml`, `sessionCard`, `HOME_CSS`. `plan-canvas.js`: `cmdOpen`, `cmdStatus`, port text in `usage()`. `SKILL.md`: section "Stable links". `tests/plan-canvas-home.test.mjs` except line 68 |
| V3 (wave 2) | `route.js`; `skills/global_config/bdb-visual-edit/**`; `tests/plan-canvas-route.test.mjs`, `tests/bdb-visual-edit-locate.test.mjs`; `tests/bdb-visual-edit.test.mjs` except V1's lines | `plan-canvas.js`: `cmdAwait`. `SKILL.md`: section "Routes" |
| W3 | `tests/plan-canvas-e2e-app.test.mjs`, `tests/fixtures/vite-react-app/**` | none |

## 10. Test plan

All tests: `node --test`, temp `HOME`/`AOS_PLAN_CANVAS_STATE_DIR`, `listen(0)`, `idleTimeoutMs:0`, temp dirs removed in `after`.

| Component | Must prove |
|---|---|
| V2a schema | every section-1 cap and clamp; unknown keys dropped; `__proto__` inert; control/bidi stripped; parity corpus with `sanitize-element.mjs`; `target.origin` from the body is ignored; old-shape annotation (no `shapes`/`target`) still accepted |
| V2a HTTP | `/annotate.js` served cross-site without Origin, carries CORP/nosniff/version headers, contains no token; `/token` refused with any `Origin` or `Sec-Fetch-Site` (403), refused for non-loopback, `https:`, port <1024 or a path (400); POST with the right token+origin → 200 and the item reaches `await` with `target.origin:"app"`; **negative**: no token 401, wrong token 401, expired token 401 (injected `now`), token of another session 401, foreign origin (`http://localhost:5174`, `http://evil.test`, `null`) 403, rotated old token 401, preflight from a foreign origin 403 with no ACAO header, ACAO never `*`, chat/verdict items rejected, 21 items 400, 257 KiB 413, 61st POST/min 429, 201st pending 429, ended session 409; the global gate still refuses cross-site on all non-annotate routes (existing security tests stay green) |
| XSS | annotation `text`/`snippet`/`selector`/class/url containing `<img src=x onerror=alert(1)>`, `</script>`, `javascript:` round-trips as inert text: absent from `/canvas/<key>` boot JSON as raw `<` (escaped `<`), home page has no `<script`, `chatLineFor` output rendered via `textContent` (string scan of `client.js`: no `innerHTML =` with item data); `target.url` with `javascript:` is replaced by the bound origin |
| V2b client | geometry round-trip `fromAnchorUnits(toAnchorUnits(p,b),b) ≈ p`; `simplify` keeps endpoints and caps at 512; clamp/round; `annotateClientJs` for both transports passes `node --check`; bundle scan: no `eval`, `new Function`, `innerHTML` with variables, `localStorage`/`sessionStorage`/`document.cookie`, `.value` reads, fetch to anything but the canvas origin; postMessage handler ignores unknown types |
| V4 | fixture md plan with `{#id}`: approve → `ensure` spawned with the section-5 argv (fake `spawnImpl`); plan without markers → no spawn; real run with `AOS_TRAIL_PORTS` + `AOS_TRAIL_OPENER` stub: first approve `started:true`, second `started:false` and no second open; spawn error → feedback still 200 and queued; `AOS_PLAN_CANVAS_TRAIL=off` → no spawn; builder folder writes `00_execution_plan.md` only when missing |
| V5 | open → stop → open gives the same key and URL; queued feedback survives the restart; second `open` with an SSE client attached does not launch a browser and reports `resumed:true`; user-ended session: CLI `open` 409, home Resume form → 303 and status `open`; cross-site POST to `/resume` 403 |
| V3 | `routeFor` truth table (all section-2 rows); `await` output keeps old keys; `fromAnnotation` drops hostile fields; `locateSource` on a temp git repo: `exact` with `data-aos-src`, `likely` with unique text+class, `ambiguous` with two equal hits, `none`; snippet with regex metachars (`.*(`) does not match everything; untracked file never returned |
| V1 | section-8 acceptance tests; `npm run plugin:check`, `npm run validate` green |
| W3 e2e | fixture `tests/fixtures/vite-react-app/` = tiny `src/App.jsx` (one button with `data-aos-src`, one without) + prebuilt `index.html`, served by a Node loopback server, copied into a temp git repo. Flow over HTTP (no browser deps): `annotate` CLI → fetch `/annotate.js` → POST an arrow + rect + freehand item with the fixture origin → `await` returns `route:"visual-edit"`, shapes intact → `locateSource` returns `src/App.jsx:<line>` (`exact` and `likely` cases) → approve verdict on a component plan returns `route:"build"`. Real Vite + real browser, no chrome-devtools: manual/opt-in run (`AOS_E2E_BROWSER=1`) in a throwaway folder, not in `npm test` |

## 11. Open questions (UNVERIFIED, with defaults)

| # | Question | Default |
|---|---|---|
| 1 | Do current `npm create vite` React templates ship a dev CSP? | assume none; document the two CSP directives (section 3); W3 checks once by hand |
| 2 | Does Chrome send a Private-Network-Access preflight for `localhost:5173` → `127.0.0.1:4519`? | implement the conditional header (section 3); harmless if never asked |
| 3 | The server's `workspaceRoot` is the first starter's cwd, so `open`/`annotate` from a second repo gets 403 | out of scope; V5 turns the 403 into a hint (`aos-plan-canvas stop`, then `open` from the new repo). Multi-root needs its own design |
| 4 | Is there any source location in React 19 dev builds without a plugin? | no (React 19 removed `_debugSource`); `data-aos-src` or the search |
| 5 | Is the `pruneRemovedSkills` backup loss real at runtime? | treat as real (code path is unambiguous); V1's test proves the fix |
| 6 | Is writing `production_artifacts/00_execution_plan.md` on approve of a builder plan acceptable? | yes, only when missing, never overwrite |
| 7 | Next release number for `RETIRED_SKILLS` | dispatcher fills it from release-please at integration |
| 8 | Should `annotate` without `--session` create a file under `production_artifacts/`? | yes (smallest change that reuses the file-keyed session model); alternative is a synthetic session, rejected as a model change |
