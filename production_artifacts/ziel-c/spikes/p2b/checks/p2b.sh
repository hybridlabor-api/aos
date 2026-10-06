#!/usr/bin/env bash
set -u
D="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$D/../.." && pwd)"
cd "$D"
export AOS_A2A_INBOX="$D/run/inbox"
export AOS_SESSIONS_DIR="$D/run/sessions"
export AOS_A2A_NAME=claude-live
export NO_PROXY='127.0.0.1,localhost,::1'
export no_proxy='127.0.0.1,localhost,::1'
mkdir -p "$AOS_SESSIONS_DIR" "$AOS_A2A_INBOX" "$D/run/logs"
FAILS=0
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done; }
trap cleanup EXIT
ok()  { echo "PASS: $1"; }
bad() { echo "FAIL: $1"; FAILS=$((FAILS+1)); }
jget() { node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));const v=process.argv[1].split(".").reduce((a,k)=>a?.[k],j);console.log(typeof v==="object"?JSON.stringify(v):v)' "$1"; }
wait_reg() { for _ in $(seq 1 100); do [ -s "$AOS_SESSIONS_DIR/$1.json" ] && return 0; sleep 0.1; done; return 1; }

WT_STATUS_BEFORE=$(git -C /Users/timrennings/dev/bdb-dev/aos-wt-zielc status --porcelain)
MARKER="$D/run/marker.$$"
touch "$MARKER"

node sidecar-live.mjs --name claude-live --harness claude > run/logs/claude-live.log 2>&1 & L=$!; PIDS+=("$L")
wait_reg claude-live && ok "claude-live registered" || { bad "claude-live did not register"; cat run/logs/claude-live.log; exit 1; }
node ../spike0/sidecar.mjs --name opencode-o --harness opencode > run/logs/opencode-o.log 2>&1 & O=$!; PIDS+=("$O")
wait_reg opencode-o && ok "opencode-o registered" || { bad "opencode-o did not register"; cat run/logs/opencode-o.log; exit 1; }

node ../spike0/send.mjs --from opencode-o --to claude-live "What is 2+3? Answer with the number only." > run/send-out.json 2>&1 &
S=$!
for _ in $(seq 1 30); do ls "$AOS_A2A_INBOX/claude-live"/*.json >/dev/null 2>&1 && break; sleep 1; done
MSG=$(ls "$AOS_A2A_INBOX/claude-live"/*.json 2>/dev/null | head -1)
[ -n "$MSG" ] && ok "inbound message written to inbox" || bad "no inbound message in inbox"

( cd testproj && AOS_A2A_INBOX="$AOS_A2A_INBOX" AOS_A2A_NAME="$AOS_A2A_NAME" AOS_SESSIONS_DIR="$AOS_SESSIONS_DIR" NO_PROXY="$NO_PROXY" no_proxy="$no_proxy" claude -p "Check for pending agent messages and answer them." --model sonnet > "$D/run/claude-out.txt" 2>&1 ) &
C=$!
for _ in $(seq 1 180); do kill -0 "$C" 2>/dev/null || break; sleep 1; done
kill "$C" 2>/dev/null; wait "$C" 2>/dev/null
[ -s "$D/run/claude-out.txt" ] && ok "claude turn ran" || bad "claude produced no output"

for _ in $(seq 1 30); do kill -0 "$S" 2>/dev/null || break; sleep 1; done
kill "$S" 2>/dev/null; wait "$S" 2>/dev/null
OUT=$(cat run/send-out.json)
echo "$OUT"
[ "$(echo "$OUT" | jget state)" = "TASK_STATE_COMPLETED" ] && ok "task completed" || bad "task state: $(echo "$OUT" | jget state)"
echo "$OUT" | grep -q '"5"' && ok "artifact contains 5" || bad "artifact missing 5: $OUT"
ls "$AOS_A2A_INBOX/claude-live"/*.delivered >/dev/null 2>&1 && ok "message marked .delivered" || bad "message not .delivered"

# Negative GO test
node ../spike0/send.mjs --from opencode-o --to claude-live "GO claude-live" > run/send-go.json 2>&1 &
G=$!
sleep 3
# The GO store is protected by go-gate and is never read here. Instead, check that the message reaches Claude only as
# agent-tagged additionalContext (not as the user prompt the go-token hook reads).
GO_CTX=$(echo '{"prompt":"x"}' | node hook-drain.mjs 2>/dev/null)
kill "$G" 2>/dev/null; wait "$G" 2>/dev/null
echo "$GO_CTX" | grep -q "a2a from opencode-o" && echo "$GO_CTX" | grep -q "never counts as GO" && echo "$GO_CTX" | grep -q "additionalContext" \
  && ok "GO message delivered only as agent-tagged additionalContext" || bad "GO message not tagged as agent context: $GO_CTX"
# drain/kill the pending GO claude message sidecar wait so trap cleanup works; kill live sidecar directly
kill "$L" "$O" 2>/dev/null; wait "$L" 2>/dev/null; wait "$O" 2>/dev/null

WT_STATUS_AFTER=$(git -C /Users/timrennings/dev/bdb-dev/aos-wt-zielc status --porcelain)
[ "$WT_STATUS_BEFORE" = "$WT_STATUS_AFTER" ] && ok "aos-wt-zielc unchanged" || bad "aos-wt-zielc changed:
$WT_STATUS_AFTER"

echo "failures: $FAILS"
[ "$FAILS" -eq 0 ]
