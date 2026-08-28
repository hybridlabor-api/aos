# Audit-Handover — Beta Aftercare v3.13.0-nodex.4 (2026-08-28)

Nachfolge-Dokument zu `SESSION-HANDOVER-v3.13.md`. Erstellt durch den
Aftercare-Audit-Run (Verifikation + Cleanup-Audit, **keine Änderungen**):
nichts gemergt, geschlossen, gelöscht, gepusht oder published. Alles unten
ist geprüft und wartet auf Entscheidung/GO.

Repo-Zustand bei Audit: `main` @ `ba49a22` (3.13.0-nodex.4), Working Tree
clean. Diese Datei ist neu und **untracked** (Commit braucht GO).

---

## 1. Verifiziert korrekt

Alle SHAs aus dem Brief existieren exakt in `git log main`:

| Fix | Urteil |
|---|---|
| `5c8b634` setup-saas.mjs: Cert-Cleanup + 0600 | korrekt; regex-Replace des Marker-Blocks entfernt sogar alt-gesteckte stale Lines (self-heiling). Restrisiken siehe F9/F10 |
| `5b2444a` agent-pipeline SKILL.md Rewrite | korrekt (die Datei selbst); aber fiktive Pipeline lebt woanders weiter → F3 |
| `bb4053d` isNewerVersion im Status-Check | korrekt für den gemeldeten Bug; **unvollständig bei Prereleases** → F1 (wichtigster Befund) |
| `6425b97` --platforms Flag | korrekt; Kleinigkeiten: Leerzeichen-Form (`--platforms 2`) nicht unterstützt, Duplikate nicht deduped, `0,2` verschweigt das `2` |
| `f283b7c` MCP-Merge Claude Code/Desktop | korrekt: Read-Modify-Write, fremde Top-Level-Keys (`projects` u. a.) und User-Server bleiben in BEIDEN Dateien erhalten; Namenskollision → BDB gewinnt. Aber: F2 (chmod-Lücke), F8 (env carry-over nur im Mirror) |
| `e3bea52` excludeList-Rekursion | korrekt; Bug-Klasse existiert genau einmal im Codebase |
| startcycle-Naming-Fix `2138bd9` | korrekt; ein stale Pointer bleibt → F4 |
| `.agents/graph.md` Rewrite | korrekt: alle 7 Nodes existieren real (agents.md + .claude/agents + .opencode/agents), alle referenzierten Dateien existieren |
| go-gate.mjs Transcript-Fix (`51ae49c`) | korrekt: `type`/`message.content`, String- wie Block-Content, Sidechain-Skip, fail-closed. Nuance: `isMeta`-User-Entries werden nicht excluded (konservativ, ok) |
| Hook-Drift | `~/.claude/hooks/go-gate.mjs` UND `graph-gate.mjs` sind byte-identisch mit den Repo-Kopien (diff geprüft, 2026-08-28) |
| npm dist-tags | `latest=3.12.0`, `beta=3.13.0-nodex.4` — wie beabsichtigt |

## 2. Befunde (priorisiert)

**P1 — solltest du fixen vor dem nächsten Release:**
- **F1 `isNewerVersion` versteht keine Prereleases** (installer.js:238-248,
  Call-Site :1487, `npm view` ohne Tag :1476). Numerischer Dot-Compare:
  `3.13.0-nodex.4` gilt als NEUER als `3.13.0` (semver: älter). Sobald 3.13.0
  auf `latest` landet, bekommen nodex.4-User „Up to date" angezeigt, obwohl
  sie älter sind — dieselbe Fehlerklasse wie der gefixte Bug, nur invertiert.
  Außerdem sieht die Call-Site nur den `latest`-Dist-Tag: Beta-Bumps unter
  `beta` sind unsichtbar.
- **F2 chmod-Lücke beim primären MCP-Merge** (installer.js:1884): der Write
  für `claude_desktop_config.json` setzt keinen Mode — eine bestehende-0644
  Datei behält 0644, während API-Keys injiziert werden. Der Mirror-Pfad nach
  `~/.claude.json` macht 0600+chmod (:1617) — inkonsistent zur eigenen Regel
  aus `5c8b634`. Zusätzlich: write→chmod-Fenster auch bei
  `writeMcpConfigSecure` (:223-226) und `catch {}` verschluckt
  chmod-Fehler still.

**P2 — Konsistenz/Regressionsvektoren:**
- **F3 Fiktive Pipeline lebt weiter:** `skills/basic/godmode-shipping/SKILL.md:14`
  empfiehlt `/spec` als echten Befehl; `GEMINI.md:13` und
  `.codex-plugin/system.md:13` listen `/build`, `/test`; „run `/ship`" steht
  in 5 aktiven Dateien (`.agents/workflows/startcycle.md:81`,
  `.codex-plugin/system.md:119`, `.claude/workflows/startcycle-dispatch.mjs:411`,
  `.agents/state.schema.json:20`, `.agents/graph.md:92+115`), obwohl es
  `/ship` nirgends als Command gibt (GO-Check passiert stattdessen im
  go-gate.mjs am Push-Punkt — funktional ok, Benennung inkonsistent).
