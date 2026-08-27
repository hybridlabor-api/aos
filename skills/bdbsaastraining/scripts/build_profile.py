#!/usr/bin/env python3
"""
build_profile.py — BDB SaaS Host Bootcamp · Station 2 Incus-Profil-Generator

Rendert aus den Interview-Antworten des Trainees ein VALIDES Incus-Profil-YAML
auf Basis der echten Repo-Templates (server-config/templates/incus/profile-*.yaml).
Erfindet keine Operatoren/Parameter. Warnt statt abzubrechen bei unplausiblen Werten.

Beispiele:
  build_profile.py --track A --user noah --ram 2 --cpu 2 --runtime both --agent-framework fastmcp
  build_profile.py --track B --user sarah --ram 4 --disk 40 --db mariadb --redis yes --wpcli yes
  build_profile.py --track C --user tkd --customer-domain kunde-mueller.de --mailboxes 10 --webmail yes
  build_profile.py --track D --user mia --workload postgres --ram 2 --cpu 2 --cpu-allowance 50 --disk 20
  build_profile.py --track E --user leo --base B --ram 4 --disk 30 --packages "nginx,nodejs,npm" \
                   --ports "8000/public" --auth yes --describe "Node SSR App mit Login"

Node-Grenzen (aus dem MCP-Schema CreateContainerRequest): cpu 1..4, ram 1..8 GiB, disk 10..100 GiB.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

NODE_RAM_MAX = 8
NODE_CPU_MAX = 4
NODE_DISK_MIN = 10
NODE_DISK_MAX = 100

PKG_RE = re.compile(r"^[a-z0-9][a-z0-9.+-]*$")
DOMAIN_RE = re.compile(r"^([a-z0-9-]+\.)+[a-z]{2,}$", re.I)

WARNINGS: list[str] = []


def warn(msg: str) -> None:
    WARNINGS.append(msg)


# ---------------------------------------------------------------------------
# YAML-Emitter (nur so viel wie nötig; eine einzige Block-Scalar-Ebene)
# ---------------------------------------------------------------------------
def emit_profile(config: dict[str, str], description: str, user_data: str,
                 devices: dict[str, dict[str, str]]) -> str:
    lines: list[str] = ["config:"]
    for key, val in config.items():
        if key == "cloud-init.user-data":
            continue
        lines.append(f"  {key}: {val}")
    lines.append("  cloud-init.user-data: |")
    for ud_line in user_data.splitlines():
        lines.append(f"    {ud_line}" if ud_line else "")
    safe_desc = description.replace('"', "'").replace("\n", " ").strip()
    lines.append(f'description: "{safe_desc}"')
    if devices:
        lines.append("devices:")
        for dname, dcfg in devices.items():
            lines.append(f"  {dname}:")
            for k, v in dcfg.items():
                lines.append(f"    {k}: {v}")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Sizing / Validierung
# ---------------------------------------------------------------------------
def clamp_sizing(args) -> tuple[int, int, int | None]:
    ram = args.ram
    cpu = args.cpu
    if ram > NODE_RAM_MAX:
        warn(f"ram={ram} GiB überschreitet das Primary-Node-Limit ({NODE_RAM_MAX} GiB). "
             f"Auxiliary-Node (Oracle, 24 GB) einplanen oder Sizing reduzieren. Profil wird trotzdem geschrieben.")
    if ram < 1:
        warn(f"ram={ram} < 1 GiB ist unrealistisch; setze 1 GiB.")
        ram = 1
    if cpu > NODE_CPU_MAX:
        warn(f"cpu={cpu} überschreitet das Node-Limit ({NODE_CPU_MAX}); setze {NODE_CPU_MAX}.")
        cpu = NODE_CPU_MAX
    if cpu < 1:
        cpu = 1
    disk = args.disk
    if disk is not None:
        if disk < NODE_DISK_MIN:
            warn(f"disk={disk} < {NODE_DISK_MIN} GiB; setze {NODE_DISK_MIN} GiB.")
            disk = NODE_DISK_MIN
        if disk > NODE_DISK_MAX:
            warn(f"disk={disk} > {NODE_DISK_MAX} GiB überschreitet das Node-Limit; setze {NODE_DISK_MAX} GiB.")
            disk = NODE_DISK_MAX
    return ram, cpu, disk


def base_config(ram: int, cpu: int, allowance: int | None) -> dict[str, str]:
    cfg = {"limits.cpu": f'"{cpu}"', "limits.memory": f"{ram}GiB"}
    if allowance is not None:
        cfg["limits.cpu.allowance"] = f"{allowance}%"
    return cfg


def validate_packages(pkgs: list[str]) -> list[str]:
    clean: list[str] = []
    for p in pkgs:
        p = p.strip()
        if not p:
            continue
        if not PKG_RE.match(p):
            warn(f"Paketname '{p}' sieht ungewöhnlich aus (Debian-13-Namen: klein, [a-z0-9.+-]). Trotzdem übernommen.")
        clean.append(p)
    return clean


def yaml_list(items: list[str], indent: int = 2) -> str:
    pad = " " * indent
    return "\n".join(f"{pad}- {i}" for i in items)


def render_runcmd(items: list[str], indent: int = 2) -> list[str]:
    """runcmd-Einträge als YAML. Mehrzeilige oder quote-behaftete Kommandos
    werden als literale Block-Scalars (`- |`) emittiert — dort sind ' und " literal."""
    pad = " " * indent
    out = [f"{pad[:-2]}runcmd:"] if indent >= 2 else ["runcmd:"]
    for it in items:
        if "\n" in it or "'" in it or '"' in it:
            out.append(f"{pad}- |")
            for ln in it.splitlines():
                out.append(f"{pad}    {ln}" if ln else "")
        else:
            out.append(f"{pad}- {it}")
    return out


