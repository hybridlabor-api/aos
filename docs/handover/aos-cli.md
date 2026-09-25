# AOS CLI — handover

AOS CLI is a lightweight terminal harness for AOS: the [pi](https://github.com/earendil-works/pi) coding agent carrying the AOS dispatcher contract. It is a **launcher**, not a reimplementation — 736 lines across seven files, of which the part that does anything is 134.

Everything it provides already existed somewhere. pi already discovers `~/.agents/skills` per the Agent Skills specification. `~/.agents/AGENTS.md` already holds the seven-node dispatcher graph. pi already has themes and an extension API. AOS CLI adds three flags and a name.

## What it is

| | |
|---|---|
| **Harness** | pi 0.87.1 (MIT), spawned with `--theme`, `--use-theme`, `--extension`, `--append-system-prompt`, `--no-skills`, `--skill` |
| **Skills** | ten, from `core-skills.json` — see below |
| **Dispatcher graph** | `~/.agents/AGENTS.md` appended to the system prompt |
| **Commands** | `/aos`, `/aos-status` |
| **Install** | AOS installer target `10`, or `npm i -g packages/aos-cli` |

## What it deliberately is not

- **It does not depend on `@hybridlabor-api/aos`.** It reads `~/.agents/` at runtime, which the installer writes. That is the whole contract, and it is why the two version and update independently: a pi bump never becomes a 98 MB AOS reinstall, and an AOS release never moves pi.
- **It runs without AOS installed.** No `~/.agents` means no AOS skills and no graph; the launcher says so and continues. That is also why the coupling is a filesystem convention rather than a package dependency — `~/.agents/skills` is the Agent Skills spec, which pi, Claude, Antigravity and Codex all read.
- **It has no MCP.** pi has no MCP client. memB, deja and mcsc are absent. It is a chat-and-skills harness; the other seven harnesses remain the machinery. `pi-mcp-adapter` is the way in when that changes.
- **It is not a pipeline executor.** The dispatcher graph arrives as instructions, not as machinery. The nodes are agent definitions in `AGENTS.md`; the main session acts as the dispatcher, which is what `.agents/graph.md` specifies anyway. There is no `state.json` loop.

## Layout

```
packages/aos-cli/
├── bin/aos-cli.mjs      134  the launcher — flag construction, pi resolution
├── extensions/aos.ts    321  /aos, /aos-status, the no-provider notice
├── themes/aos.json       97  pi's dark theme, AOS palette
├── core-skills.json      12  the ten skills
├── scripts/check-theme.mjs 63  theme contract guard, run by `npm test`
├── package.json          29  private, ships pi as a dependency
└── README.md             80
```

## Why ten skills and not all of them

pi advertises every discovered skill by name and description in **every system prompt**. Measured on this machine: 210 skills, **~11,150 tokens per request**, of which the four `firecrawl` entries alone were ~2,250. A permanent per-turn tax that grows with the library.

`--no-skills` stops pi's discovery walk; each `--skill` adds one back. Both are pi's own flags — no skill-loading code was written. `--skill` alone would not have worked: it appends to discovery rather than replacing it, so the saving needs the pair.

**11,150 → ~497 tokens, 96 % off.** Verified in a real TUI: pi loads exactly the ten, and `firecrawl` appears zero times in the startup output.

**The cost, stated plainly:** a skill outside the list is not merely unadvertised, it is *unreachable* — `/skill:name` included, because `--no-skills` removed it rather than just hiding it. `aos-store` is how one gets added. That integration is not built; ten was judged sufficient, and building a mechanism for a problem that does not exist yet is waste.

`core-skills.json` is a flat list of directory names, editable without touching code. A name that is not installed is skipped with a note rather than being fatal — the first run of this caught one of my own, a subagent rather than a skill, and the launcher started anyway. A malformed or non-array list falls back to loading everything, with a message saying so.

## Auth: why the installer asks no provider key

The installer already collects a `gemini` and a `github` key for its own daemons. An Anthropic key would be a third unrelated secret in a tool that never uses it, and pi has `/login` already. So the installer asks nothing, and the extension only *notices* when nothing is configured:

```
Warning: No model provider was configured at startup (checked: anthropic, google).
Run /login to add one -- or /aos-status for the current state.
```

Two things that matter in that code:

- `pi auth check --provider <name> --json` is the source. `pi --list-models` is the tempting shortcut and is **wrong** — it lists every provider pi knows about whether or not a credential exists, so a model in the list says nothing about being usable. `auth check` exits 0 for every verdict including `not_ready`, and distinguishes *unconfigured* from *unreachable*.
- The notice says **"at startup"** on purpose. `session_start` fires once, so a `/login` completed mid-session leaves a warning standing next to a working model. A notice still visible after you acted on it reads as a current fact, which is worse than none. pi exposes no event this extension can rely on for "a login landed", and guessing at an API to make a warning prettier is the wrong trade. `/aos-status` re-probes on every invocation and is the live reading.

## Wiring into the installer

Target `10` in `installer.js`. Three things it does that a directory target does not:

- it is **filtered out before `resolveTargetPaths()`** — left in the list it falls through to the universal defaults and installs a second full copy of every skill somewhere nobody reads them from;
- it **adds the universal skill target** when chosen alone, so `primaryTarget` is never `undefined` and the harness has something to load;
- `installAosCli()` runs **after** the skill sync, because AOS CLI is useless without `~/.agents`.

Verified by dry run: `--platforms=10` → `Targets: 1 + AOS CLI`; `--platforms=10,2` → `Targets: 2 + AOS CLI`; `--platforms=99` still rejected.

**AOS CLI installs only when target 10 is selected.** See "Next version" — that is changing.

## Commits

13 commits since `5aa76cf`, linear, on `feat/cicd-skills-import`. **`main` is still at `5aa76cf` — nothing has been merged.**

| | |
|---|---|
| `1ca84cc` | perf(aos-cli): load ten skills instead of 210 |
| `4755e84` | fix(aos-cli): the no-provider notice said "before sending a message" |
| `aab900a` | chore(plugin): regenerate the manifest for the 208 skills this branch adds |
| `9294b22` | fix(skills): make agenttrail and mcp-manage load under a spec-strict harness |
| `c3c398a` | feat(plugin): ship AOS as a Claude Code plugin from a generated manifest |
| `2aa77b0` | feat(aos-cli): add /aos and /aos-status pi commands |
| `8121ea4` | feat(installer): add AOS CLI as target 10 |

## Next version

**1. Install AOS CLI by default.** Today it requires picking target `10` explicitly. It should come with a plain `aos` run. That means selecting `10` in the default platform set, or calling `installAosCli()` unconditionally — decide which, because the second bypasses the menu.

**2. An "Open AOS CLI" entry in the installer menu.** The main menu (`installer.js`, the block that offers Quick Update / Drop Local Project Harness / Reconfigure System / Uninstall) is what you see when you type `aos` on an installed machine. Add an entry that launches the harness.

Note the constraint already documented in `extensions/aos.ts`: the installer animates and prompts, and an extension must not create a second terminal renderer. For the `/aos` commands, actions needing a real TTY are reported as a command to run elsewhere rather than spawned in-process. **A menu entry in `installer.js` does not have that problem** — it *is* the outer TUI, so it may hand the terminal to pi directly. That is the cleaner place for this feature, which is presumably why it belongs there.

**3. Decide before merging: public or private package.** `packages/aos-cli/` is currently in the root `files` array, so the next `npm publish` of `@hybridlabor-api/aos` ships it to public npm. The payload is small — `bin/`, `themes/`, `extensions/`, `core-skills.json`, no secrets, no dispatcher graph, no `installer.js` delta — but the repo rule is that BDB-internal material ships as a private package, and **no private registry exists on this machine** (`~/.npmrc` has no `registry=`, `@hybridlabor-api:registry` undefined, no Verdaccio/Artifactory). Options: build the registry, or merge and accept ~400 lines going public, or hold the merge. Making it a real separate package is the architecturally right answer and resolves this cleanly — it just needs somewhere private to publish to.

**4. `aos-doctor` does not know AOS CLI exists.** A health check that does not check the harness you are running in. Two checks: pi resolves, `aos-cli` on PATH.

**5. Windows is untested.** `shell: process.platform === "win32"` is in the spawn calls, never exercised. The AOS fleet has Windows machines and the installer's history is full of Windows fixes.

**6. MCP** — `pi-mcp-adapter` (MIT, `pi install npm:pi-mcp-adapter`). It reads `~/.agents/mcp.json` as a compatibility path, and AOS's `mcp_config.json` is already in `mcpServers` format, so the bridge is small. Deliberately not built.

## Gotchas, found the hard way

**pi's `exports` map blocks subpath resolution.** `require.resolve('@earendil-works/pi-coding-agent/package.json')` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`, and so does `/dist/bundle/cli.js`. npm also leaves no `node_modules/.bin/pi` for a transitive dependency. The launcher resolves `import.meta.resolve('@earendil-works/pi-coding-agent')` and walks up to the manifest that declares `bin.pi`. Both branches are tested; a missing pi exits 1 with an install hint rather than an ENOENT stack.

**A directory entry in `files` pulls in `node_modules`.** `files: ["packages/aos-cli/"]` shipped the 144-package pi tree through the root `.npmignore`, which does not apply to that subtree. `"!packages/aos-cli/node_modules"` fixes it; verified on a scratch package, both variants, before trusting it.

**`aos-doctor --json` exits 1 whenever any check is not ok.** That is the normal "needs attention" answer, not a failure to run. The first version rejected on the non-zero exit, discarded a valid 27-check report, and rendered as "aos-doctor could not be run" — reporting the absence of a check as if it had passed. The report's own `ok` is the verdict; the exit code carries nothing.

**`--print` mode does not validate themes.** A broken theme and a valid one produced byte-identical output there, so "no error" was not evidence. pi only reports an invalid theme when the TUI starts. `scripts/check-theme.mjs` encodes the contract instead, with a negative control, because a check that cannot fail is not a check.

**The validator only walks `skills/`.** It reported 208 skills, 0 errors, while pi found two broken ones. Both were in `skills/global_config/` and genuinely invisible to it: `MCP_Manage` violated the Agent Skills name charset but matched its own directory, so the name==directory check passed; `agenttrail`'s unquoted `description:` contained `": "` and parsed as a nested mapping, a shape the scanner only checked for *multi-line* values. `E-NAME01` and `E-YAML04` now cover both. **The remaining gap: backticked bare skill references are not checked at all** — `checkSkillRefs` only matches `/name` with a leading slash, which is how eighteen `MCP_Manage` references went stale silently.

**`npm test` green does not mean the installed skills are fine.** It validates the repo. The two bugs pi reported were only visible in a running terminal, and one of them survived a repo fix because the file was never synced to `~/.agents/skills`. **The validator does not check installed copies.**

## Verifying

```sh
cd packages/aos-cli && npm test          # theme contract
cd ../.. && npm test                     # skills, plugin manifest, 8 tests
aos-cli                                  # the harness
/aos-status                              # 27 doctor checks, dashboard, model row
```

`aos-cli` is installed globally and symlinked to the checkout, so the running binary is the working tree — after changing it, re-run `npm i -g .` from `packages/aos-cli`.

## Disk, incidentally

This machine was at 974 MB free and pi could not write its settings. Two causes, both invisible in `df`:

- `~/.cache/uv` held **26 GB** behind a lockfile dated 50 days earlier. `uv cache clean` had been timing out at 300 s on a lock nobody held. A weekly `launchd` job now prunes it (`~/Library/LaunchAgents/dev.hybridlabor.uv-cache-prune.plist`, Sundays 04:17) — `prune`, not `clean`, so live MCP servers keep their venvs.
- `opencode.db.bak_20260925_164526` held a duplicate 1.3 GB session database.

`cron` does not work here: `/usr/sbin/cron` is not running and needs Full Disk Access on current macOS, so a crontab entry would be accepted and never fire. `launchd` has no such gate.