- **F4 Stale Path:** `.agents/state.schema.json:76` verweist noch auf
  `.claude/workflows/startcycle.mjs` (heißt jetzt `startcycle-dispatch.mjs`).
- **F5 `github-repo` doppelt mit divergiertem Inhalt:**
  `skills/github-repo/SKILL.md` (neu, BDB-Standard) vs.
  `skills/global_config/github-repo/SKILL.md` (alt, generisch).
  Install-Reihenfolge (alphabetisch) überschreibt bei **jedem** Install die
  neuere Root-Version still mit der älteren.

**P3 — klein:**
- **F6** `skills/global_config/github-actions-templates/SKILL.md:83,340`
  referenziert `assets/test-workflow.yml` — existiert nicht.
- **F7** `/grill-me` wird benutzt von bdbrainstorm, startcycle,
  bdbmediastorm — ist aber in keinem Repo shipped (undeclared dependency).
- **F8** Mirror-Path (`~/.claude.json`) hat kein env carry-over bei
  Namenskollision (primärer Pfad hat es) — User-Env wird ersetzt.
- **F9** setup-saas: Cert-Existenz-Check ≠ Frische-Check
  (bin/setup-saas.mjs:139-148): vorhandenes, aber abgelaufenes Cert bleibt
  verdrahtet, wenn heutiges Bootstrap failt.
- **F10** Lock-freies Read-Modify-Write auf `~/.claude.json` kann
  konkurrierende Claude-Code-Updates verlieren (inherent, dokumentieren statt
  fixen).

## 3. Cleanup-Liste — wartet auf GO / Entscheidung

| # | Aktion | Grund (1 Zeile) |
|---|---|---|
| C1 | PR #36 schließen (`gh pr close 36`) | Inhalt seit `54caa5c` in main; einziger Delta = überholter Version-Bump `8eead12` (3.9.5→3.12.0) |
| C2 | Remote-Branch `feat/agent-skills-v3.13` löschen | vollständig in main gemergt (`merge-base --is-ancestor` bestanden, tip `adc7f47`) |
| C3 | Lokale Branches `fix/build-profile-hardening` + `fix/v3.13-installer-blockers` löschen | beide 0 unique commits, vollständig gemergt |
| C4 | `installer_old.js` entfernen (Commit) | 0 Referenzen im ganzen Repo (package.json, installer.js, scripts/, grep) |
| C5 | `SESSION-HANDOVER-v3.13.md` archivieren/löschen (Commit) | von diesem Handover abgelöst; **`audit-agents.md` BEHALTEN** — wird von `.agents/graph.md:5` als Spec-Referenz zitiert, ist also produktiv |
| C6 | Tag `v3.13.0-nodex.0`: pushen ODER lokal löschen | npm hat nodex.0, GitHub hat den Tag nicht — Inkonsistenz; entscheide eine Richtung |
| C7 | 4 `snapshot-*`-Tags: behalten/pushen/löschen | lokale Historie-Anker; nur lokal vorhanden, keine Releases — bewusst entscheiden |
| C8 | (Beobachtung) `BDB_REMOTEOS_MCP_HANDOVER.md`, `Project-overview.html` im Root | weitere Root-Kandidaten, nicht im Brief — nur angeschaut, nicht bewertet |

**Explizit NICHT tun:** `mcp_config.json` anfassen (live MCP-Template-Quelle);
`pr-15`/`copilot/worktree-*` suchen — existieren auf dieser Maschine nicht
mehr (Brief veraltet; `.worktrees/`-Verzeichnis enthält keine Git-Repos).

**Nicht-Cleanup, aber offen:** PR #7 + #8 auf `bdb-saashost-engine`
(LDAP-Injection, Admin-Group-Authz) sind weiterhin OPEN — brauchen
Review/Merge-Entscheidung, sitzen seit 2026-08-27.

## 4. Tag-/Release-Anomalien (Inventur, 2026-08-28)

- 45 lokale Tags; 5 lokal-only: 4× `snapshot-*`, `v3.13.0-nodex.0` (→ C6/C7).
- Kein GitHub-Release für: `v2.4.1`, `v3.9.5` (Tags + npm existieren).
- `3.0.6`: Tag + Release existieren, aber **nie auf npm publiziert** (E404).
- `3.3.1`: auf npm, aber kein Tag, kein Release.
- Betas (3.13.0-beta.nodex, nodex.0–.4): auf npm, keine Git-Tags (außer
  lokalem nodex.0), keine Releases — konsistent zur Beta-Strategie.