PHP_FPM_FIX = (
    'PHPFPM=$(systemctl list-unit-files "php*-fpm.service" --no-legend 2>/dev/null '
    "| awk '{print $1; exit}')"
)

# ---------------------------------------------------------------------------
# Track-Renderer
# ---------------------------------------------------------------------------
def render_track_a(args, ram, cpu, disk) -> str:
    rt = args.runtime
    pkgs = ["python3", "git"]
    if rt in ("python", "both"):
        pkgs += ["python3-venv", "python3-pip"]
    if rt in ("node", "both"):
        pkgs += ["nodejs", "npm"]
    pkgs += ["build-essential"]

    runcmd: list[str] = []
    if args.agent_framework == "fastmcp":
        runcmd.append("python3 -m venv /home/agent/venv && "
                      "/home/agent/venv/bin/pip install --no-input fastmcp && "
                      "chown -R agent:agent /home/agent/venv")
    elif args.agent_framework == "mcp-sdk":
        runcmd.append("npm install -g @modelcontextprotocol/sdk")

    ud = [
        "#cloud-config",
        "package_update: true",
        "packages:",
        yaml_list(validate_packages(pkgs)),
        "users:",
        "  - name: agent",
        "    gecos: AI Agent Sandbox User",
        "    shell: /bin/rbash",
        '    sudo: ["ALL=(root) NOPASSWD: /usr/bin/systemctl --no-pager status *"]',
        "write_files:",
        "  - path: /home/agent/README.txt",
        "    permissions: '0644'",
        "    content: |",
        "      RC Cloud AI-Agent Sandbox. rbash, kein root, Netz via incusbr0.",
    ]
    if runcmd:
        ud += render_runcmd(runcmd)
    ud_text = "\n".join(ud)

    cfg = base_config(ram, cpu, args.cpu_allowance)
    devices = root_device(disk)
    desc = f"RC Cloud AI-Agent Sandbox (rbash, runtime={rt}) — A-{args.user}"
    return emit_profile(cfg, desc, ud_text, devices)


