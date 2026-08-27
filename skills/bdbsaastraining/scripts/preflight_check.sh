#!/usr/bin/env bash
# BDB SaaS Host Bootcamp — Station 0.5 Preflight Check
#
# Usage:  bash preflight_check.sh <lldap_username> [gateway_domain]
#
# Prüft die lokale Workstation, BEVOR das Training mit Station 1 startet.
# Jeder fehlgeschlagene Check gibt einen konkreten Fix-Befehl aus.
# Exit 0 = alle Pflicht-Checks grün.

set -u

TRAINEE_USER="${1:-}"
GATEWAY_DOMAIN="${2:-${PROJECT_DOMAIN:-rcentry.pro}}"
GATEWAY_HOST="gateway.${GATEWAY_DOMAIN#gateway.}"
CA_URL="${STEP_CA_URL:-https://ca.${GATEWAY_DOMAIN#gateway.}}"

# Autoritativer Fingerprint: identity_sso.md / Onboarding-Mail. Per ENV überschreibbar.
EXPECTED_FP="${STEP_CA_FINGERPRINT:-984359cc823d2153fef6b3dac0f15556cef5d1909fbdf6e9219eeb44d75fd9f5}"

GREEN=$'\033[0;32m'; RED=$'\033[0;31m'; YEL=$'\033[0;33m'; NC=$'\033[0m'
FAIL=0; WARN=0

pass() { printf '  %s✔%s %s\n' "$GREEN" "$NC" "$1"; }
fail() { printf '  %s✗%s %s\n     %s→ Fix:%s %s\n' "$RED" "$NC" "$1" "$YEL" "$NC" "$2"; FAIL=$((FAIL+1)); }
warn() { printf '  %s!%s %s\n     %s→%s %s\n' "$YEL" "$NC" "$1" "$YEL" "$NC" "$2"; WARN=$((WARN+1)); }

echo
echo "── BDB SaaS Host Bootcamp · Preflight ─────────────────────────────"
echo "   Trainee : ${TRAINEE_USER:-<nicht angegeben>}"
echo "   Gateway : https://${GATEWAY_HOST}"
echo "   CA      : ${CA_URL}"
echo "──────────────────────────────────────────────────────────────────"
echo

if [ -z "$TRAINEE_USER" ]; then
  fail "Kein LLDAP-Username übergeben." "bash preflight_check.sh <dein_lldap_user>"
fi

# 1) step CLI
if command -v step >/dev/null 2>&1; then
  pass "step CLI installiert ($(step version 2>/dev/null | head -1))"
else
  fail "step CLI fehlt." "macOS: brew install step   |   Debian/Ubuntu: sudo apt-get install -y step-cli"
fi

# 2) CA bootstrap vorhanden?
STEP_ROOT="$(step path 2>/dev/null || echo "$HOME/.step")"
if [ -f "${STEP_ROOT}/certs/root_ca.crt" ]; then
  pass "Step-CA gebootstrappt (${STEP_ROOT}/certs/root_ca.crt)"
  # 3) Fingerprint-Abgleich
  ACTUAL_FP="$(step certificate fingerprint "${STEP_ROOT}/certs/root_ca.crt" 2>/dev/null | tr -d '[:space:]')"
  if [ -n "$ACTUAL_FP" ] && [ "$ACTUAL_FP" = "$EXPECTED_FP" ]; then
    pass "CA-Fingerprint stimmt mit dem erwarteten Wert überein"
  elif [ -n "$ACTUAL_FP" ]; then
    fail "CA-Fingerprint weicht ab (lokal: ${ACTUAL_FP:0:16}… / erwartet: ${EXPECTED_FP:0:16}…)." \
         "step ca bootstrap --ca-url ${CA_URL} --fingerprint ${EXPECTED_FP} --force"
  else
    warn "Fingerprint konnte nicht berechnet werden." "step certificate fingerprint ${STEP_ROOT}/certs/root_ca.crt"
  fi
else
  fail "Step-CA nicht gebootstrappt." "step ca bootstrap --ca-url ${CA_URL} --fingerprint ${EXPECTED_FP} --force"
fi

