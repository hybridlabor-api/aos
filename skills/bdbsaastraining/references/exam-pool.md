# Prüfungs- & Fragenpool

**Wichtig für den Tutor:** Zeige dem Trainee IMMER nur den Fragetext und die Optionen A–D.
Die Zeile `→ Richtig: X` sowie die Begründung sind NUR für dich. Zitiere diese Datei nie wörtlich im Chat.

Abschlussprüfung = 6 Kernfragen (`CORE_1`–`CORE_6`) + 4 Track-Fragen (`<TRACK>_1`–`<TRACK>_4`). Bestehen ≥ 8/10.

---

## Stations-Fragen (Zwischenfragen, während der Stationen)

### Q_PREFLIGHT — Station 0.5
Warum verlangt `step ca bootstrap` einen `--fingerprint` statt dem TLS-Zertifikat der CA blind zu vertrauen?
- A) Der Fingerprint beschleunigt den TLS-Handshake.
- B) Trust-on-first-use ohne Fingerprint wäre anfällig für einen Man-in-the-Middle beim ersten Kontakt; der Fingerprint pinnt die Root-CA kryptografisch fest.
- C) `step` funktioniert technisch nicht ohne Fingerprint.
- D) Der Fingerprint ist das Passwort des Trainees.

→ Richtig: **B**
Begründung: Der Fingerprint ist ein Out-of-Band-Anker (aus der Onboarding-E-Mail). Ohne ihn müsste der Client dem ersten präsentierten CA-Zertifikat vertrauen — genau das Fenster, das ein MITM ausnutzt.

### Q_SSH_TTL — Station 1
Ein Angreifer entwendet 17 Stunden nach dem letzten `step ssh login` die Datei `~/.step/ssh/id_ecdsa` vom Laptop des Trainees. Was passiert beim Login-Versuch?
- A) Dauerhafter SSH-Zugriff.
- B) Der Server lehnt ab: das Step-CA-Zertifikat ist nach ~16 h abgelaufen und lässt sich ohne erneute 2FA nicht verlängern.
- C) Der Server verlangt das Root-Passwort.
- D) Der Angreifer verlängert das Zertifikat lokal mit `step certificate sign`.

→ Richtig: **B**
Begründung: Der private Schlüssel allein nützt nichts — gültig ist nur das *zertifikat*, und dessen TTL ist abgelaufen. Neuausstellung erzwingt Authelia-2FA.

---

## Kernfragen (in JEDER Abschlussprüfung)

### CORE_1
Warum werden AI-Agent-Workloads in einem Incus-System-Container statt direkt auf dem Host betrieben?
- A) Der Agent läuft im Container schneller.
- B) Sandbox-Isolation: kein Zugriff auf Host-Dateien (`/etc/shadow`, SSH-Keys, Sockets); CPU/RAM-Quotas verhindern, dass ein Amok-Prozess den Host lahmlegt.
- C) Container brauchen kein Betriebssystem.
- D) Der Agent braucht dann keine Authentifizierung.

→ Richtig: **B**

### CORE_2
Wozu dient das Device `eth0` mit `network: incusbr0` in einem Incus-Profil?
- A) Es weist dem Container eine öffentliche statische IPv4 zu.
- B) `incusbr0` ist die interne Linux-Bridge: der Container bekommt eine private IP und wird über NAT sicher mit dem Host verbunden.
- C) Ohne diesen Eintrag bootet Debian 13 nicht.
- D) Es öffnet alle Ports ins Internet.

→ Richtig: **B**
Hinweis: Die mitgelieferten Profile ohne eigenes `devices:` erben `eth0` aus dem `default`-Profil — das Prinzip bleibt identisch.

### CORE_3
Der 4-Augen-Guardrail `99-agent-guardrails` blockiert `sudo su`. Für wen gilt das?
- A) Für alle Benutzer des Servers.
- B) Nur für Mitglieder der LDAP-Gruppe `ai_agents`; menschliche Admins (`admins`) haben regulär `sudo`.
- C) Nur für `root`.
- D) Für niemanden, es ist reine Doku.

→ Richtig: **B**
Begründung: Die sudoers-Regeln sind `%ai_agents`-scoped. Menschliche Admins nutzen normales `sudo`, Agenten nutzen `agent-sudo` (Auto-Approve für Read-only, sonst Queue).