def render_track_b(args, ram, cpu, disk) -> str:
    db = args.db
    pkgs = ["nginx", "php-fpm", "php-curl", "php-gd", "php-xml", "php-mbstring", "certbot"]
    if db == "mariadb":
        pkgs += ["mariadb-server", "php-mysql"]
    else:
        pkgs += ["postgresql", "php-pgsql"]
    if args.redis == "yes":
        pkgs += ["redis-server", "php-redis"]

    if db == "mariadb":
        dbcmd = "\n".join([
            "set -eu",
            "WP_PASS=$(openssl rand -hex 16)",
            'mysql -e "CREATE DATABASE IF NOT EXISTS wp; '
            "CREATE USER IF NOT EXISTS 'wp'@'localhost' IDENTIFIED BY '${WP_PASS}'; "
            "GRANT ALL ON wp.* TO 'wp'@'localhost'; FLUSH PRIVILEGES;\"",
            'echo "DB_PASS=${WP_PASS}" > /root/.wp-db-credentials',
            "chmod 0600 /root/.wp-db-credentials",
        ])
    else:
        dbcmd = "\n".join([
            "set -eu",
            "WP_PASS=$(openssl rand -hex 16)",
            "sudo -u postgres psql -c \"CREATE USER wp WITH PASSWORD '${WP_PASS}';\"",
            "sudo -u postgres createdb -O wp wp",
            'echo "DB_PASS=${WP_PASS}" > /root/.wp-db-credentials',
            "chmod 0600 /root/.wp-db-credentials",
        ])

    svc = "nginx " + ("mariadb " if db == "mariadb" else "postgresql ") + \
          ("redis-server " if args.redis == "yes" else "")
    enable_cmd = f"{PHP_FPM_FIX}\nsystemctl enable --now {svc}${{PHPFPM:-php-fpm}}"

    runcmd = [dbcmd, enable_cmd]
    if args.wpcli == "yes":
        runcmd.append("curl -sSL -o /usr/local/bin/wp "
                      "https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar "
                      "&& chmod +x /usr/local/bin/wp")

    ud = [
        "#cloud-config",
        "package_update: true",
        "package_upgrade: true",
        "packages:",
        yaml_list(validate_packages(pkgs)),
    ] + render_runcmd(runcmd)
    ud_text = "\n".join(ud)

    cfg = base_config(ram, cpu, args.cpu_allowance)
    devices = root_device(disk)
    desc = (f"RC Cloud Web/WordPress ({db}"
            + (", redis" if args.redis == "yes" else "")
            + f") — B-{args.user}  [php-fpm-Dienstname parametrisiert]")
    return emit_profile(cfg, desc, ud_text, devices)


def render_track_c(args, ram, cpu, disk) -> str:
    dom = args.customer_domain
    if dom and not DOMAIN_RE.match(dom):
        warn(f"customer-domain '{dom}' ist keine gültige Domain — Blueprint in Station 5 wird darauf aufbauen.")
    if not dom:
        warn("Keine --customer-domain angegeben. Station 5 (DNS-Blueprint) braucht sie.")
        dom = "beispiel-kunde.de"

    pkgs = ["postfix", "dovecot-imapd", "mariadb-server", "php-fpm", "php-mysql",
            "php-cli", "certbot", "nginx", "curl", "gnupg"]
    if args.pop3 == "yes":
        pkgs.insert(2, "dovecot-pop3d")
    if args.webmail == "yes":
        pkgs.append("roundcube")

    installer = "\n".join([
        "      #!/bin/bash",
        "      set -eu",
        '      echo "deb https://deb.froxlor.org/debian bookworm main" > /etc/apt/sources.list.d/froxlor.list',
        "      curl -s https://deb.froxlor.org/froxlor.gpg | gpg --dearmor > /etc/apt/trusted.gpg.d/froxlor.gpg",
        "      apt-get update",
        "      apt-get install -y froxlor",
        f"      {PHP_FPM_FIX}",
        "      systemctl restart ${PHPFPM:-php-fpm} nginx",
    ])

    ud = [
        "#cloud-config",
        "package_update: true",
        "package_upgrade: true",
        "packages:",
        yaml_list(validate_packages(pkgs)),
        "write_files:",
        "  - path: /root/install_froxlor.sh",
        "    permissions: '0755'",
        "    content: |",
        installer,
        f"  - path: /root/CUSTOMER_DOMAIN",
        "    permissions: '0644'",
        f"    content: {dom}",
        "runcmd:",
        '  - [ "/bin/bash", "/root/install_froxlor.sh" ]',
    ]
    ud_text = "\n".join(ud)

    cfg = base_config(ram, cpu, args.cpu_allowance)
    devices = root_device(disk)
    desc = f"RC Cloud Froxlor Mail-Stack (Domain {dom}, {args.mailboxes} Postfächer) — C-{args.user}"
    return emit_profile(cfg, desc, ud_text, devices)


def render_track_d(args, ram, cpu, disk) -> str:
    wl = args.workload
    table = {
        "postgres": (["postgresql", "postgresql-client"], "postgresql", "/var/lib/postgresql"),
        "redis":    (["redis-server"], "redis-server", "/var/lib/redis"),
        "node":     (["nodejs", "npm", "git"], None, "/srv/app"),
        "plain":    ([], None, None),
    }
    pkgs, svc, datapath = table.get(wl, table["plain"])

    ud = ["#cloud-config", "package_update: true"]
    if pkgs:
        ud += ["packages:", yaml_list(validate_packages(pkgs))]
    if svc:
        ud += render_runcmd([f"systemctl enable --now {svc}"])
    ud_text = "\n".join(ud)

    cfg = base_config(ram, cpu, args.cpu_allowance)
    devices = root_device(disk)
    if args.data_device == "yes" and datapath:
        vol = f"{args.user}-{wl}-data"
        devices["data"] = {
            "type": "disk", "pool": "default", "source": vol,
            "path": datapath, "size": f"{disk or 20}GiB",
        }
        warn(f"Daten-Device nutzt Volume '{vol}'. Zuerst anlegen: "
             f"sudo incus storage volume create default {vol} size={disk or 20}GiB")
    desc = f"RC Cloud Clean Debian ({wl}) — D-{args.user}"
    return emit_profile(cfg, desc, ud_text, devices)


