#!/usr/bin/env bash
# Phase 1b spike check. Do NOT run directly during development if delegation spawns workers.
set -u
D="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$D/../.." && pwd)"
cd "$D"
export AOS_SESSIONS_DIR="$D/run/sessions"
export A2A_TESTDIR="$D/run/testdir"
export NO_PROXY='127.0.0.1,localhost,::1'
export no_proxy='127.0.0.1,localhost,::1'
mkdir -p "$AOS_SESSIONS_DIR" "$D/run/logs"
FAILS=0
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done; }
trap cleanup EXIT
ok()  { echo "PASS: $1"; }
bad() { echo "FAIL: $1"; FAILS=$((FAILS+1)); }
jget() { node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));const v=process.argv[1].split(".").reduce((a,k)=>a?.[k],j);console.log(typeof v==="object"?JSON.stringify(v):v)' "$1"; }
wait_reg() { for _ in $(seq 1 100); do [ -s "$AOS_SESSIONS_DIR/$1.json" ] && return 0; sleep 0.1; done; return 1; }

# fresh testdir
mkdir -p "$A2A_TESTDIR"
( cd "$A2A_TESTDIR" && git init -q && echo "# testdir" > README.md && git add README.md && git -c user.name=t -c user.email=t@t commit -qm init )

# baseline snapshots
CONFIG_SUM_BEFORE=$(find "$HOME/.config/opencode" -type f -not -path '*/node_modules/*' -exec shasum -a 256 {} + 2>/dev/null | sort)
WT_STATUS_BEFORE=$(git -C /Users/timrennings/dev/bdb-dev/aos-wt-zielc status --porcelain)

node sidecar-worker.mjs --name opencode-w --harness opencode > run/logs/opencode-w.log 2>&1 & W=$!; PIDS+=("$W")
wait_reg opencode-w && ok "opencode-w registered" || { bad "opencode-w did not register"; cat run/logs/opencode-w.log; exit 1; }

node sidecar.mjs --name claude-o --harness claude > run/logs/claude-o.log 2>&1 & C=$!; PIDS+=("$C")
wait_reg claude-o && ok "claude-o registered" || { bad "claude-o did not register"; cat run/logs/claude-o.log; exit 1; }

node send.mjs --from claude-o --to opencode-w "Create a file hello.txt containing exactly: hi from A2A. Do nothing else." > run/send-out.json 2>&1 &
S=$!
for _ in $(seq 1 360); do kill -0 "$S" 2>/dev/null || break; sleep 1; done
kill "$S" 2>/dev/null; wait "$S" 2>/dev/null
OUT=$(cat run/send-out.json)
echo "$OUT"
[ "$(echo "$OUT" | jget state)" = "TASK_STATE_COMPLETED" ] && ok "task state completed" || bad "task state: $(echo "$OUT" | jget state)"
[ -f "$A2A_TESTDIR/hello.txt" ] && grep -q "hi from A2A" "$A2A_TESTDIR/hello.txt" && ok "hello.txt exists with expected content" || bad "hello.txt missing or wrong content"
[ -f "$D/run/acp.jsonl" ] && ok "acp.jsonl exists" || bad "acp.jsonl missing"

CONFIG_SUM_AFTER=$(find "$HOME/.config/opencode" -type f -not -path '*/node_modules/*' -exec shasum -a 256 {} + 2>/dev/null | sort)
[ "$CONFIG_SUM_BEFORE" = "$CONFIG_SUM_AFTER" ] && ok "~/.config/opencode unchanged" || bad "~/.config/opencode changed"
WT_STATUS_AFTER=$(git -C /Users/timrennings/dev/bdb-dev/aos-wt-zielc status --porcelain)
[ "$WT_STATUS_BEFORE" = "$WT_STATUS_AFTER" ] && ok "aos-wt-zielc status unchanged" || bad "aos-wt-zielc status changed:
$WT_STATUS_AFTER"

kill "$W"; wait "$W" 2>/dev/null
[ ! -e "$AOS_SESSIONS_DIR/opencode-w.json" ] && [ ! -e "$AOS_SESSIONS_DIR/opencode-w.token" ] && ok "opencode-w registry+token removed" || bad "opencode-w registry files remain"
kill "$C"; wait "$C" 2>/dev/null
[ ! -e "$AOS_SESSIONS_DIR/claude-o.json" ] && ok "claude-o registry removed" || bad "claude-o registry remains"

echo "failures: $FAILS"
[ "$FAILS" -eq 0 ]
