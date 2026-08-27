# Track A — AI-Agent Sandbox

**Ziel-Workload:** autonome AI-Agenten in isolierter, restricted-shell Umgebung.
**Basis-Template (real):** `server-config/templates/incus/profile-ai-agent.yaml`
**Container-Name im Training:** `c-A-<TRAINEE_USER>` · **Profil-Name:** `A-<TRAINEE_USER>`

---

## Station 2 — Incus Profile Engineering (Track A)

### 2.1 Echtes Template inspizieren
Der Trainee öffnet `profile-ai-agent.yaml` und liest laut vor, was er sieht. Erwartete Struktur:
- `config.limits.cpu: "2"`, `config.limits.memory: 2GiB` — harte Quotas.
- `config.cloud-init.user-data` (**nicht** `user.user-data`) mit `#cloud-config`.
- `packages:` nodejs, npm, python3, python3-venv, python3-pip, git, build-essential.
- `users:` — ein User `agent` mit **`shell: /bin/rbash`** und einer einzigen sudo-Regel (`systemctl --no-pager status *`).
- `write_files:` — eine `README.txt` im Home des Agenten.
- **kein `devices:`** → `eth0`/`root` kommen aus dem `default`-Profil.

Frage zum Verständnis (nicht Prüfung): „Was kann der User `agent` mit `/bin/rbash` NICHT?" → kein `cd`, keine absoluten Pfade, kein `>`-Redirect, kein Ändern von `PATH`.

### 2.2 Eigenes Profil generieren
Interview (per `AskUserQuestion` / Text):
- RAM: 1 / 2 / 4 GiB (Default 2, Node-Limit ≤ 8)
- CPU: 1 / 2 (Default 2)
- Zusatz-Runtime: „nur Python" / „nur Node" / „beides" (Default beides)
- Agent-Framework vorinstallieren? `fastmcp` via pip / `@modelcontextprotocol/sdk` via npm / nichts

```bash
python3 ~/.agents/skills/bdbsaastraining/scripts/build_profile.py \
    --track A --user <TRAINEE_USER> \
    --ram 2 --cpu 2 --runtime both --agent-framework fastmcp
```
Output: `~/profile-A-<TRAINEE_USER>.yaml` + zeilenweise Erklärung.
Der Generator behält `shell: /bin/rbash` bei (Kernkonzept) und ergänzt bei `--agent-framework fastmcp` einen `runcmd`-Schritt `python3 -m venv /home/agent/venv && /home/agent/venv/bin/pip install fastmcp` (statt es dem Trainee später als `ModuleNotFoundError` zu überlassen).

### 2.3 Registrieren & prüfen
```bash
sudo incus profile create A-<TRAINEE_USER>
sudo incus profile edit A-<TRAINEE_USER> < ~/profile-A-<TRAINEE_USER>.yaml
sudo incus profile show A-<TRAINEE_USER>
```

**Verständnisfrage 2 → `exam-pool.md` → `CORE_2`** (incusbr0 / Bridge).

---

## Station 3 — Deployment & Agent-Task (Track A)

```bash
sudo incus launch images:debian/13 c-A-<TRAINEE_USER> -p default -p A-<TRAINEE_USER>
sudo incus list
sudo incus exec c-A-<TRAINEE_USER> -- cloud-init status --wait
```

### 3.1 In die Sandbox als unprivilegierter Agent
```bash
sudo incus exec c-A-<TRAINEE_USER> -- su - agent
# Erwartung: rbash-Prompt. Test:
cd /tmp            # -> rbash: cd: restricted
```
> Falls der Trainee den User `agentrunner` erwartet (aus altem Skill-Stand): den gibt es NICHT. Der reale User heißt `agent`.

### 3.2 Realer Agent-Task — MCP-Tool im Container bauen
```bash
# als agent, im Home:
cat > build_mcp.py <<'PY'
from fastmcp import FastMCP
mcp = FastMCP("demo-agent-service")

@mcp.tool()
def analyze_lead(email: str, company: str) -> dict:
    return {"status": "analyzed", "email": email, "company": company, "score": 95}

if __name__ == "__main__":
    mcp.run(transport="stdio")
PY
/home/agent/venv/bin/python build_mcp.py --help 2>&1 | head
```
Didaktik: Selbst wenn das Skript crasht oder eine Endlosschleife baut — der Host ist durch die 2-GiB-Quota + Incus-Sandbox unberührt.

**Verständnisfrage 3 → `exam-pool.md` → `CORE_1`** (Sandbox-Vorteil).

---

## Station 4 — FastMCP & Guardrails (Track A-Fokus)

Zusätzlich zum gemeinsamen Station-4-Ablauf (siehe `SKILL.md`):
- Der Trainee ruft `create_lldap_user(username="agent-demo-<TRAINEE_USER>", group="ai_agents", owner="<TRAINEE_USER>")` auf und beobachtet die Antwort (`status: "success"`, Hinweis auf Background-Worker).
- Erklärung `agent-sudo`: auf einer Agent-SSH-Session ist `sudo` gesperrt; der Agent nutzt `agent-sudo <cmd>`. `agent-sudo ls /etc` → Auto-Approve. `agent-sudo systemctl restart caddy` → Queue.

**Track-Fragen für die Prüfung:** `A_1`, `A_2`, `A_3`, `A_4`.

---

## Station 5 — Interne Gateway-Route (Track A)

Der Agent exponiert ein kleines Web-UI (z. B. Port 8000) — **nur** hinter Authelia, nie roh öffentlich:
```
remoteos_add_route(
    domain="agent-<TRAINEE_USER>.<DOMAIN>",
    upstream_port=8000,
    require_auth=True,
    target_node="netcup",
    service_type="web",
    sync_cloudflare=True
)
```
> **Gateway-Lücke:** `/tools/add_route` ist am Remote-Gateway ein Stub. Der Trainee verifiziert daher zusätzlich direkt auf dem Server: `sudo caddy validate --config /etc/caddy/Caddyfile` und prüft, ob ein `forward_auth`-Block für die Domain existiert. Alternativ Konzept erklären: ohne 2FA-Session → 302 auf `auth.<DOMAIN>`.

**Verständnisfrage 5 → `exam-pool.md` → `A_3`** (agent-sudo Klassifikation) — oder als Prüfungsfrage aufheben und hier `CORE_5` (Queue-Verhalten) stellen.
