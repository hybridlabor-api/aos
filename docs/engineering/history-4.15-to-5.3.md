# AOS v4.15.0 -> v5.3.0: a history digest

Digest of the git history between tag `v4.15.0` and tag `v5.3.0`
(2026-10-01 to 2026-10-14, local tags, no network fetch). Headlines come
from CHANGELOG.md and the release-merge commit subjects; counts from
`git log` between the adjacent tags.

## Totals

- **836 commits**, of which **142 merge commits**, in
  `v4.15.0..v5.3.0`.
- **15 tagged releases**: v4.15.0, v4.16.0, v4.17.0, v4.18.0, v4.18.1,
  v4.19.0, v5.0.0-beta.1, v5.0.0-beta.2, v5.0.0, v5.0.1, v5.0.2, v5.1.0,
  v5.1.1, v5.2.0, v5.2.1, v5.3.0 (13 stable, 2 beta).
- The version jumps from 4.x to 5.x in three days; 5.2.0, 5.2.1 and 5.3.0
  all shipped on the same day (2026-10-14).

## The releases

| Release | Date | Volume | Headline |
|---|---|---|---|
| v4.15.0 | 10-01 | — | `aos-bus` lands: visible OpenCode TUI delivery, heartbeat liveness, gate hardening (#121); pipeline skills stay model-invocable (#120). |
| v4.16.0 | 10-01 | 5 commits / 0 merges | Playbook wave 3 — 24 `pb-*` playbooks (#125); `aos-acp --model` with fable-reject (#117). |
| v4.17.0 | 10-02 | 3 / 0 | The `bdb-aos` plugin ships for every harness with go-gate modes, playbooks and the loop (#126); `aos version/help` print instead of installing (#127). |
| v4.18.0 | 10-02 | 6 / 0 | plan-canvas becomes an annotation dispatcher, one agenttrail map per repo (#129); AO coordination depth limit and go-check (#132); Codenotch default on macOS/Windows (#133); memB ambient inject (#131). |
| v4.18.1 | 10-02 | 2 / 0 | Hotfix: Quick Update crashed on `newestDistTag` (#135). |
| v4.19.0 | 10-06 | 62 / 11 | Codex and agy gain real plugin installs (through their CLIs) plus doctor checks; the gate classifies recursive deletes in any language and hard-blocks home deletes; managed Destructive-Actions block in every rules template. |
| v5.0.0-beta.1 | 10-11 | 565 / 81 | The giant: installer v5 (release candidate 78d95c5, PR #142) — v5 packages, AOS Hub as a service, per-service supervision, MCP gateway default-on with adopt dialog, unified memory, agenttrail hub, A2A ring (Claude/OpenCode/agy/Codex), annotation pipeline, R8 dispatcher profiles, all on one board of pooled fix-merges (S1 installer, S3 hub, S5 gate, S8 release). |
| v5.0.0-beta.2 | 10-11 | 8 / 2 | Beta self-fix round: agy junctions become real copies on Windows, gate wiring from any cwd, git-lfs rules whose objects never shipped are dropped (#144). |
| v5.0.0 | 10-13 | 32 / 5 | Stable graduation (3b309af: Docker FULL 248/248, macOS 46/46, Linux and Windows green). Fresh install adds gateway, hub service and all Claude mods (1a228430); Codex gets an AOS-owned execution-policy gate layer. |
| v5.0.1 | 10-13 | 4 / 2 | Uninstalls stop only this user's own gateway/hub processes; config files with a BOM read cleanly (#148). |
| v5.0.2 | 10-13 | 12 / 4 | Write only for detected harnesses; memB requires Python >= 3.10 bootstrapped via uv; mods and gates report skip reasons (#157). |
| v5.1.0 | 10-14 | 18 / 6 | Prompt-audit bundle (PR #159): explicit hook timeouts, `defaultMode: auto`, A2A session labels, aos-setup worktree doctor checks. |
| v5.1.1 | 10-14 | 11 / 2 | Load fixes (PR #161): hooks get 10 s under load, the version cache refetches when older than the running kernel, Windows console windows and npm .cmd shims quieter. |
| v5.2.0 | 10-14 | 59 / 18 | The 5.2 bundle branch (PR #164): 16 upstream ECC reviewers for parity, ui-library integration, gate v2 simplification, Windows fixes (console hide, GNU tar cwd-relative paths, module swap retry). |
| v5.2.1 | 10-14 | 4 / 2 | Hub port-busy test blocks an OS-assigned port (#165). |
| v5.3.0 | 10-14 | 45 / 9 | Update engine v2 (plan, drift, --force, lastRunFailed + repair retry), gateway settings and idempotency, installer conflict rules (CRLF, identical files, guard files with .bak), Windows module-lock stop passes, router R1, Token Saver Store-Python detection — merged through release/5.2.2-bundle (#167) and integ/open-points (#169). |

(The dashes in the first row: v4.15.0 is the range start.)

## Shapes worth noticing

- **4.x is linear commits, 5.x is merge graphs.** Every v4.16-v4.18 range
  shows zero merges; from v4.19.0 on, work arrives as waves of reviewed
  branches (81 merges into beta.1 alone), with `integ/*` and
  `release/*-bundle` branches acting as the landing zone.
- **The two-week arc** is: playbooks and plugin distribution (4.15-4.17),
  AO/canvas/sessions integration (4.18-4.19), the v5 architecture leap in
  beta (10-11), then three days of stabilisation bundling memory, gate and
  Windows correctness fixes (5.0-5.3).
- **Reviewer waves show up as numbered fix series** (S1-S8, F-suffixes,
  R-residuals) in the 5.0-5.3 changelog entries — the record of the review
  rounds that gated each bundle.
