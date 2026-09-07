# 🌙 Overnight Audit & Merge-Prep Report — 2026-09-07

**Scope:** Everything touched in tonight's session, verified before declaring anything ready for beta installer testing. Every finding below was reproduced, not assumed — command output is the evidence, not a self-report.

**Status: not pushed anywhere.** All commits below are local. `git push`, merge, and PR remain gated on your explicit GO tomorrow — nothing in this report changes that.

---

## 1. What shipped tonight (chronological)

| Repo | Commits (local, unpushed unless noted) | What |
|---|---|---|
| `~/.claude/skills/bdbdesignpro` (own mini-repo) | `bf67af2` | Removed 5 fabricated/vendor-duplicate library-API docs (one contained an invented Anime.js method never in any real release); added BDB-owned motion-token + anti-slop-gate references; added a 15-case eval suite |
| `bdb-dev-optimized-agent-skills` | `e0eba75`, `46775fa`, `22a26dc`, `c2eb33c`, `29ff82d` | bdbdesignpro + saas-ops (bdbsaas-ops/bdbsaashost/bdbsaastraining) propagated, **then corrected** (see §2), plus an installer crash fix (see §3) |
| `bdb-dev-optimized-agent-skills-basic` | `3268890`, `b1e7454`, `da22966` | bdbdesignpro propagated + corrected, installer crash fixed |
| `bdb-dev-optimized-antigravity-skills` | `9ad4e71`, `76b843b`, `87e319d` | bdbdesignpro propagated + corrected, installer crash fixed |
| `bdb-saashost-engine` | 4 commits, HEAD `382250b` | A9/A10 work (OIDC machine-identity groundwork). **26 commits ahead of origin/main, not pushed.** |
| `multi-cli-subagent-configurator` (no remote) | `10b6111` | Fixed a status-mislabeling bug (`binary: missing` reported for an installed-but-unauthenticated CLI) |
| `bdb-dev-creator-extension` | `5bd9d70` | Fixed a dangling doc cross-reference + committed a previously-uncommitted verified state |

---

## 2. Structural bug I introduced, then caught and fixed (before you asked me to audit)

**What happened:** When I propagated `bdbdesignpro`, `bdbsaashost`, and `bdbsaas-ops` into `bdb-dev-optimized-agent-skills` earlier tonight, I placed them as **bare top-level** `skills/<name>/` entries. That was wrong.

**How I caught it:** Cross-checking `CHANGELOG.md` against what I'd just committed — the changelog documented `bdbsaashost` integration history that didn't match what I'd found in `skills/`, which led to tracing the real canonical path.

**The actual rule** (established by commit `e4036aa`, 2026-08-27, "deduplicate skill trees and tag skills by domain"): almost every skill lives inside a **container directory** (`skills/global_config/<name>/`), not bare. Bare top-level is a deliberate, narrow exception for ~8 "signature" skills (`bdbrainstorm`, `bdbsaastraining`, `bdb-dev-os-skill`, `github-repo`, `memb-ingest`, `synapse-integration-skill`, `basic/`, `workspace_agents/`). Every sibling of `bdbdesignpro`'s own category (`shadcn`, `ui-component`, `senior-frontend`, `tailwind-patterns`, `design-spells`, `ui-ux-pro-max`) lives in `global_config/`. `bdbsaashost` already had a real (now-stale) canonical copy at `skills/global_config/bdbsaashost/SKILL.md` that I'd left completely untouched while creating a duplicate bare copy with the new content.

**Fix, verified:**
- Moved `bdbsaashost`'s new OIDC content into its real canonical path, deleted the bare duplicate
- Placed `bdbsaas-ops` (genuinely new, no prior canonical copy) alongside its sibling in `global_config/`
- Placed `bdbdesignpro` in `global_config/` in **all three** repos (main + basic + antigravity), matching the same convention independently confirmed in each
- Confirmed via `installer.js`'s own leaf-skill detection (`fs.existsSync(path.join(dir, 'SKILL.md'))`) that all corrected paths resolve
- Confirmed via a real dry-run that the container-flattening copy step picks them up: `copy 437 files: skills/global_config -> .../skills`, and `find skills/global_config -type f | wc -l` independently returns exactly 437

