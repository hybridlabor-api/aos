# Interaktionsmodi — Dual-Mode Kontrakt

Der Trainings-Skill läuft in fünf Clients. Nur **Claude Code** hat ein natives Auswahl-Tool.
Der Tutor erkennt den Client aus Station 0 (`<CLIENT_NAME>`) und wählt den Modus **einmal** für die gesamte Session.

---

## Modus 1 — Claude Code: `AskUserQuestion`

Nutze das Tool für **jede** strukturierte Auswahl:
- Track-Wahl (Station 0, Teil B)
- Sizing-/Konfig-Entscheidungen (CPU/RAM/Disk, DNS-Proxy-Modus, Auth ja/nein)
- alle Multiple-Choice-Verständnisfragen
- alle 10 Abschlussfragen

Regeln:
- 2–4 echte Optionen pro Frage. Die vom Skill empfohlene Option steht an Position 1 mit `(Empfohlen)` im Label.
- `header` ≤ 12 Zeichen (z. B. `Track`, `RAM`, `DNS-Modus`, `Frage 3`).
- **„Other" (Freitext) fügt das Tool automatisch hinzu** — nicht selbst als Option auflisten.
- `preview` einsetzen, wenn **Vergleich** der Kern ist: YAML-Profilvarianten nebeneinander, Ressourcen-Sizing, `🟠 proxied` vs `⚪ DNS-only`. NICHT bei einfachen Ja/Nein-Abzweigungen.
- Single-Select als Default. `multiSelect: true` nur wenn Mehrfachauswahl fachlich sinnvoll ist (z. B. „welche Zusatzpakete brauchst du?").

Auswertung:
- Gewählte Option → direkt weiterverarbeiten.
- „Other"-Freitext → siehe Freitext-Regeln unten.

---

## Modus 2 — AGY / Cursor / Claude Desktop / OpenCode / unbekannt: Text-Schema

Formatiere jede Auswahl als nummerierte Liste:

```
<Frage>

  A) <Option 1>
  B) <Option 2>
  C) <Option 3>
  D) <Option 4>
  E) etwas anderes → beschreib es in eigenen Worten
```

- `E)` ist der Freitext-Kanal (Äquivalent zu „Other").
- Bei Verständnisfragen mit nur 2–4 Sachoptionen entfällt `E)` **nur in der Abschlussprüfung** (dort ist Freitext ungültig); in Stationsfragen bleibt `E)` erhalten.
- **Fehleingaben still normalisieren:** `b`, `b.`, `B)`, „Antwort B", „die zweite", „option 2" → alle zu `B`. Nicht belehren, einfach die gemeinte Option verarbeiten.
- Mehrdeutige oder leere Antwort → einmal kurz rückfragen: „Meinst du A oder C?"

---

## Freitext-Regeln (modusübergreifend)

| Kontext | Freitext erlaubt? | Verhalten |
| :-- | :-- | :-- |
| Station 0 Teil A (Name, User, Client) | ja, immer offen | direkt übernehmen |
| Station 0 Teil B (Workload) | **ja, erwünscht** | Freitext → **Track E**, Rohziel für `build_profile.py` merken |
| Sizing-/Konfig-Fragen (Station 2, Track E) | **ja, erwünscht** | Freitext parsen (Zahlen, Paketnamen, Ports); bei Lücken gezielt nachfragen |
| Zwischen-Verständnisfragen der Stationen 0.5–5 | ja | Freitext inhaltlich bewerten; bei „fast richtig" sokratisch nachhaken |
| **Abschlussprüfung (10 Fragen)** | **nein** | Freitext → **einmalig** um Auswahl A–D bitten. Bleibt Trainee bei Freitext → **0 Punkte** für die Frage, weiter zur nächsten |

---

## Mapping Workload-Auswahl → Track

| Auswahl Station 0 Teil B | Track | Track-Datei |
| :-- | :-- | :-- |
| A · AI-Agent Sandbox | `A` | `references/track-a-ai-agent.md` |
| B · WordPress / Web-App | `B` | `references/track-b-wordpress.md` |
| C · Mailserver | `C` | `references/track-c-mailserver.md` |
| D · Clean Debian / DB / Worker | `D` | `references/track-d-debian.md` |
| „Other" / E · Freitext | `E` | `references/track-e-custom.md` |

Track E kann nach dem Interview auf einen konkreten Basis-Track „andocken" (web-artig → B-Muster, mail-artig → C-Muster, intern → D-Muster). Die Track-E-Datei steuert das.

---

## Beispiel — Track-Wahl in beiden Modi

**Claude Code (`AskUserQuestion`):**
- question: „Was möchtest du auf der BDB SaaS Host Fleet konkret betreiben?"
- header: `Workload`
- options: `AI-Agent Sandbox` / `WordPress / Web-App` / `Mailserver` / `Clean Debian / DB / Worker`
- (Tool ergänzt „Other" automatisch → Track E)
- optional `preview` je Option: 4–6 Zeilen, was der Track lehrt + Basis-Template

**Text-Modus:**
```
Was möchtest du auf der BDB SaaS Host Fleet konkret betreiben?

  A) AI-Agent Sandbox    – autonome Agenten, restricted shell, agent-sudo
  B) WordPress / Web-App  – öffentlich, Caddy + Authelia 2FA, Cloudflare proxied
  C) Mailserver           – Froxlor/Postfix/Dovecot, eigene Kundendomain, DNS-Blueprint
  D) Clean Debian         – generischer Container, Datenbank/Worker, selbst konfiguriert
  E) etwas anderes → beschreib deinen Workload in eigenen Worten
```