def render_track_e(args, ram, cpu, disk) -> str:
    base = (args.base or "D").upper()
    if base not in {"A", "B", "C", "D"}:
        warn(f"--base '{args.base}' unbekannt, nutze D-Muster (minimal).")
        base = "D"

    pkgs = validate_packages((args.packages or "").split(","))
    ports = parse_ports(args.ports)
    for p, scope in ports:
        if scope == "public" and args.auth != "yes":
            warn(f"Öffentlicher Port {p} ohne --auth yes. Öffentliche Endpunkte MÜSSEN hinter Authelia "
                 f"(require_auth=True). In Station 5 entsprechend setzen.")

    ud = ["#cloud-config", "package_update: true"]
    if base in ("B", "C"):
        ud.append("package_upgrade: true")
    if pkgs:
        ud += ["packages:", yaml_list(pkgs)]
    else:
        warn("Keine --packages angegeben — reiner Debian-Container ohne Dienste.")
    needs_php = any(x.startswith("php") for x in pkgs)
    if needs_php:
        ud += render_runcmd([f"{PHP_FPM_FIX}\nsystemctl enable --now ${{PHPFPM:-php-fpm}}"])
    ud_text = "\n".join(ud)

    if base == "A":
        # rbash-Sandbox-Charakter beibehalten
        ud_text = ud_text.replace(
            "package_update: true",
            "package_update: true\nusers:\n  - name: agent\n    shell: /bin/rbash", 1)

    cfg = base_config(ram, cpu, args.cpu_allowance)
    devices = root_device(disk)
    if args.data_device == "yes":
        vol = f"{args.user}-e-data"
        devices["data"] = {"type": "disk", "pool": "default", "source": vol,
                           "path": "/srv/data", "size": f"{disk or 20}GiB"}
        warn(f"Zuerst: sudo incus storage volume create default {vol} size={disk or 20}GiB")

    portstr = ", ".join(f"{p}/{s}" for p, s in ports) or "keine"
    desc = (f"RC Cloud Custom (Basis {base}, Ports {portstr}) — E-{args.user}"
            + (f' :: "{args.describe}"' if args.describe else ""))
    return emit_profile(cfg, desc, ud_text, devices)


def parse_ports(spec: str | None) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    if not spec:
        return out
    for chunk in spec.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "/" in chunk:
            port, scope = chunk.split("/", 1)
        else:
            port, scope = chunk, "internal"
        scope = scope.strip().lower()
        if scope not in ("public", "internal"):
            warn(f"Port-Scope '{scope}' unbekannt (public|internal), nutze internal.")
            scope = "internal"
        if not port.strip().isdigit():
            warn(f"Port '{port}' ist keine Zahl — übersprungen.")
            continue
        out.append((port.strip(), scope))
    return out


def root_device(disk: int | None) -> dict[str, dict[str, str]]:
    if disk is None:
        return {}
    return {"root": {"path": "/", "pool": "default", "type": "disk", "size": f"{disk}GiB"}}