This is the same failure class `syncSkillEntry`'s own code comment already documents from a prior incident ("bdbsaastraining, github-repo, memb-ingest, bdb-dev-os-skill, synapse-integration-skill... never survived a global sync intact"). I made it again fresh tonight, and this is exactly what a pre-merge audit is for.

---

## 3. Installer bugs found by actually running the installer (not reading it)

I ran each of the three repos' installers for real — `--dry-run` where supported, otherwise in a sandboxed `HOME` pointed at `/tmp/sandbox-home-*` so nothing touched your real `~/.claude`, `~/.gemini`, etc.

### 3a. `bdb-dev-optimized-agent-skills` — crash on startup, every run, fixed
```
Error: ENOTDIR: not a directory, scandir '.../GEMINI.md'
  at walk (installer.js:555) -> buildKnownSourceHashes -> initSessionManifest -> main
```
This fired before the installer did *anything* — a fresh install would have failed at the very first step for every user. Root cause: `walk()` assumed every path handed to it was a directory; something in the source-dir scan reaches a file/symlink dirent that a raw `readdirSync` chokes on. **Fixed** (`29ff82d`): `walk()` now `lstat`s first and returns early on a non-directory instead of assuming. Re-ran after the fix: full `--dry-run` completes (`🎉 Installation complete!`), all corrected skills confirmed present in the copy manifest.

### 3b. `bdb-dev-optimized-agent-skills-basic` — post-install crash, fixed and re-verified
```
ReferenceError: mcpCodeTarget is not defined
  at installer.js:680  (await promptMemBIngestion(mcpCodeTarget))
```
Fired *after* "Installation complete." had already printed — the core install steps succeed, but the final memB-ingestion prompt step crashes because `mcpCodeTarget` (a `const` scoped to an earlier conditional block, line 507) is out of scope at the call site 40 lines later. `promptMemBIngestion` itself correctly declares `mcpCodeTarget` as its own parameter — only the *call* was broken. **Fixed and committed** (`da22966`): call site now reconstructs the same path expression from the outer-scope `targetMcpDir` that's actually in scope. Re-ran in a fresh sandboxed `HOME` after the fix: full completion, exit 0, zero error-signature matches.

### 3c. `bdb-dev-optimized-antigravity-skills` — same bug, initially missed by me, then caught and fixed
My first pass on this repo only watched the first ~40 lines of a long install log while it was still mid-way through MCP dependency installation, and I called it "clean" on that basis. **That was wrong** — it hadn't reached the end yet. A `Monitor` task set up to watch both sandboxed installs to completion caught the real tail:
```
ReferenceError: mcpCodeTarget is not defined
  at installer.js:618  (await promptMemBIngestion(mcpCodeTarget))
```
Identical bug, identical root cause, identical fix pattern as §3b — this fork and `-basic` apparently diverged from the same original code before the main repo's version got corrected. **Fixed and committed** (`87e319d`), re-verified in a fresh sandboxed `HOME`: full completion, exit 0, zero error-signature matches.

Also noted (not fixed, out of scope, pre-existing): three "skipping broken symlink" warnings under `mcps/windows-computer-use-mcp/` during the antigravity run, unrelated to tonight's changes.

**Lesson applied within this same audit:** a truncated log check produced a false "clean" verdict; letting both sandboxed runs actually finish (via a bounded `Monitor`, not eyeballing partial output) is what caught it.

---

## 4. Security check: this package is public

`bdb-dev-optimized-agent-skills`' `package.json` has `publishConfig.access: "public"` and real published versions exist on npm up to `3.13.0-nodex.14` — this is not a private artifact. Given that, I specifically audited everything added tonight for the failure mode the repo's own history already had once (commit `8e802b5` stripped a hardcoded real Step-CA certificate fingerprint from `bdbsaastraining/scripts/preflight_check.sh` for exactly this reason):

- Grepped all of tonight's added/changed skill content for 32+ char hex strings (fingerprint/hash shape): **zero hits**
- Grepped for private-key blocks, hardcoded password/secret/API-key patterns: **zero hits**
- The one keychain reference added (`preflight_check.sh` Check 8) is a lookup **label** (`bdb-saas-host-machine-key`), not a secret value — same pattern the existing sanitized precedent already uses
- Real domain references (`rcentry.pro`) already existed pre-tonight as an established, apparently-accepted fallback default elsewhere in this same script; nothing new introduced there

