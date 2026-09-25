# 🔍 Review Handover: AOS v4.7.1 Release Candidate & Cross-Ecosystem Sync

> **Zweck dieses Dokuments:**  
> Detaillierte Übergabe für den Review-Agenten zur Durchführung eines unabhängigen, adversarialen Audits (Doubt-Driven-Development) des anstehenden Release-Stands **v4.7.1 (PR #57)** sowie der ungesendeten Commits in **AO** und **MCSC**.

---

## 1. Absolute Pfade & Repositories

| Komponente | Absoluter Pfad im Dateisystem | Branch / Referenz | Zustand |
|---|---|---|---|
| **AOS Kernel** | `/Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills` | `release/v4.7.1` | **PR #57** auf GitHub aktiv |
| **AO Orchestrator** | `/Users/timrennings/dev/agents/bdb-agent-orchestrator` | `main` | 27 Commits lokal voraus |
| **MCSC Gateway** | `/Users/timrennings/dev/sandbox/multi-cli-subagent-configurator` | `main` | 2 Commits lokal voraus |

---

## 2. Zu prüfende Kern-Dateien in AOS (`release/v4.7.1`)

1. **System-Checkup & Diagnostik:**
   - [`/Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/bin/aos-doctor.mjs`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/bin/aos-doctor.mjs)
   - [`/Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/tests/aos-doctor.test.mjs`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/tests/aos-doctor.test.mjs)
2. **Installer & CLI-Integration:**
   - [`/Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/installer.js`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/installer.js) (AO Beta-Banner, `doctor`-Routing, Windows `.cmd`/`.ps1`-Wrapper)
   - [`/Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/package.json`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/package.json)
3. **Offline ECC Store:**
   - [`/Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/bin/aos-store.mjs`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/bin/aos-store.mjs)
   - [`/Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/lib/ecc-store-index.json`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/lib/ecc-store-index.json)
   - [`/Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/tests/aos-store.test.mjs`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/tests/aos-store.test.mjs)
4. **MCSC & Native Todo-Streaming:**
   - [`/Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/mcp_config.json`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/mcp_config.json)
   - [`/Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/skills/global_config/mcsc/SKILL.md`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/skills/global_config/mcsc/SKILL.md)
   - [`/Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/skills/global_config/agenttrail/bin/agenttrail.mjs`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/skills/global_config/agenttrail/bin/agenttrail.mjs)
5. **Archify-Verträge & Security-Hardening:**
   - [`/Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/lib/aos-archify-contract.mjs`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/lib/aos-archify-contract.mjs)
   - [`/Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/skills/global_config/plan-canvas/scripts/lib/plan-canvas/server.js`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/skills/global_config/plan-canvas/scripts/lib/plan-canvas/server.js)

---

## 3. Kritisches Prüf-Raster (Fokus für das Audit)

1. **Cross-Platform Robustness (macOS vs. Windows):**
   - Prüfe, ob in `aos-doctor.mjs` und `installer.js` Windows-Pfade korrekt aufgelöst werden (`where.exe`, `%APPDATA%`, `process.platform === 'win32'`).
   - Stelle sicher, dass der AMFI-Codesigning-Check (`codesign -v`) unter Windows und Linux nicht crasht, sondern übersprungen wird.
2. **Sicherheits-Grenzen & Path Traversal:**
   - Verifiziere die Funktion `resolveWithinDir` in Plan-Canvas: Verhindert sie zuverlässig Directory-Traversal (`../../etc/passwd`)?
   - Verifiziere die Funktion `readCapped` in AgentTrail: Schützt sie zuverlässig vor Memory Exhaustion (OOM) bei Payload-Größen > 1 MB?
3. **Hook-Interferenz & GO-Gate:**
   - Stelle sicher, dass keine der neuen CLI-Tools die Hooks `go-gate.mjs` oder `graph-gate.mjs` umgehen oder blockieren.
4. **Offline-Funktionalität:**
   - Teste, dass `aos-store` und `aos-doctor` offline ohne Netzwerkaufrufe stabil funktionieren (außer bei expliziter Flagge `--net`).

---

## 4. Test-Befehle zur Verifikation

```bash
# 1. Alle Unit-Tests im AOS-Repo ausführen
npm --prefix /Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills test

# 2. Spezifische Sicherheits- und Integrations-Suiten testen
node /Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/tests/agenttrail-security.test.mjs
node /Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/tests/plan-canvas-security.test.mjs
node /Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/tests/archify-contract.test.mjs

# 3. Doctor-Funktion im JSON-Modus prüfen
node /Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/bin/aos-doctor.mjs --json
```

---

## 5. Output-Anforderung an den Review-Agenten

Der Review-Agent soll seinen Bericht nach folgendem Standard strukturieren:
- **Klassifizierung:**
  - `[CONTRACT_MISREAD]` (Blocker: Verstoß gegen Architekturverträge)
  - `[VALID_ACTIONABLE]` (Blocker: Echter Bug oder Sicherheitslücke)
  - `[TRADEOFF]` (Non-Blocker: Akzeptable technische Einschränkung)
  - `[NOISE]` (Unwichtig: Stil-/Kosmetik-Hinweise)
- **Ergebnis-Datei:**  
  Speichern unter `/Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/production_artifacts/review_findings.md`.