RENDERERS = {
    "A": render_track_a, "B": render_track_b, "C": render_track_c,
    "D": render_track_d, "E": render_track_e,
}


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="BDB Bootcamp Incus-Profil-Generator")
    p.add_argument("--track", required=True, choices=list(RENDERERS))
    p.add_argument("--user", required=True)
    p.add_argument("--out", default=None, help="Zielpfad (Default: ~/profile-<TRACK>-<USER>.yaml)")
    p.add_argument("--print", action="store_true", help="nur nach stdout, keine Datei")

    p.add_argument("--ram", type=int, default=2, help="GiB (1..8)")
    p.add_argument("--cpu", type=int, default=2, help="Kerne (1..4)")
    p.add_argument("--cpu-allowance", type=int, default=None, help="Prozent-Deckel, z. B. 50")
    p.add_argument("--disk", type=int, default=None, help="Root-Quota GiB (10..100)")

    # Track A
    p.add_argument("--runtime", choices=["python", "node", "both"], default="both")
    p.add_argument("--agent-framework", choices=["fastmcp", "mcp-sdk", "none"], default="none")
    # Track B
    p.add_argument("--db", choices=["mariadb", "postgres"], default="mariadb")
    p.add_argument("--redis", choices=["yes", "no"], default="no")
    p.add_argument("--wpcli", choices=["yes", "no"], default="no")
    # Track C
    p.add_argument("--customer-domain", default=None)
    p.add_argument("--mailboxes", type=int, default=5)
    p.add_argument("--pop3", choices=["yes", "no"], default="no")
    p.add_argument("--webmail", choices=["yes", "no"], default="no")
    # Track D
    p.add_argument("--workload", choices=["postgres", "redis", "node", "plain"], default="plain")
    p.add_argument("--data-device", choices=["yes", "no"], default="no")
    # Track E
    p.add_argument("--base", default=None, help="A|B|C|D — Basis-Muster")
    p.add_argument("--packages", default=None, help='Komma-Liste, z. B. "nginx,nodejs,npm"')
    p.add_argument("--ports", default=None, help='z. B. "8000/public,9000/internal"')
    p.add_argument("--auth", choices=["yes", "no"], default="no")
    p.add_argument("--describe", default=None, help="Originaler Freitext des Trainees")
    return p


def main() -> int:
    args = build_parser().parse_args()
    ram, cpu, disk = clamp_sizing(args)
    args.ram, args.cpu, args.disk = ram, cpu, disk

    yaml_text = RENDERERS[args.track](args, ram, cpu, disk)

    profile_name = f"{args.track}-{args.user}"
    target = Path(args.out) if args.out else Path.home() / f"profile-{profile_name}.yaml"
    header = (
        f"# Incus-Profil  {profile_name}  ·  generiert von build_profile.py\n"
        f"# Registrieren:\n"
        f"#   sudo incus profile create {profile_name}\n"
        f"#   sudo incus profile edit {profile_name} < {target if not args.print else f'~/profile-{profile_name}.yaml'}\n"
        f"#   sudo incus profile show {profile_name}\n"
        f"# Kein Top-Level 'name:' — 'incus profile edit' braucht ihn nicht.\n"
    )
    file_content = header + yaml_text

    # stdout = ausschliesslich das Profil-YAML (pipe-tauglich).
    # stderr = alles Menschenlesbare (Pfad, Warnungen, Zeilen-Erklärung).
    if args.print:
        sys.stdout.write(file_content)
    else:
        target.write_text(file_content, encoding="utf-8")
        print(f"✔ Profil geschrieben: {target}", file=sys.stderr)
        print(f"  sudo incus profile create {profile_name} && "
              f"sudo incus profile edit {profile_name} < {target}", file=sys.stderr)

    if WARNINGS:
        print("\n⚠️  Warnungen (Profil trotzdem geschrieben — im Training besprechen):", file=sys.stderr)
        for w in WARNINGS:
            print(f"   • {w}", file=sys.stderr)

    print("\nZeilen-Erklärung:", file=sys.stderr)
    for line in yaml_text.splitlines():
        note = _explain(line)
        if note:
            print(f"   {line.strip():<52}  # {note}", file=sys.stderr)
    return 0


def _explain(line: str) -> str:
    s = line.strip()
    if s.startswith("limits.cpu:"):
        return "harte Kernanzahl, vom Host durchgesetzt"
    if s.startswith("limits.cpu.allowance:"):
        return "prozentualer CPU-Deckel bei Contention"
    if s.startswith("limits.memory:"):
        return "harte RAM-Grenze; OOM trifft nur den Container"
    if s.startswith("cloud-init.user-data:"):
        return "#cloud-config: Erstprovisionierung (packages, runcmd, write_files)"
    if s == "shell: /bin/rbash" or s.endswith("shell: /bin/rbash"):
        return "restricted bash — Agent bleibt im Home eingesperrt"
    if s.startswith("- name: agent"):
        return "unprivilegierter Sandbox-User (kein root)"
    if s.startswith("PHPFPM=") or "php*-fpm.service" in s:
        return "Fix: Dienstname statt hartem php8.2-fpm (Debian 13 = php8.4)"
    if s.startswith("root:") or s == "path: /":
        return "Root-Disk-Quota-Override auf Profilebene"
    if s.startswith("data:"):
        return "dediziertes Daten-Volume (Volume vorher anlegen!)"
    if s.startswith("description:"):
        return "Freitext; kein funktionaler Effekt"
    return ""


if __name__ == "__main__":
    raise SystemExit(main())