**Clean.** No secrets shipped.

---

## 5. Extra rigor applied after catching my own false "clean" verdict (§3c)

Getting `-antigravity` wrong from a truncated log read was the wake-up call: dry-run and a truncated real-run can both hide a bug that only fires at the very end. So beyond the dry-run already done for the main repo (§3a), I also ran it **for real** (not `--dry-run`) in a sandboxed `HOME`, waited for full completion via a bounded `Monitor` rather than eyeballing partial output. Result: clean completion, `🎉 Installation complete!`, real MCP injection and version checks against all 8 tracked modules, zero `ReferenceError|Traceback|ENOTDIR|fatal|Killed` matches in the full log.

---

## 6. A second, independent installer workstream exists — found mid-audit, not mine

While this audit was running, a **separate Antigravity/Gemini session** left a handoff at `~/.gemini/antigravity-cli/brain/fbd59d44.../HANDOFF.md`: a full startup-UX redesign (kinetic 3D ASCII BDB medallion intro, new hero header, pre-flight telemetry card) plus a worked-out Authelia/LLDAP OIDC auth-gating concept for the installer, built in an **isolated sandbox clone** at `~/dev/sandbox/bdb-installer-sandbox/`. That handoff is explicit that production must never be touched without your GO, and lists several product decisions only you can make (auth mandatory-or-optional, which features gate on it, etc.) — I have not touched that repo's design, only verified it.

**What I verified (read-only, no changes made there):**
- The sandbox exists, its git history shows it forked at commit `e0eba75` — my *first* commit tonight, before every fix and correction in §2/§3
- **Neither of tonight's two installer bugs exist in this sandbox** — its `buildKnownSourceHashes`/`walk()` is already wrapped in try/catch (wouldn't have crashed the way production's did), and its `promptMemBIngestion` call site already reconstructs the path correctly. Not a coincidence I need to reconcile; it inherited the main repo's already-correct code at that specific point, unrelated to my later fixes.
- Ran its own dry-run (`node installer.js --dry-run -y --no-animation`): completed cleanly, `🎉 Installation complete!` — the handoff's "✅ Fertig & verifiziert" claims check out empirically, not just asserted

**What this means for tomorrow:** this sandbox is functionally sound but based on a stale point in the main repo's history — it predates my saas-ops propagation, the placement corrections in §2, and the ecosystem-wiki-sync commits that landed around the same time. Merging it into production will need an explicit reconciliation pass (rebase or manual re-apply), not a fast-forward. That reconciliation is real work for tomorrow, not something to improvise tonight, and not mine to start without you having seen the sandbox's design first (per its own handoff, design sign-off comes before any merge planning).

---

## 7. What's explicitly NOT done, and why

- **No `git push` anywhere.** `bdb-saashost-engine` sits 26 commits ahead of `origin/main`. That repo's own `.claude/hooks/go-gate.mjs` mechanically blocks push/publish/version-bump without a literal, isolated "GO" — and every other repo's safety convention established tonight treats push the same way even where not mechanically enforced.
- **No merge/PR opened anywhere.**
- **No changes to `~/dev/sandbox/bdb-installer-sandbox/`** — read-only verification only (§6). Production migration is explicitly gated on your design sign-off per that workstream's own handoff, not mine to start.
- **`_rescued-saashost-beta/installer.beta.js`** — confirmed dead (no git repo, zero references anywhere) during an earlier pass tonight. Not deleted; flagged as a cleanup candidate, your call.
- **I have not audited the other ~137 pre-existing `global_config/` skills** for the same placement-convention violation — only what was touched tonight. If you want that broader sweep, say so; it's a much bigger task than tonight's scope.

---

## 8. Bottom line

Ready for your review, not yet ready to ship blind:
1. Two independent installer workstreams now exist (production fixes here, and the sandbox redesign in §6) — they'll need reconciling before either merges
2. Decide what to do with the dead beta installer (§7)
3. Give the explicit GO for whichever pushes/PRs you want tomorrow — nothing here does that for you