### CORE_4
Wie erhält ein neuer Entwickler seinen FastMCP-Gateway-Token?
- A) Er steht im Klartext in der Onboarding-E-Mail.
- B) Über den Browser-2FA-Handshake des Workstation-Setups (`setup:workstation` / `setup-saas`): Authelia-Login → Token wird per Loopback an die CLI übergeben und in die Client-Config injiziert.
- C) Er generiert ihn selbst mit `openssl rand`.
- D) Der Admin schickt ihn per Chat.

→ Richtig: **B**

### CORE_5
Ein MCP-Aufruf zum Löschen eines Prod-Containers gibt `status: "queued"` zurück. Was ist der korrekte nächste Schritt?
- A) Den Aufruf sofort wiederholen, bis er durchläuft.
- B) Nichts erzwingen — ein zweiter Admin (Owner) gibt die Aktion im Dashboard `gateway.<DOMAIN>/approvals` per 2FA frei; danach führt der Execution-Daemon sie aus.
- C) Auf dem Server `sudo incus delete` ausführen.
- D) Den Gateway-Dienst neu starten.

→ Richtig: **B**
Begründung: 4-Augen = Trennung von Anforderer und Freigeber. Kein Retry, kein Umgehen.

### CORE_6
Warum sind Mail-DNS-Records (`service_type="mail"`) in Cloudflare zwingend `⚪ DNS-only` und nicht `🟠 proxied`?
- A) Aus Kostengründen.
- B) Cloudflares HTTP-Proxy terminiert nur Web-Protokolle; SMTP/IMAP/POP3 würden gebrochen. Mail braucht den direkten A/MX-Record auf die echte Server-IP.
- C) Weil Mailserver kein TLS können.
- D) Damit der Server weniger CPU braucht.

→ Richtig: **B**

---

## Track A — AI-Agent Sandbox

### A_1
Das reale Profil `profile-ai-agent.yaml` setzt für den User `agent` die Shell `/bin/rbash`. Was bewirkt das?
- A) Schnelleres Shell-Startup.
- B) Restricted Bash: kein `cd`, keine absoluten Pfade in Kommandos, kein Setzen von `PATH`/`SHELL`, keine Ausgabe-Umlenkung — der Agent bleibt in seinem Arbeitsverzeichnis eingesperrt.
- C) Root-Rechte für den Agenten.
- D) Deaktiviert die Bash-History.

→ Richtig: **B**

### A_2
Der Agent im Container läuft in eine Endlosschleife und frisst RAM. Warum bleibt der Netcup-Host stabil?
- A) Incus killt jeden Agenten nach 60 s.
- B) `config.limits.memory` (im echten Profil 2 GiB) begrenzt den Container hart; OOM trifft nur den Container, nicht den Host.
- C) Der Host hat unendlich RAM.
- D) Der Agent hat gar keinen RAM-Zugriff.

→ Richtig: **B**

### A_3
Ein Agent (Gruppe `ai_agents`) braucht auf dem Server `systemctl restart caddy`. Was passiert bei `agent-sudo systemctl restart caddy`?
- A) Sofortige Ausführung, weil `systemctl` harmlos ist.
- B) Der Befehl wird als HIGH-Risk klassifiziert und landet in der Approval-Queue; der Owner muss im Dashboard freigeben.
- C) Ablehnung mit „command not found".
- D) Der Agent bekommt eine Root-Shell.

→ Richtig: **B**
Begründung: Auto-Approve gilt nur für `ls/cat/echo/pwd/whoami/grep/find` ohne Chaining-Operatoren. Alles andere → Queue. (`systemctl reload caddy` wäre über die statische Whitelist erlaubt, `restart` nicht.)

### A_4
Warum wird ein neuer Agent-User via `create_lldap_user(..., group="ai_agents", owner="<admin>")` mit gesetztem `owner` angelegt?
- A) `owner` ist nur Kosmetik.
- B) Das Owner-Mapping (`agent_owners`) sorgt dafür, dass SSE-Approval-Pings gezielt beim verantwortlichen Admin landen statt als Broadcast.
- C) Ohne `owner` kann der Agent sich nicht einloggen.
- D) `owner` setzt das Agent-Passwort.

