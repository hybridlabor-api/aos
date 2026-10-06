#!/usr/bin/env bash
# Phase 0 spike check. Scratch only; uses its own sessions dir.
set -u
D="$(cd "$(dirname "$0")/.." && pwd)"
export AOS_SESSIONS_DIR="$D/sessions"
mkdir -p "$D/logs"
cd "$D"
FAILS=0
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done; }
trap cleanup EXIT
ok()   { echo "PASS: $1"; }
bad()  { echo "FAIL: $1"; FAILS=$((FAILS+1)); }
jget() { node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));const v=process.argv[1].split(".").reduce((a,k)=>a?.[k],j);console.log(typeof v==="object"?JSON.stringify(v):v)' "$1"; }
wait_reg() { for _ in $(seq 1 50); do [ -s "$AOS_SESSIONS_DIR/$1.json" ] && return 0; sleep 0.1; done; return 1; }

node sidecar.mjs --name claude-a --harness claude > logs/claude-a.log 2>&1 & A=$!; PIDS+=("$A")
node sidecar.mjs --name opencode-b --harness opencode > logs/opencode-b.log 2>&1 & B=$!; PIDS+=("$B")
wait_reg claude-a && wait_reg opencode-b && ok "both sidecars registered (pids $A $B)" || { bad "sidecars did not register"; exit 1; }

for n in claude-a opencode-b; do
  f="$AOS_SESSIONS_DIR/$n.json"
  mode=$(stat -f %Lp "$f" 2>/dev/null || stat -c %a "$f")
  [ "$mode" = "600" ] && ok "$n registry mode 0600" || bad "$n registry mode $mode"
  card=$(curl -s "$(jget cardUrl < "$f")")
  [ "$(echo "$card" | jget name)" = "$n" ] && ok "$n card served, name matches" || bad "$n card name"
  echo "$card" | jget securitySchemes | grep -q httpAuthSecurityScheme && ok "$n card has bearer scheme" || bad "$n card securitySchemes"
  echo "$card" | jget skills | grep -q '"id":"echo"' && ok "$n card has echo skill" || bad "$n card skill"
done

OUT=$(node send.mjs --from claude-a --to opencode-b "hello from claude-a")
echo "$OUT"
[ "$(echo "$OUT" | jget state)" = "TASK_STATE_COMPLETED" ] && ok "task state completed" || bad "task state: $(echo "$OUT" | jget state)"
echo "$OUT" | jget artifacts | grep -q "hello from claude-a" && ok "artifact present with echoed text" || bad "artifact missing"

BURL=$(jget url < "$AOS_SESSIONS_DIR/opencode-b.json")
BODY='{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"messageId":"m1","role":"ROLE_USER","parts":[{"text":"x"}]}}}'
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BURL" -H 'Content-Type: application/json' -H 'A2A-Version: 1.0' -H 'Authorization: Bearer wrong' -d "$BODY")
[ "$CODE" = "401" ] && ok "wrong token -> 401" || bad "wrong token got $CODE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BURL" -H 'Content-Type: application/json' -H 'A2A-Version: 1.0' -d "$BODY")
[ "$CODE" = "401" ] && ok "no token -> 401" || bad "no token got $CODE"
TOK=$(jget token < "$AOS_SESSIONS_DIR/opencode-b.json")
curl -s -X POST "$BURL" -H 'Content-Type: application/json' -H 'A2A-Version: 1.0' -H "Authorization: Bearer $TOK" -d "$BODY" > logs/wire-sendmessage-response.json
grep -q '"result"' logs/wire-sendmessage-response.json && ok "raw SendMessage with right token -> result" || bad "raw SendMessage failed"

node sidecar.mjs --name evil --harness claude --host 0.0.0.0 >/dev/null 2>&1; RC=$?
[ "$RC" -ne 0 ] && [ ! -e "$AOS_SESSIONS_DIR/evil.json" ] && ok "non-loopback bind refused (rc $RC)" || bad "non-loopback bind not refused"

kill "$B"; wait "$B" 2>/dev/null
[ ! -e "$AOS_SESSIONS_DIR/opencode-b.json" ] && ok "opencode-b registry file removed after SIGTERM" || bad "registry file still present"
OUT=$(node send.mjs --from claude-a --to opencode-b "anyone there?"); RC=$?
echo "$OUT"
[ "$RC" -ne 0 ] && echo "$OUT" | grep -q '"error"' && ok "send to dead peer fails cleanly (rc $RC)" || bad "send to dead peer did not fail cleanly"

kill "$A"; wait "$A" 2>/dev/null
[ ! -e "$AOS_SESSIONS_DIR/claude-a.json" ] && ok "claude-a stopped, registry removed" || bad "claude-a registry remains"
kill -0 "$A" 2>/dev/null && bad "claude-a still running" || ok "no sidecar processes left"

echo "failures: $FAILS"
[ "$FAILS" -eq 0 ]
