# Track E — Custom Workload (frei beschrieben)

**Auslöser:** Der Trainee hat in Station 0 „Other" / `E)` gewählt und seinen Workload in eigenen Worten beschrieben.
**Ziel:** Aus dem Freitext ein reales, valides Incus-Profil ableiten und das Training an den passenden Basis-Track andocken.

---

## E.0 — Interview (nach dem Freitext)

Frage strukturiert nach, was im Freitext fehlt. Nutze `AskUserQuestion` / Text-Schema:

1. **Grundcharakter** → bestimmt das Basis-Muster:
   - „öffentlich per HTTP(S) erreichbar, mit Login" → **B-Muster** (Caddy + Authelia + Cloudflare proxied)
   - „E-Mail / SMTP / IMAP" → **C-Muster** (DNS-Blueprint, DNS-only)
   - „nur intern / Datenbank / Worker / Batch" → **D-Muster** (keine öffentliche Route)
   - „autonome Agenten / Code-Ausführung" → **A-Muster** (rbash, ai_agents, agent-sudo)
2. **Ressourcen:** RAM (1–8 GiB), CPU (1–2), CPU-Deckel (50/100 %), Disk (10–60 GiB)
3. **Pakete:** welche Dienste/Runtimes? (Freitext-Liste, Generator validiert gegen Debian-13-Paketnamen und warnt bei Unbekanntem)
4. **Ports:** welche TCP-Ports lauscht der Dienst? intern / öffentlich?
5. **Auth:** braucht der öffentliche Endpunkt Authelia-2FA? (Default: ja, wenn öffentlich)
6. **Persistenz:** eigener Daten-`devices:`-Block? (Default ja bei DB-artigen Workloads)

Speichere: `<E_BASE>` ∈ {A, B, C, D}.

---

## E.1 — Profil generieren

```bash
python3 ~/.agents/skills/bdbsaastraining/scripts/build_profile.py \
    --track E --user <TRAINEE_USER> \
    --base <E_BASE> \
    --ram <N> --cpu <N> --cpu-allowance <50|100> --disk <N> \
    --packages "pkg1,pkg2,pkg3" \
    --ports "8000/public,9000/internal" \
    --auth <yes|no> --data-device <yes|no> \
    --describe "<originaler Freitext des Trainees>"
```

Der Generator:
- nimmt das `<E_BASE>`-Template als Ausgangsbasis (bzw. ein Minimal-Skelett bei `--base D`),
- ersetzt `packages:` durch die validierte Liste,
- setzt `limits.*` aus den Sizing-Antworten,
- **warnt** (nicht abbricht) bei: `ram > 8`, `disk > 100`, unbekannten Paketnamen, öffentlichem Port ohne `--auth yes`,
- entfernt Top-Level `name:`,
- schreibt `~/profile-E-<TRAINEE_USER>.yaml` + zeilenweise Erklärung + Liste aller Warnungen.

Bei `ram > 8`: Hinweis, dass der Primary-Node (`ram_gb ≤ 8` im MCP-Schema) das nicht trägt → Workload auf Auxiliary-Node (Oracle, 24 GB) planen.

---

## E.2 — Station 2 / 3 / 5 nach Basis-Muster

Ab hier folgst du der Datei des Basis-Tracks `<E_BASE>` für Struktur und Befehle, aber mit den Custom-Werten:

| `<E_BASE>` | Station 2/3 wie | Station 5 wie |
| :-- | :-- | :-- |
| A | `track-a-ai-agent.md` (rbash-User, Sandbox-Task) | interne Gateway-Route, `require_auth=True` |
| B | `track-b-wordpress.md` (Stack-Verify per `curl`) | öffentliche Route, Caddy forward_auth, CF `🟠 proxied` |
| C | `track-c-mailserver.md` (`postconf`, Ports) | `remoteos_get_dns_blueprint(service_type="mail")`, `⚪ DNS-only` |
| D | `track-d-debian.md` (minimal, Quotas, Snapshot) | keine öffentliche Route / `incus proxy` Device |

Container-Name: `c-E-<TRAINEE_USER>` · Profil: `E-<TRAINEE_USER>`.

Verifikation immer zuerst:
```bash
sudo incus profile show E-<TRAINEE_USER>
sudo incus launch images:debian/13 c-E-<TRAINEE_USER> -p default -p E-<TRAINEE_USER>
sudo incus exec c-E-<TRAINEE_USER> -- cloud-init status --wait
```

---

## E.3 — Station 4 (gemeinsam)

Wie in `SKILL.md`, mit `container_name="c-E-<TRAINEE_USER>"` und Pflichtfeld `reason`.

---

## Prüfung — Track E

**Track-Fragen:** `E_1`, `E_2`, `E_3`, `E_4` (aus `exam-pool.md`).
Zusätzlich: Wenn `<E_BASE>` z. B. `B` war, darf der Tutor bis zu 2 der 4 Track-Fragen durch passende `B_*`-Fragen ersetzen, damit die Prüfung zum tatsächlich Gelernten passt. Immer 6 Kern + 4 Track = 10.