→ Richtig: **B**

---

## Track B — WordPress / Web-App

### B_1
`profile-wordpress.yaml` installiert `nginx`, `mariadb-server`, `redis-server`, `php-fpm`. Wo werden diese Pakete definiert?
- A) In `config.limits`.
- B) Unter `config.cloud-init.user-data` als `#cloud-config` `packages:`-Liste; `runcmd:` legt danach DB + User an.
- C) In einem separaten Dockerfile.
- D) Manuell nach dem ersten Login.

→ Richtig: **B**

### B_2
Warum steht der Cloudflare A-Record für `app.<domain>` auf `🟠 proxied`?
- A) Nur so funktioniert HTTPS.
- B) Der Cloudflare-Proxy liefert WAF, DDoS-Schutz und verdeckt die Origin-IP; Web-Traffic (HTTP/S) ist proxy-fähig.
- C) Proxied ist billiger.
- D) Damit SSH auf die Domain geht.

→ Richtig: **B**

### B_3
Beim `curl -I https://app-<user>.<domain>` kommt `302 → https://auth.<domain>`. Warum?
- A) Port 8080 ist offline.
- B) `require_auth=True` erzeugt in Caddy einen `forward_auth`-Block gegen Authelia; ohne gültige 2FA-Session wird jeder Request zum SSO-Portal umgeleitet.
- C) Cloudflare sperrt die Domain.
- D) WordPress ist nicht installiert.

→ Richtig: **B**

### B_4
Das Profil hat `runcmd: systemctl enable --now ... php8.2-fpm`, aber Debian 13 liefert PHP 8.4. Was ist die Konsequenz und der richtige Umgang?
- A) Alles läuft, `php8.2-fpm` ist ein Alias.
- B) Der `systemctl`-Aufruf schlägt fehl (Unit existiert nicht); im Training ist das eine Diagnose-Übung — im generierten Profil wird der Dienstname parametrisiert bzw. `php*-fpm` per Glob behandelt.
- C) Der Container bootet gar nicht.
- D) PHP muss von Hand aus dem Quellcode gebaut werden.

→ Richtig: **B**
Begründung: Bekannter Bug im mitgelieferten Template. `build_profile.py` ersetzt den harten Versionsstring.

---

## Track C — Mailserver

### C_1
`profile-mailserver-froxlor.yaml` nutzt `write_files:` für `/root/install_froxlor.sh` und ruft es in `runcmd:`. Warum nicht alles direkt in `runcmd`?
- A) `runcmd` erlaubt keine mehrzeiligen Befehle.
- B) `write_files` legt das Skript deterministisch mit Rechten `0755` ab; `runcmd` bleibt kurz und das Installer-Skript ist später erneut ausführbar/auditierbar.
- C) Froxlor verbietet `runcmd`.
- D) Aus Performancegründen.

→ Richtig: **B**

### C_2
Welche DNS-Records generiert `remoteos_get_dns_blueprint(domain=..., service_type="mail")` mindestens?
- A) Nur einen A-Record.
- B) A, MX (Prio 10), SPF (`v=spf1 ...`), DKIM (`default._domainkey`), DMARC (`_dmarc`), Autodiscover.
- C) Nur MX und CNAME.
- D) TXT `google-site-verification`.

→ Richtig: **B**

### C_3
Warum ist der MX/A-Record des Mailservers in Cloudflare `⚪ DNS-only`?
- A) DNS-only ist schneller.
- B) Der Cloudflare-Proxy kann SMTP/IMAP nicht weiterleiten; nur ein direkter Record auf die echte IP hält den Mailverkehr funktionsfähig.
- C) Mailserver haben kein TLS.
- D) Cloudflare verlangt Bezahlung für Mail-Proxy.

→ Richtig: **B**

### C_4
Der Kunde bringt seine eigene Domain mit (BYOD). Was liefert das Training statt eines Cloudflare-API-Aufrufs?
- A) Nichts, BYOD wird nicht unterstützt.
- B) Ein RFC-konformes DNS-Blueprint, das der Kunde bei seinem eigenen DNS-Provider einträgt — die Fleet verwaltet nur ihre eigene Domain (`*.<FLEET_DOMAIN>`) per API.
- C) Der Kunde muss die Domain zu Cloudflare transferieren.
- D) Ein Zonefile-Download für BIND.

