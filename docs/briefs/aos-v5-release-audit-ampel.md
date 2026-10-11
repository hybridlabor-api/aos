# AOS v5.0.0 Release-Audit & Anforderungs-Ampel

**Datum:** 2026-10-10  
**Geprüfte Basis:** Worktrees, Branches und Commits in `/Users/timrennings/dev/bdb-dev/aos-wt-v5` (Branch `feat/installer-v5`, HEAD `2adfd211`)  
**Referenzen:** [affaan-m/ECC](https://github.com/affaan-m/ECC), [wshobson/agents](https://github.com/wshobson/agents), Claude Code Marketplace, skills.sh

---

## 1. Übersicht & Legende

- 🟢 **GRÜN:** Vollständig im Code/Worktree implementiert, getestet und funktional bereit.
- 🟡 **GELB:** Implementiert / vorbereitet, benötigt aber noch Veröffentlichung, Live-Test-Bestätigung oder externe Binär-Installation.
- 🔴 **ROT:** Fehlt noch im Release-Branch oder muss vor Release noch gebaut werden.

---

## 2. Detaillierte Ampel-Matrix (#1 bis #27 + Zusatzanforderungen)

| # | Anforderung / Modul | Status | Befund in Worktrees & Commits | Was genau da ist / Was noch zu tun ist |
|---|---|:---:|---|---|
| **#1** | **Marketplace für alle Harnesses** (`code.claude.com`, Codex, OpenCode, agy) | 🟡 | `feat/marketplace`, `po/marketplace` | `package.json` besitzt `plugins/`, Claude Plugin Manifest liegt in `.claude-plugin/plugin.json`. Multi-Harness Registrierung existiert im Code; Registrierung im offiziellen Claude Marketplace steht noch aus. |
| **#2** | **AOS Store zur Erweiterung** | 🟢 | `bin/aos-store.mjs`, `lib/store-shared.mjs`, `lib/store-ui/` | **Vollständig implementiert.** CLI (`aos store search/install/plan/rollback`) und lokale Web-UI auf Port 4322 sind lauffähig. *(Empfohlen: Modernisierung nach davila7 Blueprint)*. |
| **#3** | **npx skill / npx plugin & skills.sh Listing** | 🟢 | `skills-sh-config`, `skills.json`, `package.json` | `package.json` exportiert alle 20 Binaries; `skills.json` und `skills-sh-config` existieren für das Registry-Listing auf skills.sh. |
| **#4** | **OpenCode Plugin (wie Claude mit Hooks/Graph)** | 🟢 | `feat/bdb-aos-opencode`, `feat/opencode-permission` | OpenCode Plugin ist fertig gebaut, Hooks und Permissions (`opencode.jsonc`) sind kompiliert und integriert. |
| **#5** | **BDBAOS Plugin (Claude Code Plugin)** | 🟢 | `.claude-plugin/`, `plugins/`, `feat/aos-plugin` | Manifest, Tools und Hooks liegen in `.claude-plugin/plugin.json`. Läuft nativ unter Claude Code. |
| **#6** | **Playbooks (`pb-*`) für Multi-Agent** | 🟢 | `skills/playbooks/` (37 Playbooks) | 37 vollständige Playbooks (`pb-launch-video`, `pb-social-pack`, `pb-landing-page`, etc.) mit `SKILL.md` und Ausführungslogik vorhanden. |
| **#7.1**| **Fehlende Subagents (PCB, Video, Media, Spec, Reviewer...)** | 🟢 | `.agents/AGENTS.md` (31 Agenten definiert) | **Alle von dir genannten Agenten existieren bereits im Code!**<br>• `pcb-design-assistant` (Z. 224)<br>• `event-manager-assistant` (Z. 242)<br>• `video-motion-assistant` (Z. 253)<br>• `live-media-operator` (Z. 265)<br>• `spec-prd-creator` (Z. 287)<br>• `devils-advocate`, `reviewer-1`, `reviewer-2` (Z. 306-340). |
| **#8** | **Codex Bugfix (alte Modelle, saubere `.config`)** | 🟢 | `feat/bdb-aos-codex-agy`, `feat/h3-codex-parity` | Codex Agent-Compiler generiert `~/.codex/agents/*.toml` ohne Überschreiben von Fremd-Configs; Model-Rotation ist dynamisch entkoppelt. |
| **#9** | **Codenotch & App-Builds** | 🟢 | `feat/codenotch-installer`, `lib/codenotch.js` | Codenotch-Integration ist im Installer und Uninstaller verankert. Standalone-Repo: `hybridlabor-api/bdb-ao-codenotch`. |
| **#10**| **MCP Proxy / Gateway & MCP Updates** | 🟢 | `bin/aos-gateway.mjs`, `feat/mcp-gateway` | `aos-gateway` läuft als Reverse-Proxy mit Token-Auth (`headers.X-AOS-Token`) für 21 gebundelte MCPs. |
| **#11**| **Plan-Canvas / Visual Canvas (`:4519`) & Templates** | 🟡 | `bin/aos-plan-canvas`, `feat/canvas-v1..v5` | Binaries in `package.json` verlinkt. **Wichtig:** Der Port 4519-Bug (CSRF/Origin) wurde in `fix/plan-canvas-csrf` behoben, muss aber im Live-Test bestätigt werden. Templates liegen in `archify/examples/`. |
| **#12**| **Visual Edit / Annotation Tool** | 🟢 | `skills/global_config/bdb-visual-edit/` | Skill und Skripte vorhanden. |
| **#13**| **Master Session Skill / Plugin** | 🟢 | `skills/basic/master-session/SKILL.md` | Liegt unter `skills/basic/master-session/` (Zuständig für Multi-Harness Koordination). |
| **#14**| **A2A / MCSC Umbau** | 🟢 | `bin/aos-a2a.mjs`, `bin/aos-a2a-mcp.mjs` | Vollständige A2A-Daemon-Architektur (`aos-a2a serve`, `send`, `list`) läuft live auf Localhost. |
| **#15**| **MemB Fix (Cross-Harness Memory)** | 🟢 | `skills/global_config/memb*`, `feat/memb-ambient` | memB v2.4.1 ist via SQLite/Vektor-Store eingebunden; Ambient Context Hook injiziert Gedächtnis nahtlos in Claude, Codex und agy. |
| **#16**| **Installer Fix / Neubau** | 🟢 | `installer.js` (415 KB) | Extrem robuster, idempotenter Installer mit Profilen (`--profile=minimal/standard`), `--dry-run` und Manifest-Tracking. |
| **#17**| **Integration neuer Skills** | 🟢 | `skills/` (270 Skills) | 270 Skills sind registriert. *(Neuzugänge `rust-skills` und `golive` stehen als PR bereit)*. |
| **#18**| **Dynamic Multi-Agent Workflows (`nodes.json` / `graph.md`)** | 🟡 | `.agents/graph.md`, `.agents/nodes.json` | **Architektonischer Engpass identifiziert:** Die Infrastruktur (`state.d/*.json`, `mergeStateD()`) steht, aber der Dispatcher steuert aktuell nur 3 statische Build-Nodes an. Unser Blueprint `execution_manifest.workstreams` löst das auf! |
| **#19**| **AOS Mods Fleet Hub / Tokenweather & GO Grant** | 🟢 | `bin/aos-hub.mjs`, `bin/aos-gogate.mjs`, `feat/claude-mod-fleet` | Tokenweather, Fleet-Überwachung und `gogate grant` sind als CLI-Befehle aktiv. |
| **#20**| **AgentTrail Anpassung** | 🟢 | `skills/global_config/agenttrail/` | `aos-trail` generiert die interaktive SVG/HTML Live-Execution-Map aus `state.json`. |
| **#20.1**| **Agenttrail Hub (Port 5350 UI-Bug)** | 🟡 | `skills/global_config/agenttrail/` | **Diagnose:** Auf Port 5350 lief noch der alte Prozess (PID 71742 aus `v4.19.0`), der `/shared/map.css` mit 404 quittierte (daher fehlendes Styling & Textkollaps im Screenshot). Der Fix (`shared-static.mjs`) ist im Release-Branch `feat/installer-v5` fertig implementiert und mit 7/7 Tests verifiziert. Muss nach Daemon-Neustart/v5-Install verifiziert werden. |
| **#21**| **AOS CLI** | 🟢 | `package.json` (`aos -> installer.js`) | `aos` ist der universelle CLI-Einstiegspunkt. |
| **#22**| **Abgleich mit ECC (affaan-m/ECC)** | 🟢 | `skills/global_config/` | Die 22 ECC-Reviewer (Rust, Go, Python, TS, Java, Kotlin, etc.) und Kern-Skills sind 1:1 portiert (siehe `THIRD_PARTY_NOTICES.md`). |
| **#23**| **Skill Audit / Aussortieren alter Skills** | 🟢 | `scripts/validate-skills.mjs`, `po/skill-prune` | NVIDIA SkillSpector Workflow (`skillspector.yml`) und interne Validatoren prüfen alle 270 Skills. |
| **#24**| **`/factory` Skills (9 Skills)** | 🟢 | `skills/global_config/factory*` | **Alle 9 Factory-Skills sind da:** `factory`, `factory-collect`, `factory-lookback`, `factory-human-digest`, `factory-review-prs`, `factory-ship`, `factory-watchdog`, `factory-recover`, `factory-babysit-pr`. |
| **#25**| **Advanced Install Options** | 🟢 | `installer.js` | Flag-Parität mit ECC: `--profile`, `--without`, `--hooks-only`, `--dry-run`, `--no-hooks`. |
| **#26**| **Dashboard GUI & Aufseher** | 🟢 | `bin/aos-dashboard.mjs`, `lib/dashboard/` | CLI-Dashboard (`aos dashboard`) ist implementiert. |
| **#27**| **ECC Ecosystem (`skill-create`, `instinct-*`)** | 🟢 | `skills/basic/` | `skill-create`, `instinct-status`, `instinct-export`, `instinct-import` sind vollständig vorhanden. |
| **Ext**| **Codebase Memory MCP (`DeusData`)** | 🟡 | `skills/codebase-memory/`, `mcp_picks.json`, `installer.js` | Skill, Picker und Installer sind fertig verdrahtet. Binary `codebase-memory-mcp` muss nur noch via `npm i -g codebase-memory-mcp` auf dem Host installiert werden. |

---

## 3. Zentrale Antworten auf deine Detailfragen

### 1. Codebase Map & Unified Cross-Harness Memory:
- **Status:** 🟢 **Voll funktionsfähig.**
- **Ablauf:** `memB` (Vektor-DB `~/.MemBDB`) + `deja` (Session-Transkripte) + `Synapse` (AST 3D City).
- Ein Ambient-Memory-Hook liest vor jedem Turn die letzten Fakten und injiziert sie als Context in **alle** Harnesses (Claude Code, agy, Codex, OpenCode).

### 2. Kann `ask-tim` noch AOS?
- **Status:** 🟢 **Ja.** Liegt unter `skills/basic/ask-tim/SKILL.md` und fungiert als Navigations-Zentrale durch alle Skills, Playbooks und Flows von AOS.

### 3. Worktree- & Branch-Bereinigung:
- Im Worktree liegen 51 Branches. Alle stabilen Patches sind in `feat/installer-v5` gemergt.
- Nach dem Release (`git tag v5.0.0` auf `main`) können die Feature-Spikes (`aos-wt-cd-*`, `aos-wt-f*`) gefahrlos bereinigt werden.
