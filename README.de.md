![AOS — BDB Agent OS](assets/header-v4.jpg)

🌐 **Language / Sprache / Idioma**: [ 🇬🇧 English ](README.md) | **Deutsch** | [ 🇵🇹 Português ](README.pt.md)

# AOS — BDB Agent OS

[![NPM Version](https://img.shields.io/npm/v/@hybridlabor-api/aos.svg)](https://www.npmjs.com/package/@hybridlabor-api/aos)
[![CI](https://github.com/hybridlabor-api/aos/actions/workflows/ci.yml/badge.svg)](https://github.com/hybridlabor-api/aos/actions)
[![license](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-blue.svg)](package.json)

AOS installiert eine kuratierte Skill-Bibliothek, ein Subagent-Verzeichnis, Gate-Hooks und eine ausführbare Multi-Agent-Build-Pipeline in jeden auf deinem Rechner installierten Coding-Agent-Harness.

```bash
npx -y @hybridlabor-api/aos@latest
```

Entwickelt für Nutzer, die bereits **Claude Code, Google Antigravity, Codex CLI, OpenCode, Cursor, Windsurf, Roo Code / Cline oder Aider** verwenden und dass alle gleich funktionieren sollen.

Nach der Installation hast du:

- **<!-- count:skills -->213<!-- /count --> Skills** in sechs Kategorien, von jedem Harness als `<name>/SKILL.md` auffindbar.
- **<!-- count:agents -->13<!-- /count --> Subagents** (Architect, TechLead, Reviewer, die Godmodes, Security- und Silent-Failure-Reviewer) als natives Agenten-Format jedes Harness kompiliert.
- **<!-- count:mcps -->21<!-- /count --> MCP-Server** für Creative Software, Betriebssystemsteuerung, Memory und Harness-übergreifende Delegation.
- **Drei Pipelines** — `/startcycle`, `/startcycle-graph`, `/startcycle-graph-user` — und ein **GO-Gate**, das `git push`, `npm publish`, `npm version` und rekursive `rm` mechanisch blockiert.
- **Tools:** Plan Canvas, agenttrail, archify, der AOS Store, das Launchpad Dashboard und `aos doctor`.

---

## Installation

Anforderungen: Node.js >= 20. macOS, Linux und Windows (PowerShell).

```bash
npx -y @hybridlabor-api/aos@latest
```

**Erste Ausführung.** Das Installationsprogramm erkennt, welche Harnesses vorhanden sind, fragt, welche Ziele und welche Tier (Pro MEDIA oder Basic) gewünscht sind, kopiert die Skills in das Skill-Verzeichnis jedes Harness, kompiliert die Subagents, verbindet die Hooks, fügt die MCP-Konfiguration in die eigene Konfigurationsdatei jedes Harness ein (vorhandene Einträge bleiben erhalten) und bietet die unten aufgeführten optionalen Module an.

**Bei jeder späteren Ausführung** öffnet sich stattdessen ein Menü:

| Menüpunkt | Was es tut |
|---|---|
| Quick Update | Aktualisiert Skills, Templates, Hooks und installierte Module auf die gerade ausgeführte Version |
| Run System Checkup / Doctor | Führt `aos doctor` aus: Abhängigkeiten, Dateiplatzierung, Daemons, Hooks |
| Drop Local Project Harness | Kopiert den Dispatcher-Vertrag ins aktuelle Verzeichnis (siehe unten) |
| Reconfigure System | Ändere Ziele, Tier oder Optionen |
| Uninstall AOS | Entfernt, was das Installationsprogramm platziert hat; deine Daten bleiben |

### Nicht-interaktiv

```bash
npx -y @hybridlabor-api/aos@latest -y --platforms=2          # Claude only, all defaults
npx -y @hybridlabor-api/aos@latest -y --platforms=1,5 --mcps=none
npx -y @hybridlabor-api/aos@latest --dry-run                 # print what would change
```

`--platforms=` Werte: `0` universal (alle erkannt), `1` Antigravity, `2` Claude Desktop / Claude Code, `3` Cursor, `5` Codex CLI, `6` Windsurf, `7` Roo Code / Cline, `8` Aider, `10` AOS CLI. `4` (benutzerdefinierte Pfade) benötigt das interaktive Menü. `--mcps=<name,name>|all|none` wählt die MCP-Teilmenge. `--verbose` und `--no-intro` tun, was sie sagen.

### Lokales Projekt-Harness

Statt in `$HOME` zu installieren, platziere nur den Dispatcher-Vertrag (`.agents/`, die Gate-Hooks, die Agent-Definitionen, den `/startcycle-graph` Workflow, das OpenCode Plugin) in ein Repository:

```bash
cd your-project && npx -y @hybridlabor-api/aos@latest --project-harness -y
```

---

## Unterstützte Harnesses

Was das Installationsprogramm für jeden Ziel schreibt. Pfade sind die Standardwerte; das Installationsprogramm schreibt nur in Harnesses, die tatsächlich erkannt werden.

| Harness | Skills | Subagents | Hooks | Plugin / rules |
|---|---|---|---|---|
| Claude Code / Claude Desktop | `~/.claude/skills` | `~/.claude/agents` | `~/.claude/hooks` + `settings.json` (GO gate, graph gate, env-file protection, Conventional Commits, memB inject, trail relay) | `.claude-plugin/` manifest ships in the repo (see Contributing) |
| Google Antigravity | `~/.gemini/config/skills` | `~/.gemini/config/agents` | `~/.gemini/config/hooks.json` and `~/.gemini/antigravity-cli/hooks.json` | — |
| Codex CLI | `~/.codex/skills` | `~/.codex/agents` | `~/.codex/hooks` + `config.toml` | `.codex-plugin/` |
| OpenCode | `~/.config/opencode/skills` | `~/.opencode/agents` | via plugin | `bdb-aos.js` plugin + `/startcycle-graph` command, registered in `opencode.jsonc`; keeps a `/startcycle-graph` run moving on `session.idle` |
| Cursor | `~/.cursor/skills` | — | — | `.cursor/rules` (project) |
| Windsurf | `~/.windsurf/bdb-skills` | — | — | `mcp.json` |
| Roo Code / Cline | `~/.roo/skills` | — | — | `.roomodes` (project) |
| Aider | `~/.aider/bdb-skills` | — | — | — |
| AOS CLI (`pi`) | reads `~/.agents/skills` | `~/.agents/AGENTS.md` as system prompt | — | no MCP; separate install, Node >= 22.19 — see [packages/aos-cli](packages/aos-cli/README.md) |

Jede Installation schreibt auch die universelle Kopie zu `~/.agents/skills`, die von AOS CLI und der `skills` CLI gelesen wird.

---

## Die Pipelines

Der Vertrag lebt in [`.agents/graph.md`](.agents/graph.md), das Knoten-Register in [`.agents/nodes.json`](.agents/nodes.json), der ausführbare Dispatcher in [`.claude/workflows/startcycle-dispatch.mjs`](.claude/workflows/startcycle-dispatch.mjs).

**Eine Regel: Knoten rufen sich gegenseitig nie auf.** Ein Dispatcher liest `production_artifacts/state.json` nach jeder Knotenrückkehr und entscheidet, was als nächstes ausgeführt wird. Es gibt keine Hand-off-Kette und keinen Agent, der einen anderen Agent auffordert zu gehen.

```mermaid
flowchart LR
    U(["User"]) --> A["Architect"] --> T["TechLead"]
    T --> UX["Godmode_UI_UX"] & EN["Godmode_Engineering"] & ME["Godmode_Media"]
    UX & EN & ME --> R["Reviewer"] --> S["Shipping"]
    T -.->|reject| A
    R -.->|findings| UX
    R -.->|needs_human| U
```

| Befehl | Maschinerie | Nutze wenn |
|---|---|---|
| `/startcycle` | Lineare Kette, Datei-Übergaben in `production_artifacts/`. Keine State-Machine, keine Reparatur-Schleife. `/startcycle --skill=<name> <goal>` zwingt einen Skill in jeden Knoten. | Ein einfacher Build mit dem Agent-Verzeichnis, aber ohne die Zeremonie. |
| `/startcycle-graph` | Der vollständige Graph: dauerhaftes `state.json`, Reviewer-Reparaturschleife, automatisierte Quality-Gate, menschliche Eskalation. | Feature-Work, bei dem Korrektheit wichtiger ist als Geschwindigkeit und du eine Audit-Spur möchtest. |
| `/startcycle-graph-user` | Verwerfbare 2–4 Knoten-Ausfächerung. Nichts dauerhaft. Modell-gestaffelt pro Rolle; verwendet Antigravity, OpenCode oder Codex, falls installiert, sonst Claude Code Subagents. | Ein einmaliger "spawne ein paar Worker" in jedem Projekt. |

Was den vollständigen Graph ehrlich hält:

| Mechanismus | Was es verhindert |
|---|---|
| Reviewer isolation | Der Reviewer liest Artefakte und den Plan-Vertrag, nie die Begründung des Build-Knotens oder dessen Behauptung, fertig zu sein. |
| No-progress guard | Eine Reparaturzyklus, der die gleiche blockierende Finding-ID wie der vorherige meldet, eskaliert zu einem Menschen statt Iterationen zu verschwenden. |
| Per-node state fragments | Parallele Build-Knoten schreiben `state.d/<node>.json`; der Dispatcher führt zusammen. Kein Lost-Update Race auf einer Datei. |
| Iteration ceiling | `max_iterations` (Standard 3) stoppt die Schleife bedingungslos. |
| In-loop human edge | Jeder Knoten kann `needs_human: true` setzen und den Lauf stoppen. |

## Das GO-Gate

Das Erreichen von `ready_to_ship` ist kein Versand. [`.claude/hooks/go-gate.mjs`](.claude/hooks/go-gate.mjs) ist ein `PreToolUse` Hook, der `git push`, `npm publish`, `npm version` und rekursive `rm` blockiert, wenn deine unmittelbar vorherige Nachricht nicht das Wort **GO** ist. Es ist ein Hook, nicht eine Regel, die ein Agent respektieren soll: es wird vor jeder Berechtigungs-Modus-Prüfung ausgelöst und kann nicht diskutiert werden. Der Installer verbindet das gleiche Gate in Antigravity, Codex und OpenCode; auf Harnesses ohne Hook-Unterstützung gilt die Regel in [AGENTS.md](AGENTS.md) und der Agent ist die Durchsetzung. Ein Subagent erbt niemals das GO des Orchestrators, und ein fehlgeschlagener Release-Befehl benötigt einen neuen.

---

## Werkzeuge

| Tool | Befehl | Was es tut |
|---|---|---|
| Plan Canvas | `aos-plan-canvas open <file>` (skill `plan-canvas`) | Öffnet einen Plan oder HTML-Artefakt in einer lokalen Browser-Canvas, wo du Elemente annotierst, chattest und Änderungen genehmigst oder anforderst. Pläne aus den Pipelines öffnen sich hier standardmäßig. |
| agenttrail | `aos-trail` (skill `agenttrail`, port 5330) | Live-Board einer Multi-Agent-Build: welche Komponente, welcher Agent oder Harness, was ist fertig, was ist stecken geblieben. Gespeist von den Trail-Relay-Hooks und von `mcsc`. |
| archify | `aos-archify` (skill `archify`) | Validierte Architektur-, Sequenz-, Datenfluss- und State-Diagramme als eigenständige HTML mit SVG-Export; akzeptiert Mermaid. |
| AOS Store | `aos store list \| search <q> \| install <name> [--project]`, `aos store ui` (auch `aos-store`, slash command `/aos-store`) | Durchsuche und installiere AOS Core und ECC Skills und Agents. Die Web-UI auf `http://127.0.0.1:4322` zeigt, was installiert ist, zeigt die genauen Zielpfade in der Vorschau an und installiert nur nach deiner Bestätigung. Multi-Datei-Skills werden komplett installiert. `list` und `search` lesen einen angehefteten Offline-Index. |
| Launchpad | `aos-dashboard [--port 7900] [--no-open]` | Eine Seite mit jedem lokalen BDB-Service (memB, Synapse, OpenWiki, AO, Remote, AOS Store): Status, Start/Stop, Logs. Registriert als Autostart-Eintrag. |
| Doctor | `aos doctor [--json] [--net]` (auch `aos-doctor`) | Überprüft Abhängigkeiten, Skill-Platzierung pro Harness, Daemons, Hooks und Module; beendet sich mit 1, wenn etwas Aufmerksamkeit benötigt. Das erste, das zu laufen ist, wenn etwas nicht funktioniert. |
| Config | `aos-config show \| propose \| set <key> <value>` | Maschinenebene `~/.agents/aos-config.json`: Workspace-Root, Domänen, Benutzer-ID. |
| mcsc | MCP tools `delegate_agy`, `delegate_opencode`, `delegate_codex`, `delegate_smart` (skill `mcsc`) | Delegiert eine Aufgabe an einen anderen installierten CLI-Harness und streamt seine Tool-Aufrufe zu agenttrail. Bevorzugt gegenüber dem Aufruf der CLI. |

---

## Gedächtnis und Wissen

Installiert als optionale Module durch das Installationsprogramm; `aos doctor` überprüft sie und das Launchpad zeigt sie.

- **memB** (`@hybridlabor-api/memb`) — lokal, offline Vektor-Memory mit MCP-Server (`add_memory`, `search_memory`, `list_memories`, `delete_memory`), WebUI auf Port 8088 und ein Ambient-Hook, der relevante Memories in Claude Code Sessions einfügt. Skills: `memb-skill`, `memb-ingest`, `bdb-memb-mcp`.
- **deja** (`@vshulcz/deja-vu`, mit memB installiert) — indiziert deine Agent-Transkripte lokal mit bereinigten Geheimnissen; `deja fix` bei einem Fehler, `deja wip` beim Fortsetzen, `deja search` für vergangene Sessions. Skill: `deja-memory`.
- **OpenWiki** (`openwiki` CLI) — erzeugt und aktualisiert ein fundiertes Wiki eines Codebase mit Visualizer auf Port 4321 und einem Background-Daemon. Skill: `openwiki-skill`; das eigene Wiki dieses Repos ist unter [`.openwiki/`](.openwiki/quickstart.md).
- **Synapse** (`@hybridlabor-api/bdb-synapse`) — rendert ein Repository als 3D-Code-Stadt und spielt Agent-Sessions durch es hindurch. Skill: `synapse-integration-skill`.

`aos-setup` bringt einen Machine zu einem verifizierten Status für alle vier; `aos-project-init` bindet ein Projekt an sie (slug, wiki, memory, `AGENTS.md`).

---

## Skills

<!-- count:skills -->213<!-- /count --> Skills, jeder ein Verzeichnis mit `SKILL.md`, dessen Frontmatter `name`, `description` und eine `category` erklärt: `bdb-core`, `design-ui-ux`, `engineering-method`, `engineering-hardware`, `media-eventtech`, `library`. Der vollständige Katalog ist in [docs/skills_table.md](docs/skills_table.md).

Die sieben **Godmodes** unter `skills/basic` sind die Persona-Schicht; drei davon sind die Build- und Shipping-Knoten des Graph.

| Godmode | Besitzt |
|---|---|
| `godmode-engineering` | DDD, Clean Architecture, striktes TypeScript, systematisches Debugging. Der `Engineering` Knoten. |
| `godmode-ui-ux` | Anti-Slop Frontend, DTCG Tokens, Motion, Accessibility. Der `UI_UX` Knoten. |
| `godmode-shipping` | Pre-Launch-Checks, Quality Gate, sicheres Rollback. Der `Shipping` Knoten. |
| `godmode-eventtech` | Show Control, Signalfluss, Protokolle, Live-Event-Hardware. |
| `godmode-3d-creation` | MCP-first 3D-Generierung, Mesh-Rekonstruktion, parametrisches CAD. |
| `godmode-media-creation` | Video, Timeline-Montage, Motion-Design-Pipelines. |
| `godmode-hardware-pcb` | Schemata, PCB-Layout, KiCad ERC/DRC/DFM Gate, Gehäuse-Co-Design. |

Andere beachtenswerte Einstiegspunkte: `ask-tim` (welcher Skill passt), `bdbrainstorm` und `bdbmediastorm` (Multi-Agent-Ideation, die in einem Plan endet), `teamwork-preview` (Prompt-Handwerk und Delegation), die `grilling` Familie (`grill-me`, `grill-with-docs`, `triage`), `ci-pipeline` und die `github-actions-*` / `dockerfile-*` / `makefile-*` Generatoren und Validatoren, `bdb-security-audit`, `bdbresilience`.

Die Bibliothek ist auch durch die `skills` CLI lesbar:

```bash
npx skills add hybridlabor-api/aos
```

---

## MCP-Server

[`mcp_config.json`](mcp_config.json) definiert <!-- count:mcps -->21<!-- /count --> Server, vom Installationsprogramm aus `mcps/` gebaut oder gewärmt und in jedes Harness MCP-Konfiguration zusammengeführt:

- **Creative software:** Unreal Engine, Rhino / Grasshopper (Primär + Fallback), DaVinci Resolve, Blender, After Effects (Primär + Fallback), Adobe UXP Bridge, TouchDesigner (MindDesigner `tdmcp` + Backup), grandMA3, Resolume, Open Design.
- **OS control:** `zavora_computer_use` (macOS / Linux, native binary), `bdb_windows_computer_use`.
- **Memory and delegation:** `memb_mcp`, `deja`, `mcsc`.
- **Infrastructure:** `github`, `chrome-devtools`, `bdb_remoteos_mcp` (Multi-Cloud-Gateway mit 4-Augen-Genehmigungen).

Jeder Creative-Server hat eine Guide-Skill (`bdb-unreal-mcp`, `bdb-touchdesigner-mcp`, `bdb-davinci-mcp`, ...), die dem Agent die Tool-Signaturen beibringt. Pro-Server-Ports, Primär-/Fallback-Paare und Plattform-Notizen: [docs/mcp-servers.md](docs/mcp-servers.md).

---

## Optionale Module

Das Modul-Wahlprogramm des Installationsprogramms bietet an, und Quick Update hält es aktuell:

| Modul | Paket |
|---|---|
| memB | `@hybridlabor-api/memb` |
| Synapse | `@hybridlabor-api/bdb-synapse` |
| Heimdall Token Saver (CLI-Ausgabe-Komprimierungs-Hooks) | `@hybridlabor-api/heimdall-token-saver` |
| AO — Agent Orchestrator (Parallele Agents in Git Worktrees) | `@hybridlabor-api/bdb-agent-orchestrator` |
| Creator Extension (ComfyUI, Image-to-3D, Video) | `@hybridlabor-api/bdb-dev-creator-extension` |
| Hardware & PCB (KiCad and OpenSCAD Design-Modul, angetrieben durch `godmode-hardware-pcb`) | `@hybridlabor-api/bdb-hardware-pcb` |
| OS Remote (Remote-Ausführungs-Gateway) | `@hybridlabor-api/bdb-os-remote` |

Details für jeden: [docs/ecosystem.md](docs/ecosystem.md).

---

## Aktualisieren

Führe den gleichen Befehl erneut aus. Das Installationsprogramm sieht die installierte Version, bietet **Quick Update** an und aktualisiert Skills, Hooks, Templates und Module:

```bash
npx -y @hybridlabor-api/aos@latest
```

Es gibt keinen `aos update` Unterbefehl. Wenn du einmal `npm i -g @hybridlabor-api/aos` ausführtest, führt ein einfaches `aos` auf deinem PATH diese gefrorene Kopie und ihre Version aus, nicht die neueste; aktualisiere sie entweder (`npm i -g @hybridlabor-api/aos@latest`) oder entferne sie und bleibe bei `npx`. Das Installationsprogramm gibt selbst den Update-Befehl aus, wenn eine neuere Version existiert; die `bdb-updater` Skill umschließt die gleiche Überprüfung zur Verwendung innerhalb einer Session.

## Deinstallieren

```bash
aos-uninstall              # removes what AOS installed; memory, wikis and credentials stay
aos-uninstall --purge      # also removes ~/.MemBDB, ~/.openwiki, ~/.synapse, ~/.memb
aos-uninstall --dry-run    # list everything, delete nothing
```

Das Deinstallationsprogramm arbeitet aus dem Installationsmanifest: Eine Datei, die immer noch den Hash entspricht, den AOS geschrieben hat, wird entfernt, eine Datei, die du bearbeitet hast, wird stattdessen gesichert, eine Datei, die AOS nie geschrieben hat, wird nicht berührt. Die gleiche Aktion ist im Installer-Menü.

---

## Mitwirken

- [AGENTS.md](AGENTS.md) ist die einzige Quelle der Regeln für jeden Harness: die Skill-Vertrag, Kategorie-Routing, das Release-Gate, Conventional Commits.
- Ein Skill ist ein Verzeichnis mit `SKILL.md`; das Frontmatter braucht `name` (gleich dem Verzeichnisnamen), `description` und `category`. `npm run validate` erzwingt den Vertrag, ebenso CI bei jedem Push.
- `npm test` führt den Validator-Selbsttest, die Plugin-Manifest-Prüfung und das Installationsprogramm, Store, Doctor und Cross-Harness-Hook Tests durch.
- `.claude-plugin/plugin.json` und `marketplace.json` werden von `npm run plugin:build` generiert und durch `npm run plugin:check` überprüft. Sie existieren heute; der Claude Code Marketplace-Installationspfad wird noch finalisiert, daher bleibt das obige Installationsprogramm der unterstützte Weg.
- Releases werden von Release-Please aus Conventional Commits geschnitten; keine manuelle `package.json` Stoß. `feat:` bedeutet einen Minor-Stoß.
- Skills, die von anderen Projekten abgeleitet sind, notieren `source:` im Frontmatter und einen Eintrag in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Links

- Package: [npmjs.com/package/@hybridlabor-api/aos](https://www.npmjs.com/package/@hybridlabor-api/aos)
- Source and issues: [github.com/hybridlabor-api/aos](https://github.com/hybridlabor-api/aos) · [issues](https://github.com/hybridlabor-api/aos/issues)
- [CHANGELOG.md](CHANGELOG.md) · [docs/skills_table.md](docs/skills_table.md) · [docs/cli.md](docs/cli.md) · [docs/mcp-servers.md](docs/mcp-servers.md) · [docs/ecosystem.md](docs/ecosystem.md)
- Sibling repos: [bdb-agent-orchestrator](https://github.com/hybridlabor-api/bdb-agent-orchestrator) · [bdb-synapse](https://github.com/hybridlabor-api/bdb-synapse) · [bdb-dev-creator-extension](https://github.com/hybridlabor-api/bdb-dev-creator-extension) · [bdb-hardware-pcb](https://github.com/hybridlabor-api/bdb-hardware-pcb) · [bdb-os-remote](https://github.com/hybridlabor-api/bdb-os-remote)

License: [Apache-2.0](LICENSE).
