# Track B — WordPress / Web-App

**Ziel-Workload:** öffentlich erreichbare Web-Anwendung hinter Caddy + Authelia 2FA.
**Basis-Template (real):** `server-config/templates/incus/profile-wordpress.yaml`
**Container:** `c-B-<TRAINEE_USER>` · **Profil:** `B-<TRAINEE_USER>`

---

## Station 2 — Incus Profile Engineering (Track B)

### 2.1 Echtes Template inspizieren
`profile-wordpress.yaml`:
- `config.limits.cpu: "2"`, `config.limits.memory: 4GiB`.
- `config.cloud-init.user-data` → `#cloud-config` mit `package_update: true`, `package_upgrade: true`.
- `packages:` nginx, mariadb-server, redis-server, php-fpm, php-mysql, php-redis, php-curl, php-gd, php-xml, php-mbstring, certbot.
- `runcmd:` — erzeugt DB `wp` + User `wp` mit Zufallspasswort (`openssl rand -hex 16` → `/root/.wp-db-credentials`, `chmod 0600`), dann `systemctl enable --now nginx mariadb redis-server php8.2-fpm`.
- **kein `devices:`** → aus `default`.

**Bekannter Bug (Diagnose-Übung):** `php8.2-fpm` ist hart kodiert. Debian 13 (trixie) liefert PHP 8.4 → die Unit `php8.2-fpm` existiert nicht, der `systemctl`-Aufruf schlägt fehl. Der Generator ersetzt das durch die real installierte Version (`php-fpm` Meta-Paket → Dienst per `systemctl enable --now $(systemctl list-units 'php*-fpm*' ...)` bzw. parametrisiert `php8.4-fpm`).

### 2.2 Eigenes Profil generieren
Interview:
- RAM: 2 / 4 GiB (Default 4, Node-Limit ≤ 8)
- Disk-Quota: 20 / 40 / 60 GiB (Default 40)
- DB-Engine: MariaDB (Default) / PostgreSQL
- Object-Cache Redis: ja (Default) / nein
- WordPress automatisch per `wp-cli` installieren? ja / nein (nur Stack)

```bash
python3 ~/.agents/skills/bdbsaastraining/scripts/build_profile.py \
    --track B --user <TRAINEE_USER> \
    --ram 4 --disk 40 --db mariadb --redis yes --wpcli yes
```
Output: `~/profile-B-<TRAINEE_USER>.yaml`. Der Generator fixt den `php8.2-fpm`-Bug und fügt bei `--wpcli yes` einen `runcmd`-Schritt für `wp core download && wp config create ...` hinzu.

### 2.3 Registrieren & prüfen
```bash
sudo incus profile create B-<TRAINEE_USER>
sudo incus profile edit B-<TRAINEE_USER> < ~/profile-B-<TRAINEE_USER>.yaml
sudo incus profile show B-<TRAINEE_USER>
```

**Verständnisfrage 2 → `exam-pool.md` → `B_1`** (packages in cloud-init).

---

## Station 3 — Deployment & Verify (Track B)

```bash
sudo incus launch images:debian/13 c-B-<TRAINEE_USER> -p default -p B-<TRAINEE_USER>
sudo incus exec c-B-<TRAINEE_USER> -- cloud-init status --wait
sudo incus exec c-B-<TRAINEE_USER> -- systemctl --failed
```
Verifikation:
```bash
CT_IP=$(sudo incus list c-B-<TRAINEE_USER> -c4 --format csv | cut -d' ' -f1)
curl -sI "http://$CT_IP/" | head -1        # -> HTTP/1.1 200 / 301 (nginx lebt)
sudo incus exec c-B-<TRAINEE_USER> -- cat /root/.wp-db-credentials
```
Wenn `systemctl --failed` `php8.2-fpm` zeigt → Diagnose-Übung: `systemctl list-units 'php*'`, richtigen Dienstnamen finden, im generierten Profil ist es bereits gefixt (Trainee vergleicht).

**Verständnisfrage 3 → `exam-pool.md` → `B_4`** (php-Version-Bug).

---

## Station 4 — FastMCP & Guardrails

Gemeinsamer Ablauf (`SKILL.md`). Track-B-Betonung: `remoteos_create_instance` würde für einen echten Kunden so aussehen —
```
remoteos_create_instance(
    client_name="kunde-mueller",
    domain="shop.kunde-mueller.de",
    template="wordpress",
    environment="staging1",
    target_node="netcup",
    cpu_cores=2, ram_gb=4, disk_gb=40
)
```
`staging1` → sofort, `environment="production"` → 4-Augen-Queue (siehe `classify_risk`).

**Track-Fragen:** `B_1`, `B_2`, `B_3`, `B_4`.

---

## Station 5 — Öffentliche Web-Route (Track B)

```
remoteos_add_route(
    domain="app-<TRAINEE_USER>.<DOMAIN>",
    upstream_port=80,
    require_auth=True,
    target_node="netcup",
    service_type="web",
    sync_cloudflare=True
)
```
Erwartetes Verhalten (Konzept, da `/tools/add_route` Stub):
- Caddy bekommt `forward_auth 127.0.0.1:9091 { uri /api/authz/forward-auth ... }` + `reverse_proxy` auf die Container-IP.
- Cloudflare A-Record `app-<TRAINEE_USER>` → Netcup-IP, **`🟠 proxied`** (`service_type="web"` ⇒ `proxied: true`).

Verifikation auf dem Server:
```bash
sudo caddy validate --config /etc/caddy/Caddyfile
curl -sI https://app-<TRAINEE_USER>.<DOMAIN> | grep -Ei 'location|http/'   # -> 302 auth.<DOMAIN>
```
DNS-Blueprint für eine echte Kundendomain zusätzlich:
```
remoteos_get_dns_blueprint(domain="kunde-mueller.de", service_type="web")
```

**Verständnisfrage 5 → `exam-pool.md` → `B_2`** (proxied-Modus) oder `B_3` (forward_auth 302).
