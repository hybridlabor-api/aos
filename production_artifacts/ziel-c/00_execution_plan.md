# Ziel C: A2A delegation layer, /startcycle run with OpenCode workers

**Goal.** Every harness session (Claude Code, OpenCode, agy, Codex, Cursor, Kimi, AO) can reach the others over A2A on localhost. Any harness can act as orchestrator or as worker. Roles are set per run through a profile. Delegation goes through one CLI, `aos-a2a`. mcsc becomes a shim and is removed later.

**Source of truth.** The design lives in `~/.aos/recovery-plan/ziel-c-plan-v2.md`, sections 2–9 and decisions §11. This file is the build plan that executes it.

**Branch.** `feat/ziel-c-phase1` in `~/dev/bdb-dev/aos-wt-zielc` (base origin/main 4.19.0). Done so far:
- `22887ff`: registry, card, `aos-a2a list/card`
- spikes p0 and p1b: green, in the scratch dir
- spikes p2a and p2b: built, not run (blocked on the go-gate, see §0)

**Scope (freeze, rule 15, `~/.aos/briefs/00_focus.md` block 4).** This run delivers only what is needed for this: **phase 2 done, two different harnesses (OpenCode + Claude) exchange a message via A2A, shipped in AOS v5.** In scope:
- `#p2-checks`
- `#a2a-cli`
- `#live-adapters`
- `#install` (hook + installer + doctor for the A2A sidecar only)
- `#docs` (A2A part only)
- `#review`
- `#ship`

Everything marked **LATER** goes to the focus file's "Later" section and is not built in this run: spawn mode, scoped permissions, GO-over-A2A resume, mcsc shim, AO status replacement, agy/Codex. The "an A2A message never counts as GO" rule is in scope; it is part of `#live-adapters`.

**Pipeline.** This is a `/startcycle` run, linear, with no `state.json`. Roles:

| startcycle step | Who | Model |
|---|---|---|
| 1. Architect | this file (orchestrator session) | — |
| 2. TechLead gate | Claude subagent `techlead` | sonnet |
| 3. Build | **OpenCode worker** via `aos-acp`, one work package at a time | local OpenCode default per rule 13 |
| 3. Build (fallback) | Claude subagent `godmode-engineering`, only if a package fails twice or aos-acp is blocked | sonnet |
| 4. Reviewer | Claude subagent `reviewer` | sonnet |
| 5. Shipping | `godmode-shipping`, **only after Tim's GO**, bundled per rule 14 | sonnet; final security review opus |

---

## 0. Run protocol for the dispatcher (read before every package)

The dispatcher is the orchestrator session. Agents never invoke each other; the dispatcher decides every next step.

### 0.1 Dispatch one work package
1. Copy the package's **Worker prompt** block plus the **standard preamble** (0.3) into `<scratch>/ziel-c/wp-<id>.md` using the Write tool.
2. Start the OpenCode worker with the local invocation from rule 13 in `~/.aos/briefs/00_rules.md`: `aos-acp opencode --name zielc-<id> --cwd <scratch>/ziel-c/cwd --prompt-file … --allow-default allow --go-wait 600 --timeout 1800 --log <scratch>/ziel-c/wp-<id>.jsonl`.
   - `--cwd` must be a **scratch dir, never `aos-wt-*`**. A linked worktree as cwd fails with `-32603 OpenCode service failure`.
   - The worker edits the worktree through absolute paths.
   - The proxy and model prefix is local to Tim's Mac. It never goes into repo files, docs, tests or the installer.
3. Run it in the background. Max **1 OpenCode + 1 Claude worker** at a time.
4. When it finishes, the dispatcher:
   - reads the worker's final answer
   - runs the package **Check** (tests in Docker, 0.2)
   - reviews the diff (`git -C <wt> diff --stat`, then read it)
   - commits locally with Conventional Commits and the co-author line
   - marks the task `[x]` in this file
