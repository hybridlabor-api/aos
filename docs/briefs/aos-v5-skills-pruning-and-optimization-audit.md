# 🛡️ AOS v5 Skills-Pruning & Konsolidierungs-Audit

**Erstellt am:** 2026-10-10  
**Geprüfter Datenbestand:** `/Users/timrennings/dev/bdb-dev/aos-wt-v5/skills/` (271 registrierte Skills)  
**Beteiligte Prüf-Agenten:** `skill_reviewer` (Adversarial Token & Attention Auditor), `skill_auditor` (Manifest- & Redundanz-Prüfer)  
**Status:** Streng READ-ONLY Audit für die Master Session. Keine Dateien verändert oder gelöscht.

---

## 1. Executive Summary & Das Hauptproblem: Context-Bloat

* **Statische Token-Last:** 271 registrierte Skills erzeugen **~25.000 bis 35.000 Tokens statischen Overhead** vor jedem einzelnen User-Turn, da Name, Description und Trigger-Keywords in den Index geladen werden.
* **Attention Dilution / Fehl-Routings:** Modelle aktivieren falsche oder redundante Tools (z. B. 13 verschiedene Firecrawl-Skills statt nativer Webtools).
* **Ziel-Architektur:** 
  - **AOS Kernel (Core):** ~75 hocheffektive Must-Have Skills (Pipelines, Godmodes, Playbooks, GoGate, MemB).
  - **AOS Store (On-Demand via `aos store install`):** ~85 domänenspezifische Skills (n8n, Apify, Factory, spezifische ORMs/Frameworks).
  - **Prunen / Entfernen:** ~12 tote, veraltete oder triviale Skills.
  - **Konsolidieren:** Zusammenführung von ~45 zersplitterten Einzelskills auf ~18 Power-Skills.
* **Ergebnis:** **>60% Reduktion des Context-Footprints** (>20.000 Tokens Ersparnis pro Turn) und sauberes, deterministisches Routing.

---

## 2. Detaillierte Liste der zu entfernenden Skills (Pruning-Kandidaten)

| Skill-Pfad | Begründung für das Entfernen |
|---|---|
| `skills/global_config/github-actions-templates/` | **Explizit veraltet.** Im Frontmatter steht `deprecated_by: github-actions-generator`. |
| `skills/global_config/gemini-api-integration/` | **Veraltetes SDK.** Nutzt alte `@google/generative-ai` SDKs; `gemini-api-dev` nutzt das neue `@google/genai`. |
| `skills/global_config/using-neon/` | **Reiner Stub (46 Zeilen).** Rät nur zu `curl https://neon.com/llms.txt`; wird komplett von `neon-postgres` abgedeckt. |
| `skills/global_config/grill-me/` | **Reiner 18-Zeilen Alias.** Ruft nur `grilling` auf. |
| `skills/global_config/quick-recap/` | **Trivialer Bloat (56 Zeilen).** Fügt lediglich 3 Status-Emojis an. Keine funktionale Logik. |
| `skills/global_config/bash-linux/` | **LLM-Trivialitäts-Bloat.** Erklärt Standard-Befehle (`cat`, `ls`, `head`, `kill -9`), die LLMs nativ beherrschen. |
| `skills/global_config/clean-code/` | **Generische Lehrbuch-Floskeln.** Keine Tool-Anbindung; gehört in System-Prompts, nicht als eigenständiger Skill. |
| `skills/global_config/planning-with-files/` | **Konflikt mit AOS-Architektur.** Erzeugt veraltete Manus-Dateien (`task_plan.md`), die das offizielle Plan-Canvas & `production_artifacts/`-Modell unterlaufen. |
| `skills/basic/bdbhtmlmanueldocs/` | **Altes Projekt-Artefakt.** Enthält Tippfehler im Namen (`manuel`) und hardcodierte HTML-Dateien speziell für "BDB OS Remote v1.1.0". |
| `skills/global_config/web-artifacts-builder/` | **Spezifisch für Claude.ai Web-Uploads.** Kaputtes Manifest, inkompatibel mit Multi-Harness (Codex/Agravity). |
| `skills/global_config/frontend-dev-guidelines/` | **Redundant & eigenwillig.** Erfindet eigene Formeln wie "FFCI", kollidiert mit `godmode-ui-ux` und `react-best-practices`. |
| `skills/global_config/llm-application-dev-ai-assistant/` | **Kaputtes Manifest.** Bricht mitten im Satz ab (`with natur`), enthält unaufgelöste Variablen (`$ARGUMENTS`), redundant zu `ai-agent-development`. |

---

## 3. Die wichtigsten Konsolidierungs-Cluster

### Cluster A: Firecrawl (13 Skills -> 2 Skills)
- **Aktuell:** `firecrawl`, `firecrawl-agent`, `firecrawl-build`, `firecrawl-build-interact`, `firecrawl-build-onboarding`, `firecrawl-build-scrape`, `firecrawl-build-search`, `firecrawl-crawl`, `firecrawl-download`, `firecrawl-interact`, `firecrawl-map`, `firecrawl-scrape`, `firecrawl-search`.
- **Lösung:** Mergen in:
  1. `firecrawl`: Alle CLI- und Agent-Tools (Scrape, Crawl, Map, Search, Interact).
  2. `firecrawl-sdk`: Alle SDK- und Entwickler-Integrationsmuster.

### Cluster B: DevOps Generatoren & Validatoren
- `dockerfile-generator` (1.039 Zeilen!) und `dockerfile-validator` -> in `docker-expert` integrieren.
- `bash-script-generator` & `bash-script-validator` -> in `os-scripting` integrieren.
- `makefile-generator` & `makefile-validator` -> zu `makefile-pro` bündeln.

### Cluster C: Frontend & Design-Systeme
- Die 8 **StyleSeed Toss Skills** (`ui-component`, `ui-page`, `ui-pattern`, `ui-review`, `ui-tokens`, `ux-audit`, `ux-feedback`, `ux-flow`) sind hart auf das südkoreanische Fintech Toss verdrahtet.
- **Lösung:** Aus dem Standard-Kernel entfernen und als optionales `styleseed-toss-pack` in den AOS Store auslagern.
- Alle allgemeinen UI-Regeln verbleiben autoritativ in `godmode-ui-ux`.

---

## 4. Synergie mit `claude-task-master` & `fabric`

1. **`claude-task-master` als Cross-Harness State Sync (MCP):**
   - Löst das Problem, dass Modelle bei langen Tasks den Fokus verlieren.
   - Bildet den Aufgabenbaum als echten Directed Acyclic Graph (DAG) ab.
   - Füttert jedem Harness (Claude Code, Agravity, Codex, OpenCode) atomar genau den nächsten Schritt.
2. **`danielmiessler/fabric` als Skill- & Prompt-Standard:**
   - Standardisiert die verbleibenden Skills nach der strikten Fabric-Anatomie (`# IDENTITY` -> `# STEPS` -> `# OUTPUT FORMAT`).
   - Ermöglicht extrem schnelle Headless-CLI-Pipes (`git diff | aos pattern git-pr-review`).