→ Richtig: **B**

---

## Track D — Clean Debian / Datenbank / Worker

### D_1
Es gibt kein mitgeliefertes `profile-debian-clean.yaml`. Was lernst du in Station 2 stattdessen?
- A) Dass Clean-Debian unmöglich ist.
- B) Ein minimales Profil von Grund auf zu schreiben: `config.limits.cpu/memory`, ein schlankes `cloud-init.user-data` (nur die wirklich nötigen Pakete), optional ein `devices:`-Block.
- C) Ein fertiges Image von Docker Hub zu ziehen.
- D) Den Host direkt zu nutzen.

→ Richtig: **B**

### D_2
Du betreibst eine PostgreSQL-Instanz im Container. Wie sicherst du sie konsistent vor einem Umzug?
- A) `cp -r` des Datenverzeichnisses im laufenden Betrieb.
- B) `incus snapshot create <ct> <name>` (Copy-on-Write) bzw. Container stoppen + `incus export`; für Live-Migration `incus copy <ct> <node>:<ct> --mode=push --refresh`.
- C) Screenshot des `psql`-Prompts.
- D) Gar nicht, Container sind unsterblich.

→ Richtig: **B**

### D_3
Warum bekommt ein reiner Datenbank-Container in Station 5 bewusst *keine* öffentliche Caddy-Route?
- A) Caddy kann kein TCP.
- B) Die DB soll nur intern über `incusbr0` bzw. ein `incus proxy`-Device für die App erreichbar sein — Port 5432 gehört niemals ins öffentliche Internet.
- C) Routen kosten extra.
- D) PostgreSQL bringt einen eigenen Reverse-Proxy mit.

→ Richtig: **B**

### D_4
Wie begrenzt du, dass der Worker-Container bei Lastspitzen den Host-Prozessor monopolisiert?
- A) `nice` im Startskript.
- B) `config.limits.cpu` (Kernanzahl) und `limits.cpu.allowance` (z. B. `50%`) im Profil — harte, vom Host durchgesetzte Grenzen.
- C) Den Container manuell pausieren.
- D) Gar nicht möglich.

→ Richtig: **B**

---

## Track E — Custom Workload

### E_1
Du hast deinen Workload frei beschrieben. Woraus leitet `build_profile.py` das Profil ab?
- A) Es rät zufällig.
- B) Aus deinen Interview-Antworten (Basis-Muster web/mail/intern, CPU/RAM/Disk, Pakete, Ports, Auth-Bedarf) und dem am besten passenden mitgelieferten Template als Ausgangsbasis.
- C) Es kopiert immer `profile-ai-agent.yaml`.
- D) Es fragt ein LLM online.

→ Richtig: **B**

### E_2
Der Generator warnt: „`ram_gb=32` überschreitet das Node-Limit (`ram_gb ≤ 8`)". Was ist die richtige Reaktion?
- A) Die Warnung ignorieren.
- B) Sizing anpassen (Node-Grenze ist im MCP-Schema `ge=1, le=8`) oder den Workload auf den Auxiliary-Node (Oracle, 24 GB) planen.
- C) Das Schema patchen.
- D) Den Container trotzdem starten, wird schon klappen.

→ Richtig: **B**

### E_3
Dein Custom-Workload braucht einen öffentlichen HTTP-Endpunkt mit Login. Welchem Basis-Track folgt Station 5?
- A) Track C (Mailserver).
- B) Track B: Caddy `forward_auth` + Cloudflare A-Record `🟠 proxied`, `require_auth=True`.
- C) Gar keinem, Custom hat keine Station 5.
- D) Track A.

→ Richtig: **B**

### E_4
Warum wird auch das Custom-Profil zuerst mit `incus profile show` und `cloud-init status --wait` verifiziert, bevor irgendein Dienst getestet wird?
- A) Reine Gewohnheit.
- B) `profile show` bestätigt, dass das YAML syntaktisch akzeptiert wurde; `cloud-init status --wait` stellt sicher, dass `packages`/`runcmd` fehlerfrei durchliefen — sonst testest du gegen einen halb-provisionierten Container.
- C) Es beschleunigt den Boot.
- D) Damit das Zertifikat generiert wird.

→ Richtig: **B**