5. A failed check gets one repair round with the same worker and the failing output appended to the prompt. A second failure falls back to the sonnet builder. After that it escalates to the master session.
6. If any command is blocked (go-gate, classifier): stop and report to the master session (rule 3). Never rerun in another form.

### 0.2 Tests: only in Docker
Host-side `node --test` is blocked by the go-gate, because test cleanup looks destructive. All test runs therefore use:
```
docker run --rm -v ~/dev/bdb-dev/aos-wt-zielc:/src:ro -e AOS_TEST_SANDBOX=container node:24-bookworm \
  bash -c 'mkdir /w && cd /src && tar --exclude=node_modules --exclude=.git -cf - . | tar -xf - -C /w && cd /w && git init -q && npm ci --ignore-scripts && <TEST CMD>'
```
`<TEST CMD>` is the package's check, then `npm test` before every commit.

Live checks that need real harness processes (p2a, p2b, p3, p4) run on the host. They need a GO token for this session ("GO acp - multi cli tool Manager"), because the go-gate blocks freshly written scripts.

### 0.3 Standard preamble (prepend verbatim to every worker prompt)
```
RULES (verbatim from ~/.aos/briefs/00_rules.md, binding):
2. Kein Subagent löscht etwas. Nie rekursiv löschen über Pfade aus $HOME oder Umgebungsvariablen (rm mit -r, rmSync, fs.rm, shutil.rmtree, find -delete). Test-HOME nur inline im selben Befehl und nur unter /private/tmp/claude-501/... oder als lokaler Nutzer `test`.
3. Ein blockierter Befehl heißt: anhalten und an "master session" melden. Nie einen anderen Weg suchen.
12. Worker ändern nur, was im Auftrag steht: keine Installationen (brew, npm -g, pip ausserhalb eines Projekt-venv), keine Entfernungen ausser den ausdrücklich genannten Dateien, keine "Aufräumarbeiten" nebenbei. Im Zweifel melden.
Extra: edit only the files listed under "Files" (absolute paths under /Users/timrennings/dev/bdb-dev/aos-wt-zielc). Use your edit/write tool, never shell redirection, sed or heredoc. Do not run node --test, npm test, git commit or git push; the dispatcher does that. Never read or touch ~/.aos/go or ~/.aos/gate. Never touch ~/.claude, ~/.config, ~/.gemini, ~/.codex. If a tool call is denied: stop and say so. Match the style of the files named under "Read first" (plain Node ESM, node:test, no new deps unless the package says so). Final answer: files changed, what you did, open doubts.
```

### 0.4 Live map
`aos-trail --ensure --cwd ~/dev/bdb-dev/aos-wt-zielc --plan production_artifacts/ziel-c/00_execution_plan.md`. Send the URL to the master session and TASK MANAGER. Workers' task states are set by the dispatcher (`[~]` before dispatch, `[x]`/`[!]` after the check).

---

## 1. Decisions for the TechLead gate (and Tim where marked)

- **D1, SDK dependency.** `@a2a-js/sdk@1.3.x` + `express` become regular `dependencies` of `@hybridlabor-api/aos`. **Recommendation:** yes, but loaded only by `bin/aos-a2a.mjs serve/send` via a lazy `import()`, with a clear error. Installer and other bins keep zero new load cost. Footprint is about 70 packages (spike0 measured).
- **D2, sidecar lifetime.** Started by each harness's session-start hook and dies with the session (Tim §11.4). No LaunchAgent.
- **D3, token location.** Separate `<name>.token` (0600), as implemented in `22887ff`.
- **D4, live reply channel.**
  - OpenCode reads the reply via its HTTP API (p2a design).
  - Claude replies via `aos-a2a reply <taskId>`, allowed by exactly one `permissions.allow` rule (p2b design).
- **D5, agy scoped write permissions. LATER (scope freeze), not needed for this run.** Recorded for the backlog. Options:
  - (a) run agy write workers as local user `test`
  - (b) only with Tim present, using `--dangerously-skip-permissions`
  - (c) agy stays read-only until a mechanism exists.
