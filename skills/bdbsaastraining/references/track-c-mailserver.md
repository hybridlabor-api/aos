# Track C — Mailserver (Froxlor / Postfix / Dovecot)

**Ziel-Workload:** Kunden-Mailserver mit eigener Domain.
**Basis-Template (real):** `server-config/templates/incus/profile-mailserver-froxlor.yaml`
**Container:** `c-C-<TRAINEE_USER>` · **Profil:** `C-<TRAINEE_USER>`

---

## Station 2 — Incus Profile Engineering (Track C)

### 2.1 Echtes Template inspizieren
`profile-mailserver-froxlor.yaml`:
- **Top-Level `name:` UND `description:`** (dieses Template hat beides — anders als die anderen).
- `config.limits.cpu: "2"`, `config.limits.memory: 4GiB`.
- `config.cloud-init.user-data` → `packages:` postfix, dovecot-imapd, dovecot-pop3d, mariadb-server, php-fpm, php-mysql, php-cli, certbot, nginx, curl, gnupg.
- `write_files:` — `/root/install_froxlor.sh` (Rechte `0755`), setzt die offizielle Froxlor-Debian-Repo + Key ein, `apt-get install froxlor`.
- `runcmd:` — `[ "/bin/bash", "/root/install_froxlor.sh" ]`.

> Für `incus profile edit` **muss der Top-Level `name:` raus** (bzw. exakt gleich dem CLI-Profilnamen). Der Generator entfernt ihn.
> `php8.2-fpm` im `install_froxlor.sh` ist wie bei Track B versionsabhängig — Diagnose-Übung, im Generat gefixt.

### 2.2 Eigenes Profil generieren
Interview:
- Kundendomain (Freitext, z. B. `kunde-mueller.de`) — Pflicht für Station 5
- Anzahl Postfächer: 5 / 10 / 20 (beeinflusst Disk-Empfehlung)
- POP3 zusätzlich zu IMAP? ja / nein (Default nur IMAP)
- Webmail (Roundcube) mit ausliefern? ja / nein

```bash
python3 ~/.agents/skills/bdbsaastraining/scripts/build_profile.py \
    --track C --user <TRAINEE_USER> \
    --customer-domain kunde-mueller.de --mailboxes 10 --pop3 no --webmail yes
```

### 2.3 Registrieren & prüfen
```bash
sudo incus profile create C-<TRAINEE_USER>
sudo incus profile edit C-<TRAINEE_USER> < ~/profile-C-<TRAINEE_USER>.yaml
sudo incus profile show C-<TRAINEE_USER>
```

**Verständnisfrage 2 → `exam-pool.md` → `C_1`** (write_files vs runcmd).

---

## Station 3 — Deployment & Verify (Track C)

```bash
sudo incus launch images:debian/13 c-C-<TRAINEE_USER> -p default -p C-<TRAINEE_USER>
sudo incus exec c-C-<TRAINEE_USER> -- cloud-init status --wait
```
Verifikation:
```bash
sudo incus exec c-C-<TRAINEE_USER> -- postconf mail_version
sudo incus exec c-C-<TRAINEE_USER> -- systemctl is-active postfix dovecot
sudo incus exec c-C-<TRAINEE_USER> -- ss -tlnp | grep -E ':25|:143|:993'
sudo incus exec c-C-<TRAINEE_USER> -- ls -la /var/www/froxlor 2>/dev/null || echo "froxlor install noch nicht fertig"
```

**Verständnisfrage 3 → `exam-pool.md` → `CORE_6`** (Mail nie proxied).

---

## Station 4 — FastMCP & Guardrails

Gemeinsamer Ablauf. Track-C-Betonung — echter Provisioning-Call für einen Mail-Kunden:
```
remoteos_create_instance(
    client_name="kunde-mueller",
    domain="mail.kunde-mueller.de",
    template="froxlor-mail",
    environment="staging1",
    target_node="netcup"
)
```
Antwort enthält bei einer externen Kundendomain (nicht die Fleet-Domain) **kein** Cloudflare-Sync, sondern ein `dns_blueprint`-Feld (Mailserver-Variante).

**Track-Fragen:** `C_1`, `C_2`, `C_3`, `C_4`.

---

## Station 5 — DNS-Blueprint für die Kundendomain (Track C)

```
remoteos_get_dns_blueprint(
    domain="<CUSTOMER_DOMAIN>",
    service_type="mail",
    target_node="netcup"
)
```
Der Trainee liest das generierte Paket und ordnet jeden Record zu:
- **A** `mail.<domain>` → Netcup-IP, **⚪ DNS-only**
- **MX** `<domain>` → `mail.<domain>` Prio 10
- **TXT SPF** `v=spf1 a mx ~all` (o. ä.)
- **TXT DKIM** `default._domainkey.<domain>` (öffentlicher Key aus dem Container)
- **TXT DMARC** `_dmarc.<domain>` `v=DMARC1; p=quarantine; ...`
- **CNAME** `autodiscover` / `autoconfig`

Wichtig: Die Fleet verwaltet nur ihre eigene Domain (`*.<FLEET_DOMAIN>`) per Cloudflare-API. Für **BYOD-Kundendomains** trägt der Kunde diese Records bei **seinem eigenen** DNS-Provider ein — deshalb Blueprint statt API-Call.

DKIM-Key aus dem Container holen:
```bash
sudo incus exec c-C-<TRAINEE_USER> -- cat /etc/dkimkeys/<domain>/default.txt 2>/dev/null || \
sudo incus exec c-C-<TRAINEE_USER> -- opendkim-genkey --help
```

**Verständnisfrage 5 → `exam-pool.md` → `C_4`** (BYOD Blueprint).