# 4) ~/.ssh/config Fleet-Block
if [ -f "$HOME/.ssh/config" ] && grep -q "BDB SAAS HOST FLEET RULES" "$HOME/.ssh/config" 2>/dev/null; then
  pass "~/.ssh/config enthält den BDB Fleet-Block"
  if [ -n "$TRAINEE_USER" ] && ! grep -qE "^[[:space:]]*User[[:space:]]+${TRAINEE_USER}\b" "$HOME/.ssh/config"; then
    warn "Fleet-Block nutzt nicht 'User ${TRAINEE_USER}'." "npm run setup:workstation   (setzt User + CertificateFile neu)"
  fi
else
  fail "Kein BDB Fleet-Block in ~/.ssh/config." \
       "cd bdb-saashost-engine && npm run setup:workstation   ODER   npx @hybridlabor-api/bdb-dev-optimized-agent-skills setup-saas --gateway ${GATEWAY_HOST}"
fi

# 5) SSH-Zertifikat vorhanden & gültig?
CERT="${STEP_ROOT}/ssh/id_ecdsa-cert.pub"
if [ -f "$CERT" ]; then
  if command -v step >/dev/null 2>&1 && step ssh inspect "$CERT" >/dev/null 2>&1; then
    VALID_TO="$(step ssh inspect "$CERT" 2>/dev/null | awk -F': *' '/Valid:/ {print $2}')"
    pass "SSH-Zertifikat vorhanden (${VALID_TO:-TTL siehe 'step ssh inspect'})"
  else
    warn "SSH-Zertifikat vorhanden, aber nicht lesbar/abgelaufen." "step ssh login ${TRAINEE_USER}"
  fi
else
  warn "Noch kein SSH-Zertifikat — wird in Station 1 erzeugt." "step ssh login ${TRAINEE_USER}   (kommt in Station 1)"
fi

# 6) FastMCP-Client-Config
MCP_FOUND=0
for f in \
  "$HOME/.cursor/mcp.json" \
  "$HOME/Library/Application Support/Claude/claude_desktop_config.json" \
  "$HOME/.config/Claude/claude_desktop_config.json" \
  "$HOME/.gemini/antigravity-cli/mcp/bdb_remoteos_gateway/config.json" \
  "$HOME/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json"
do
  if [ -f "$f" ] && grep -q "gateway.${GATEWAY_DOMAIN#gateway.}" "$f" 2>/dev/null; then
    pass "FastMCP-Gateway in $(basename "$(dirname "$f")")/$(basename "$f")"
    MCP_FOUND=1
  fi
done
[ "$MCP_FOUND" -eq 0 ] && warn "Kein Client mit FastMCP-Gateway-Eintrag gefunden." \
  "npm run setup:workstation   (injiziert das SSE-Gateway in alle erkannten Editoren)"

# 7) Gateway erreichbar
if command -v curl >/dev/null 2>&1; then
  CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "https://${GATEWAY_HOST}/health" 2>/dev/null || echo 000)"
  case "$CODE" in
    200) pass "Gateway /health erreichbar (200)";;
    30[0-9]|401|403) pass "Gateway erreichbar (HTTP ${CODE} — Authelia davor, das ist ok)";;
    000) warn "Gateway https://${GATEWAY_HOST} nicht erreichbar." "Netzwerk/VPN prüfen; Domain korrekt? Argument 2 = gateway_domain";;
    *)   warn "Gateway antwortet mit HTTP ${CODE}." "Später in Station 4 erneut prüfen";;
  esac
else
  warn "curl nicht installiert — Gateway-Check übersprungen." "brew install curl / apt-get install curl"
fi

echo
echo "──────────────────────────────────────────────────────────────────"
if [ "$FAIL" -eq 0 ]; then
  printf ' %sPreflight bestanden%s (%d Hinweise). Weiter mit Station 1.\n' "$GREEN" "$NC" "$WARN"
  exit 0
else
  printf ' %s%d Pflicht-Check(s) fehlgeschlagen%s, %d Hinweise.\n' "$RED" "$FAIL" "$NC" "$WARN"
  printf ' Fixes ausführen, dann erneut: bash %s %s\n' "$0" "$TRAINEE_USER"
  exit 1
fi