- **D6, bus-spike landing.** `feat/bus-spike` (24 commits) is a prerequisite for the OpenCode live peer. Merging it to origin needs Tim's GO. Until then WP-LIVE-oc vendors only the needed delta into this branch.

---

## Live peer checks (phase 2 completion) {#p2-checks}
tech: run the already-built spikes `scratchpad/a2a/p2a/checks/p2a.sh` and `p2b/checks/p2b.sh` on the host
by: dispatcher (needs GO token for this session)
- [ ] Get GO token "GO acp - multi cli tool Manager" from Tim via master session {#p2-go}
- [ ] Run p2a.sh once (OpenCode live peer, answer "5", GO message stays synthetic) {#p2a-run}
- [ ] Run p2b.sh once (Claude live peer via UserPromptSubmit drain + one claude -p turn, answer "5", GO message only as agent-tagged context) {#p2b-run}
- [ ] Record results in ziel-c-plan-v2.md and spike NOTES; feed design deltas into WP-LIVE-* {#p2-record}

## A2A server and client in the repo {#a2a-cli}
needs: [p2-checks]
files: [lib/a2a-sidecar.mjs, lib/a2a-client.mjs, bin/aos-a2a.mjs, package.json, tests/a2a-sidecar.test.js]
tech: promote spike0 sidecar.mjs/send.mjs to library code behind `aos-a2a serve|send|reply|status|cancel`
- [ ] WP-CLI: sidecar + client library and subcommands {#wp-cli}
- [ ] WP-CLI-test: Docker tests green {#wp-cli-test}

**Worker prompt (WP-CLI):**
- **Read first:**
  - `scratchpad/a2a/spike0/{sidecar.mjs,send.mjs,REPORT.md}` and `sidecar-worker.mjs` (absolute paths under `/private/tmp/claude-501/-Users-timrennings/2f3aed09-052a-4360-86c5-4b1856c50064/scratchpad/a2a/`)
  - `lib/a2a-registry.mjs`, `lib/a2a-card.mjs`, `bin/aos-a2a.mjs`, `bin/aos-acp.mjs` (style), plan v2 §2, §4, §8
- **Build `lib/a2a-sidecar.mjs`:** `startSidecar({name, harness, profile, executor})`.
  - Network and auth:
    - binds 127.0.0.1 on a random port and refuses non-loopback
    - bearer auth as Express middleware before `jsonRpcHandler` (constant-time compare); `userBuilder` maps token → caller name
    - `express.json({limit:'8kb'})`; max 4 concurrent tasks (configurable)
  - Card and lifecycle:
    - card from `cardFromProfile`
    - registers via `a2a-registry`; on SIGTERM/SIGINT unregisters only its own two files
  - Environment:
    - strips `HTTP(S)_PROXY`/`ALL_PROXY` from its own `process.env` and sets `NO_PROXY=127.0.0.1,localhost,::1`
    - refuses to start when `AOS_A2A_SIDECAR=off`
- **Build `lib/a2a-client.mjs`:** `send({to|role, text, profile, timeoutMs=360000, background})` resolves role → registry entry by card skill.
  - Returns `{taskId, state, artifacts}`.
  - `status(taskId)`, `cancel(taskId)`.
  - Strips proxy env for loopback.
  - Carries `metadata.aos.{depth, caller}` and rejects when depth ≥ `AOS_DELEGATE_DEPTH` max (default 1).
- **`bin/aos-a2a.mjs`:** add `serve --name --harness [--profile] [--mode echo]` (echo executor only in this package), `send`, `status`, `cancel`, `reply <taskId> "<text>"` (writes the live-reply file of plan p2b). Keep `list` and `card`.
- **`package.json` (D1):** add `@a2a-js/sdk` `^1.3.0` and `express` `^5.1.0` to dependencies. Lazy `import()` only inside serve/send/status/cancel.
- **`tests/a2a-sidecar.test.js`:** start two echo sidecars in-process with a temp `AOS_SESSIONS_DIR` under `os.tmpdir()`. Cover:
  - completed + artifact
  - 401 on a wrong token
  - non-loopback refused
  - depth rejection
  - 8 KiB cap
  - unregister on stop

  Add it to the `test` script.

**Check:** Docker 0.2 with `node --test tests/a2a-sidecar.test.js tests/a2a-registry.test.js tests/a2a-card.test.js`, then `npm test`.

## Live peer adapters {#live-adapters}
needs: [a2a-cli]
files: [.claude/hooks/aos-bus.mjs, .opencode/plugins/bdb-aos.js, .claude/hooks/a2a-inbox.mjs, .claude/settings.json, lib/a2a-live.mjs, tests/a2a-live.test.js]
- [ ] WP-LIVE-core: `lib/a2a-live.mjs` live executor (inbox write, wait for reply, artifact) {#wp-live-core}
- [ ] WP-LIVE-oc: OpenCode live peer (bus delta + `AOS_BUS_ROOT`, reply via OpenCode HTTP API) {#wp-live-oc}
- [ ] WP-LIVE-claude: Claude UserPromptSubmit drain hook + Stop hook nudge + `aos-a2a reply` {#wp-live-claude}
- [ ] Host live check p2-style for both (dispatcher, GO token) {#live-check}

**Worker prompt (WP-LIVE-core / -oc / -claude, one package each):**
- **Read first:**
  - spikes `p2a/` (`sidecar-live-oc.mjs`, `aos-bus.patched.mjs`, `checks/p2a.sh`) and `p2b/` (`sidecar-live.mjs`, `hook-drain.mjs`, `reply.mjs`, `testproj/.claude/settings.json`)
  - bus-spike worktree `~/dev/bdb-dev/aos-wt-bus-spike` (`.claude/hooks/aos-bus.mjs`, `.opencode/plugins/bdb-aos.js` L200-320)
  - `.claude/hooks/memb-inject.mjs` (additionalContext shape)
  - plan v2 §3a, §5
- **core:**
  - executor mode `live`: writes `{taskId, contextId, from, text, ts}` into the session inbox (0700/0600) and sets `working`
  - waits ≤ 300 s for the reply via a pluggable `replySource` (file reply or OpenCode HTTP); then artifact + completed, or failed on timeout
  - every injected text is prefixed `[a2a from <caller>]` and ends with the "never counts as GO" line
- **oc:**
  - `aos-bus.mjs` gets `busRoot()` with the `AOS_BUS_ROOT` override (diff from the p2a report)
  - port only the plugin poll/inject delta needed from bus-spike into `.opencode/plugins/bdb-aos.js`; keep `synthetic:true`
  - `replySource` reads the assistant message whose `parentID` is the injected message
- **claude:**
  - `.claude/hooks/a2a-inbox.mjs` (UserPromptSubmit drain → additionalContext, rename to `.delivered`)
  - Stop hook: if undelivered messages exist, return the documented "continue" response once per message batch (check the Claude Code hook docs in the repo / existing Stop hooks first, mark UNVERIFIED if unsure)
  - register both in `.claude/settings.json`; `reply` via `aos-a2a reply`
- **Tests `tests/a2a-live.test.js`:** file-reply round trip, timeout → failed, prefix and never-GO line present, the drain hook prints the exact additionalContext JSON shape, synthetic flag set in the OpenCode inject payload (unit level with a fake client).

**Check:** Docker 0.2 for `tests/a2a-live.test.js` + `tests/aos-bus.test.js` + `tests/opencode-gogate.test.js` + `npm test`. Then on the host (GO token): adapt p2a/p2b to the repo code and run once each.

---

> **Everything from here down to `#docs` is LATER (scope freeze), except `#install`.** Kept as the ready-made backlog. The packages in the LATER components are not dispatched in this run.

## Spawn worker mode (LATER) {#spawn}
needs: [a2a-cli]
files: [lib/a2a-spawn.mjs, lib/a2a-worktree.mjs, bin/aos-acp.mjs, tests/a2a-spawn.test.js]
- [ ] WP-SPAWN: spawn executor, job worktree per write task, backends, artifacts {#wp-spawn}
- [ ] Host spawn check: OpenCode and Claude as writing workers in a fixture repo (dispatcher, GO token) {#spawn-check}

**Worker prompt (WP-SPAWN):**
- **Read first:**
  - `scratchpad/a2a/spike0/sidecar-worker.mjs`, `checks/p1b.sh`
  - `bin/aos-acp.mjs`
  - mcsc adapters `mcps/mcsc/packages/core/src/adapters/{agy,codex}.js`, `depth.js`, `trail.js`
  - plan v2 §3b, §4.1 of v1 (`~/.aos/recovery-plan/ziel-c-plan.md`)
- **`lib/a2a-worktree.mjs`:**
  - `createJobWorktree(repo, taskId)` → `git worktree add <repo>/../aos-wt-job-<taskId> -b job/<taskId>`; returns the path
  - never removes anything (removal is a dispatcher task after a GO)
  - read-only tasks get no worktree
- **`lib/a2a-spawn.mjs`:** executor mode `spawn`; backend by harness:
  - `claude`/`opencode` → `aos-acp` (`--cwd` = job worktree for write tasks)
  - `agy`/`codex` → mcsc adapters
  - child env: `AOS_DELEGATE_DEPTH`+1, `AOS_A2A_SIDECAR=off`, upstream proxy env **only if present in the sidecar's own launch env under `AOS_WORKER_PROXY_*`** (generic mechanism, no hard-coded proxy)
  - publishes `working`, then an Artifact with the last 40 output lines + `git diff --stat` of the job worktree; completed or failed by exit code
  - `cancel` kills the process group
  - re-emits status to agenttrail via `trail.js`
- **Tests `tests/a2a-spawn.test.js`:** use a fake backend binary (a node script in tmp) for exit-0/exit-1/timeout/cancel, worktree created only for write tasks, depth increments, `AOS_A2A_SIDECAR=off` in the child env.

**Check:** Docker 0.2 for the test + `npm test`. Host (GO token): a p1b-style fixture test with a real OpenCode and a real `claude -p` writing worker. The write must land only in the job worktree. Fixture main checkout, `~/.config/opencode` and the worktree status must stay unchanged.

## Worktree-scoped permissions (LATER) {#perm}
needs: [spawn]
files: [lib/a2a-permissions.mjs, bin/aos-acp.mjs, tests/a2a-permissions.test.js, docs/a2a-permissions.md]
- [ ] WP-PERM-core: replace `--allow-default allow` with path-scoped decisions in aos-acp (edits allowed only inside `--cwd`, guarded → GO gate, rest deny) {#wp-perm-core}
- [ ] WP-PERM-oc: OpenCode per-run config via `OPENCODE_CONFIG_CONTENT` (edit allow scoped, `external_directory` deny), global config untouched {#wp-perm-oc}
- [ ] WP-PERM-claude: `claude -p` with `--allowedTools`/permission mode limited to the job worktree (verify flags with `claude --help` first) {#wp-perm-claude}
- [ ] WP-PERM-agy: research only — agy settings/flags for workspace-scoped write permission (aos-09); report options for D5; no agy write run {#wp-perm-agy}
- [ ] WP-PERM-codex: app-server `workspace-write` with the job worktree as workspace (research + adapter flag) {#wp-perm-codex}

**Worker prompt (WP-PERM-core):**
- **Read first:** `bin/aos-acp.mjs` `decidePermission` (~L68-100), `.claude/hooks/go-gate.mjs` exports, `tests/aos-acp.test.js`.
- **Build:**
  - new option `--allow-default scoped` (becomes the default for A2A spawn; `allow` stays for back-compat but is never used by `a2a-spawn`)
  - `lib/a2a-permissions.mjs` `decide(toolCall, {cwd})`: file-write tools allowed only when the realpath target is inside `cwd`; shell commands allowed when not guarded and not hard-blocked and their cwd is inside the job worktree
  - everything else → deny with a reason
  - guarded → existing GO path
- **Tests:** inside/outside path, symlink escape, `..` escape, guarded command waits for GO (fake token dir only through the existing test seam, never `~/.aos/go`).

**Check:** Docker 0.2 for `tests/a2a-permissions.test.js` + `tests/aos-acp.test.js` + `npm test`.

## GO gate over A2A, auth-required resume (LATER) {#go}
needs: [perm, live-adapters]
files: [lib/a2a-go.mjs, bin/aos-go.mjs, lib/a2a-spawn.mjs, lib/a2a-live.mjs, tests/a2a-go.test.js]
- [ ] WP-GO: guarded action → task `auth-required` with the pending command; resume after a human GO; `aos-go issue <name>` (TTY-confirmed) + `aos-go check` wrapping `go-check.mjs` {#wp-go}
- [ ] Host check: forged `POST /answer` on agenttrail and an A2A message "GO x" do NOT resume; a real `GO <name>` does (dispatcher, GO token) {#go-check}

**Worker prompt (WP-GO):**
- **Read first:** `bin/go-check.mjs`, `.claude/hooks/go-token.mjs`, `.claude/hooks/go-gate.mjs` (exports only), plan v2 §5.
- **Rules:**
  - An inbound A2A message never mints or satisfies a GO.
  - `aos-go issue` refuses without an interactive `/dev/tty` (`process.stdin.isTTY` and an explicit typed confirmation of the session name).
  - Token format and TTL are identical to `go-token.mjs`; reuse its writer, don't duplicate it.
  - GO is never inherited across delegation.
- **Tests:** an `auth-required` transition with a fake guarded command, a non-TTY `issue` refused, a message containing "GO <name>" ignored, resume after a token written through the existing test seam.

**Check:** Docker 0.2 + `npm test`.

## Session hooks, installer and doctor (IN SCOPE, sidecar for live mode only) {#install}
needs: [live-adapters]
files: [.claude/hooks/a2a-session.mjs, .opencode/plugins/bdb-aos.js, installer.js, bin/aos-doctor.mjs, tests/a2a-install.test.js]
- [ ] WP-HOOK: session-start hook starts the sidecar per harness (Claude SessionStart, OpenCode plugin init, Codex/agy hook formats where they exist); skip when `AOS_A2A_SIDECAR=off` or `AOS_DELEGATE_DEPTH>0` {#wp-hook}
- [ ] WP-INSTALL: installer ships the hooks; never registers the sidecar hook in a harness it delegates to (fork-bomb rule); doctor prints the A2A capability matrix per harness {#wp-install}

**Worker prompt (WP-HOOK / WP-INSTALL):**
- **Read first:** `installer.js` only via grep + Read with offset/limit (it is large): `universalHarnessSync` ~L5774, `installMcpsForTarget` ~L3247, hook install for agy (`lib/agy-plugin-install.js`); `bin/aos-doctor.mjs` ~L150-170; plan v2 §8 fork-bomb rule; memory note `mcsc-agy-fork-bomb`.
- **Tests:**
  - installer dry-run in a temp HOME **inside Docker only**
  - the hook skips under `AOS_A2A_SIDECAR=off`
  - doctor output contains the matrix

**Check:** Docker 0.2 + `npm test`.

## mcsc shim (LATER) {#mcsc}
needs: [spawn, go]
files: [mcps/mcsc/packages/mcp/server.js, docs/delegation-routing.md, tests/mcsc-server.test.js]
- [ ] WP-MCSC: `delegate_agy|opencode|codex|smart` call `aos-a2a send --role/--worker`; `get_agent_status` **stays native** until #ao-status is done {#wp-mcsc}

**Worker prompt (WP-MCSC):**
- **Read first:** `mcps/mcsc/packages/mcp/server.js`, `tests/mcsc-server.test.js`, `tests/mcsc-depth.test.js`, plan v2 §7.
- **Rules:**
  - Keep the tool names and argument schemas identical.
  - Keep the startup gate (no live probes).
  - Depth semantics move to `AOS_DELEGATE_DEPTH` (old `MCSC_DEPTH` still honoured).
  - Do not touch `get_agent_status`.

**Check:** Docker 0.2 for the mcsc tests + `npm test`. Fork-bomb regression: a spawned worker has `AOS_A2A_SIDECAR=off` and starts no sidecar.

## AO session status replacement (LATER) {#ao-status}
needs: [a2a-cli]
- [ ] WP-AO-research (OpenCode, read-only): how AO's `get_agent_status` consumers work (AO `AGENTS.md:155`, `HANDOVER_IST_ZUSTAND_2026-09-24.md` §3, sandbox mcsc `4e1f10b`); propose either an AO-fronting sidecar that lists AO sessions as cards/tasks, or `aos-a2a list --include-ao` reading the AO REST API {#wp-ao-research}
- [ ] Implementation in AOS + AGENTS.md change in the AO repo — separate session/repo, needs master assignment {#ao-impl}

mcsc removal (plan v2 phase 5, step 3) is blocked until both tasks are done.

## Docs (IN SCOPE, A2A live mode only) {#docs}
needs: [live-adapters, install]
files: [docs/delegation-routing.md, docs/a2a.md, docs/harness-capabilities.md, CLAUDE.md, AGENTS.md]
- [ ] WP-DOCS: A2A usage (profile, roles, serve/send/reply, live vs spawn, GO rule), capability matrix, delegation-routing points to `aos-a2a`; fix the stale CLAUDE.md delegation section (`antigravity:delegate`, `opencode:opencode-rescue`, `codex:codex-rescue` are not installed) {#wp-docs}

Rules for WP-DOCS:
- No proxy, no fledge model, no machine-specific paths in docs.
- English only.

**Check:** `npm run validate` in Docker.

## Review {#review}
needs: [docs, install]
- [ ] Reviewer (Claude sonnet, adversarial): reads only this file's contracts + the diffs `origin/main..feat/ziel-c-phase1`; writes `production_artifacts/ziel-c/review_findings.md` with the fixed precedence (contract misread → blocking → trade-off → noise) {#rv}
- [ ] Repair round for blocking findings (OpenCode worker, one package per finding) {#rv-fix}

## Shipping (only after Tim's GO) {#ship}
needs: [review]
- [ ] Hand the reviewed branch to the v5 release (block 1 owner: aos orchestrator); entry on `~/.aos/briefs/aos-v5-list.md` {#ship-v5}
- [ ] Release list check per rule 14 (all listed fixes merged and tested) {#ship-list}
- [ ] Final adversarial security review (opus) {#ship-sec}
- [ ] PR from `feat/ziel-c-phase1` — push and PR only after "GO acp - multi cli tool Manager" {#ship-pr}

---

## Order and parallelism

**In scope (this run):**
```
p2-checks → a2a-cli → live-adapters → install → docs → review → ship (v5, GO)
```
- One OpenCode worker at a time, in this order: WP-CLI, WP-LIVE-core, WP-LIVE-oc, WP-LIVE-claude, WP-HOOK, WP-INSTALL, WP-DOCS.
- In WP-HOOK and WP-INSTALL, read "spawn" as "not needed": the sidecar runs in live mode only.

**LATER backlog (not in this run):** spawn → perm → go → mcsc → ao-status, plus agy/Codex.

## Exit criteria for the run
- All work packages are `[x]` and their checks are green in Docker.
- All **in-scope** packages are `[x]`.
- Host live checks are green: OpenCode and Claude exchange a message via A2A in both directions, and an A2A message "GO x" counts as nothing.
- The review has no open blocking findings.
- No proxy, fledge model or machine path appears in the diff (`git diff origin/main.. -- . ':!production_artifacts' | grep -nE '8888|fledge|/Users/timrennings'` returns nothing). `production_artifacts/ziel-c/` is build bookkeeping and is excluded from the PR, or dropped before it with Tim's GO.
- Push, PR and release happen only after Tim's GO.