## 5. Design-Abgleich (manuell, teilweise — Subagenten gequotet)

Der unabhängige Screenshot-Vergleich wurde 2× abgebrochen (concurrency limit,
dann quota limit) und **nicht** durchgeführt. Manuell abgeglichen:
`~/Downloads/GRAOG/bdb_graph_layer_guide.html` (das distillierte Design-Doku,
Aug 27, „BDB OS v3.13") gegen `.agents/graph.md` + Implementierung:

| Design (Guide) | Status | Anmerkung |
|---|---|---|
| 7-Node State Machine (Architect→TechLead→paralleler Build→Reviewer→Shipping) | MATCH | 1:1 in graph.md + Simulator-Diagramm |
| „Nodes never call each other", Dispatcher-only Edges | MATCH | Kernregel von graph.md:8-17 |
| Repair-Loops (TechLead-Reject→Architect, Reviewer→owning node) | MATCH | Edge-Table identisch |
| No-Progress Guard (gleiche Blocker-ID 2× → needs_human) | MATCH | Implementierung = „same finding IDs"-Eskalation (graph.md:64-75, dokumentierte Adaptation von B3) |
| Phase 4: „Reply GO → `/ship`" | PARTIAL | `/ship` existiert als Command nicht; GO-Check läuft im go-gate.mjs am Push — F3 |
| Phase 1: `/bdbrainstorm` & `/grill-me` | PARTIAL | `/grill-me` fehlt (F7) |
| memB-Dual-Memory (Seed vor Planung, Regression-Match, Ingest nach Ship) | UNKLAR | memb-ingest Skill existiert; ob Architect/Reviewer memB wirklich abfragen, steht nicht im Graph-Contract (ggf. in .agents/agents.md prüfen) |
| Multi-Harness (Claude dispatcher, Antigravity, OpenCode/Codex, Cursor/Roo-Fallback) | MATCH | Artefakte existieren (.opencode/agents, .roomodes); Guide nennt noch alten Namen `startcycle.mjs` (Guide:889, Design-Doku, nicht Repo) |

**Offen:** die 10 Screenshots (IMG_6186–IMG_6300) wurden einzeln nicht
ausgewertet. Der Guide referenziert IMG_6186 („4 Primitives") und IMG_6194
(„Multi-Agent Topology") als die beiden Blueprints — vermutlich deckt der
Guide deren Inhalt already ab; die übrigen 8 sind wahrscheinlich frühere
Iterationen. Ein Nachfolge-Agent kann das mit Read auf die Bilddateien
verifizieren.

## 6. Best-Practices-Check (code.claude.com/docs/en/best-practices, manuell)

- **Verification loops: FOLLOWS** — Stop-Hook-Gates (graph-gate, go-gate),
  Dispatcher gegen 9+ Szenarien verifiziert (graph.md:117-124),
  `max_iterations=3` bewusst unter Claude's 8-Block-Override
  (graph.md:137-141 zitiert die Best-Practices-Doku explizit).
- **CLAUDE.md-Hygiene: FOLLOWS** — 1.6KB, schlank. **Aber:** 5+ parallele
  Instruction-Files (CLAUDE/AGENTS/GEMINI/CODEX/.roomodes/.codex-plugin) —
  der Drift ist schon sichtbar (F3: GEMINI.md + .codex-plugin stale).
  Empfehlung: single-source + Generierung statt manuell synchronisierter
  Kopien.
- **Skills vs CLAUDE.md Split: FOLLOWS.** **Reviewer-Isolation (= adversarial
  fresh-context review): FOLLOWS** modellhaft (Reviewer sieht nie die Claims
  der Build-Nodes).
- 161 Skills: kein Verstoß, aber Redundanz-Cluster existieren (seo×3,
  prompt×3, tdd×2, debugger×2, postgres×4) — Aufräum-Kandidaten, low
  priority.

## 7. Sonstiges

- token-saver v2.6.3 aktiv, Lifetime 44.9% Ersparnis (48.3K tokens/162
  cmds). Auffällig: git-Processor „Mismatches" 28× (~17%) — Config-Stellschraube,
  unangetastet.
- `token-saver update` wurde bewusst NICHT ausgeführt (Zustandsänderung).
- GO-Gate gilt weiter: push/publish/npm version/rekursives rm nur nach
  wörtlichem „GO" direkt davor.

## 8. Empfohlene Reihenfolge für den Folgende-Agent

1. F1 + F2 fixen (vor dem 3.13.0-latest-Release!) → Beta-Gate.
2. F3/F4 in einem „stale-references"-Commit.
3. F5 entscheiden: welche github-repo-Version ist kanonisch, andere löschen
   + Install-Reihenfolge fixen.
4. Cleanup C1–C7 einzeln zur Freigabe vorlegen.
5. PR #7/#8 (bdb-saashost-engine) reviewen.
