# 🔍 Adversarial Review Brief: AOS v4.7.2 Release Candidate (PR #59)

> **Zweck:** Unabhängige, adversariale Überprüfung (Doubt-Driven Development) der Änderungen für Release **v4.7.2** zur Behebung der Review-Findings **F-01 bis F-04**.  
> **Repository:** `/Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills`  
> **Branch:** `release/v4.7.2`  
> **Commit:** `55f5907`  
> **PR:** [hybridlabor-api/aos#59](https://github.com/hybridlabor-api/aos/pull/59)  

---

## 1. Übersicht der Änderungen

| Finding | Klasse | Datei(en) | Beschreibung des Fixes |
|---|---|---|---|
| **F-01** | `[CONTRACT_MISREAD]` | [`bin/aos-doctor.mjs`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/bin/aos-doctor.mjs) | `NET`-Flag verdrahtet: Version-Check gegen npm wird ohne `--net` übersprungen (100% offline-first). Mit `--net` wird die Version abgefragt. |
| **F-02** | `[VALID_ACTIONABLE]` | [`bin/aos-store.mjs`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/bin/aos-store.mjs) | Offline-Guard: `download()` erfordert zwingend `--net`. Dispatcher & Docs angepasst. `--dry-run` bleibt netzwerkfrei. |
| **F-03** | `[VALID_ACTIONABLE]` | [`bin/aos-doctor.mjs`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/bin/aos-doctor.mjs) | Shell-Injection eliminiert: `execSync(\`codesign -v "${aoBin}"\`)` durch `execFileSync('codesign', ['-v', aoBin], { stdio: 'ignore' })` ersetzt. |
| **F-04** | `[VALID_ACTIONABLE]` | [`installer.js`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/installer.js), [`bin/aos-doctor.mjs`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/bin/aos-doctor.mjs) | Windows-Probes auf `where.exe` vereinheitlicht. POSIX `command -v` mit Regex `^[a-zA-Z0-9._-]+$` gegen Command-Injection gehärtet. |

Zusätzlich wurden Unit Tests für `--net` vs. offline in [`tests/aos-doctor.test.mjs`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/tests/aos-doctor.test.mjs) und [`tests/aos-store.test.mjs`](file:///Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills/tests/aos-store.test.mjs) ergänzt.

---

## 2. Checkliste für den Reviewer

Prüfe die folgenden Punkte kritisch und adversarial:

1. **Keine verbleibende Shell-Injection:**
   - Gibt es in `bin/aos-doctor.mjs` oder `installer.js` noch String-Interpolationen in `execSync`?
   - Ist die Regex `^[a-zA-Z0-9._-]+$` für `command -v ${binary}` in `installer.js` ausreichend restriktiv?
2. **Offline-First Vertrag eingehalten:**
   - Läuft `node bin/aos-doctor.mjs --json` ohne Internetverbindung komplett durch, ohne Netzwerk-Sockets auf externe IPs zu öffnen?
   - Verweigert `node bin/aos-store.mjs install <skill>` ohne `--net` reproduzierbar den Download?
3. **Cross-Platform Robustheit:**
   - Verhält sich `where.exe` unter Windows erwartungsgemäß?
   - Werden Nicht-Windows-Systeme (macOS, Linux Container) durch den `IS_WIN`-Pfad nicht beeinträchtigt?
4. **Test-Vollständigkeit:**
   - Laufen alle Tests (`npm test` und Security Suites) lokal fehlerfrei durch?
   - Testen die neuen Tests in `tests/aos-doctor.test.mjs` und `tests/aos-store.test.mjs` echte Grenzfälle oder sind sie trivial?

---

## 3. Verifikations-Befehle

```bash
cd /Users/timrennings/dev/bdb-dev/bdb-dev-optimized-agent-skills
git checkout release/v4.7.2

# 1. Diff zum Main-Branch prüfen
git diff origin/main..HEAD

# 2. Offline-Test des Doctors
node bin/aos-doctor.mjs --json

# 3. Online-Test des Doctors
node bin/aos-doctor.mjs --json --net

# 4. Offline-Guard des Stores
node bin/aos-store.mjs install django-patterns --project
# (Muss mit "requires internet access ... Pass --net" abbrechen)

# 5. Volle Testsuite ausführen
npm test

# 6. Security- & Contract-Suites
node --test tests/agenttrail-security.test.mjs tests/plan-canvas-security.test.mjs tests/archify-contract.test.mjs tests/mcsc-registration.test.mjs
```

---

## 4. Erwartetes Format des Review-Reports

Klassifiziere alle gefundenen Punkte nach folgendem Schema:
- `[CONTRACT_MISREAD]`: Bruch eines definierten Vertrages (z. B. Offline-First, API-Signatur, Schema).
- `[VALID_ACTIONABLE]`: Echter Bug, Sicherheitslücke oder unerwünschte Regression mit konkretem Handlungsbedarf.
- `[VALID_TRADEOFF]`: Bewusste Architekturentscheidung mit dokumentiertem Trade-off (kein Blocker).
- `[NOISE]`: Stilistische Präferenzen ohne technische Auswirkung.

**Urteil:** `SHIP` oder `DO NOT SHIP` mit Begründung.
