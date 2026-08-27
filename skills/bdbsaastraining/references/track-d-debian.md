# Track D — Clean Debian / Datenbank / Worker

**Ziel-Workload:** generischer System-Container (PostgreSQL, Redis, BullMQ-Worker, Cron-Jobs …), selbst konfiguriert.
**Basis-Template:** KEINES — es gibt kein `profile-debian-clean.yaml`. Station 2 = Profil von Grund auf.
**Container:** `c-D-<TRAINEE_USER>` · **Profil:** `D-<TRAINEE_USER>`

> Hinweis: Das MCP-Schema kennt `template="debian-clean"`, aber `incus_client.create_from_profile` erwartet ein Incus-Profil dieses Namens auf dem Host — das existiert nicht. Deshalb geht Track D bewusst den manuellen `incus profile create/edit`-Weg. Das ist der eigentliche Lernwert: „Custom Profile Engineering".

---

## Station 2 — Incus Profile von Grund auf (Track D)

### 2.1 Vergleichsbasis
Der Trainee öffnet EIN mitgeliefertes Template (z. B. `profile-ai-agent.yaml`) nur als Formvorlage und markiert, was für einen minimalen DB-Container **weg** kann (nodejs, npm, build-essential, rbash-User).

### 2.2 Interview → minimales Profil
- Workload-Art: PostgreSQL / Redis / Node-Worker (BullMQ) / „nur Debian, ich installiere selbst"
- RAM: 1 / 2 / 4 GiB (Node-Limit ≤ 8)
- CPU-Kerne: 1 / 2 · CPU-Deckel: `limits.cpu.allowance` 50% / 100%
- Disk-Quota: 10 / 20 / 30 GiB
- Persistenter Datenpfad als eigenes `devices:`-Disk (empfohlen für DB): ja / nein

```bash
python3 ~/.agents/skills/bdbsaastraining/scripts/build_profile.py \
    --track D --user <TRAINEE_USER> \
    --workload postgres --ram 2 --cpu 2 --cpu-allowance 50 --disk 20 --data-device yes
```
Ergebnis-Skelett (illustrativ, real generiert der Generator):
```yaml
config:
  limits.cpu: "2"
  limits.cpu.allowance: 50%
  limits.memory: 2GiB
  cloud-init.user-data: |
    #cloud-config
    package_update: true
    packages: [postgresql, postgresql-client]
    runcmd:
      - systemctl enable --now postgresql
description: "RC Cloud Clean Debian — postgres (D-<TRAINEE_USER>)"
devices:
  data:
    type: disk
    pool: default
    source: ""
    path: /var/lib/postgresql
    size: 20GiB
```

### 2.3 Registrieren & prüfen
```bash
sudo incus profile create D-<TRAINEE_USER>
sudo incus profile edit D-<TRAINEE_USER> < ~/profile-D-<TRAINEE_USER>.yaml
sudo incus profile show D-<TRAINEE_USER>
```

**Verständnisfrage 2 → `exam-pool.md` → `D_1`** (Profil von Grund auf) oder `D_4` (limits.cpu.allowance).

---

## Station 3 — Deployment & Verify (Track D)

```bash
sudo incus launch images:debian/13 c-D-<TRAINEE_USER> -p default -p D-<TRAINEE_USER>
sudo incus exec c-D-<TRAINEE_USER> -- cloud-init status --wait
```
Verifikation je nach Workload:
```bash
# postgres:
sudo incus exec c-D-<TRAINEE_USER> -- sudo -u postgres psql -c "SELECT version();"
# redis:
sudo incus exec c-D-<TRAINEE_USER> -- redis-cli ping
# quota-check:
sudo incus config show c-D-<TRAINEE_USER> | grep -E 'limits|size'
```

**Verständnisfrage 3 → `exam-pool.md` → `D_2`** (Snapshot/Migration).

---

## Station 4 — FastMCP & Guardrails

Gemeinsamer Ablauf. Track-D-Betonung: Lifecycle über MCP —
```
remoteos_manage_instance(container_name="c-D-<TRAINEE_USER>", action="stop",  reason="Bootcamp D Lifecycle-Test")
remoteos_manage_instance(container_name="c-D-<TRAINEE_USER>", action="start", reason="Bootcamp D Lifecycle-Test")
```
`start`/`stop` → sofort (`RiskLevel.STAGING`). `restart`/`delete` → Queue.

**Track-Fragen:** `D_1`, `D_2`, `D_3`, `D_4`.

---

## Station 5 — Bewusst KEINE öffentliche Route (Track D)

Ein DB/Worker-Container gehört **nicht** ins öffentliche Internet. Zwei Optionen:

**Option 1 — nur intern über die Bridge:** Die App im selben Netz erreicht die DB über die Container-IP auf `incusbr0`. Nichts weiter zu tun.

**Option 2 — gezieltes Port-Forwarding zum Host (kein Caddy, kein DNS):**
```bash
sudo incus config device add c-D-<TRAINEE_USER> pg proxy \
    listen=tcp:127.0.0.1:15432 connect=tcp:127.0.0.1:5432
```
→ DB nur auf `127.0.0.1:15432` des Hosts, erreichbar für lokale Prozesse / SSH-Tunnel, nie extern.

Wenn der Trainee doch eine Admin-Weboberfläche (pgAdmin) exponieren will → wie Track B, aber `require_auth=True` ist Pflicht und Cloudflare `🟠 proxied`.

**Verständnisfrage 5 → `exam-pool.md` → `D_3`** (keine öffentliche Route für DB).
