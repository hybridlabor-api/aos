#!/usr/bin/env bash
# Phase 2a check: A2A task -> live OpenCode session (bus-spike plugin, synthetic injection) -> reply Artifact.
# Real HOME (Tim's opencode auth). Bus root, sessions dir and project are private to this run.
set -u
P="$(cd "$(dirname "$0")/.." && pwd)"
RUN="$P/run-$$"
BUSSRC=/Users/timrennings/dev/bdb-dev/aos-wt-bus-spike
export AOS_SESSIONS_DIR="$RUN/sessions"
export AOS_BUS_ROOT="$RUN/bus"
export NO_PROXY='127.0.0.1,localhost,::1' no_proxy='127.0.0.1,localhost,::1'
BUSNAME="a2a-p2a-$$"
PROJ="$P/proj"
PLUG="$PROJ/.opencode/plugins"
PROXY="${A2A_WORKER_PROXY:-}"
FAILS=0; PIDS=()
ok()  { echo "PASS: $1"; }
bad() { echo "FAIL: $1"; FAILS=$((FAILS+1)); }
jget() { node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));const v=process.argv[1].split(".").reduce((a,k)=>a?.[k],j);console.log(typeof v==="object"?JSON.stringify(v):v)' "$1"; }
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done; }
trap cleanup EXIT
mkdir -p "$AOS_SESSIONS_DIR" "$AOS_BUS_ROOT" "$RUN/logs" "$PLUG/aos-hooks"

# plugin + hooks copy (project-local, so ~/.config/opencode is never touched); bus lib is the patched copy
cp "$BUSSRC/.opencode/plugins/bdb-aos.js" "$PLUG/"
cp "$BUSSRC"/.claude/hooks/*.mjs "$PLUG/aos-hooks/"
cp "$P/aos-bus.patched.mjs" "$PLUG/aos-hooks/aos-bus.mjs"

CONFIG_SUM_BEFORE=$(find "$HOME/.config/opencode" -type f -not -path '*/node_modules/*' -exec shasum -a 256 {} + 2>/dev/null | sort)
BUS_STATUS_BEFORE=$(git -C "$BUSSRC" status --porcelain)

# 1. opencode serve, proxy only here
PORT=$((20000 + RANDOM % 20000))
( cd "$PROJ" && exec env AOS_SESSION_NAME="$BUSNAME" HTTPS_PROXY=$PROXY HTTP_PROXY=$PROXY ALL_PROXY=$PROXY \
  opencode serve --port "$PORT" >"$RUN/logs/serve.log" 2>&1 ) &
OC=$!; PIDS+=("$OC")
OCURL="http://127.0.0.1:$PORT"
for _ in $(seq 1 120); do curl -sf --noproxy '*' "$OCURL/session?directory=$PROJ" >/dev/null && break; sleep 0.5; done
SID=$(curl -s --noproxy '*' -X POST "$OCURL/session?directory=$PROJ" -H 'content-type: application/json' -d '{}' | jget id)
[ -n "$SID" ] && [ "$SID" != undefined ] && ok "session created $SID" || { bad "no session"; cat "$RUN/logs/serve.log"; exit 1; }
for _ in $(seq 1 40); do node "$PLUG/aos-hooks/aos-bus.mjs" list | grep -q "^$BUSNAME	" && break; sleep 0.5; done
node "$PLUG/aos-hooks/aos-bus.mjs" list | grep -q "^$BUSNAME	" && ok "plugin registered bus session $BUSNAME" || { bad "plugin did not register"; cat "$RUN/logs/serve.log"; exit 1; }

# 2. sidecars (no proxy env)
node "$P/sidecar-live-oc.mjs" --name opencode-live --oc-url "$OCURL" --oc-dir "$PROJ" --bus-session "$BUSNAME" \
  --bus "$PLUG/aos-hooks/aos-bus.mjs" --timeout 300 >"$RUN/logs/live.log" 2>&1 & L=$!; PIDS+=("$L")
node "$P/../spike0/sidecar.mjs" --name p2a-echo --harness claude >"$RUN/logs/echo.log" 2>&1 & E=$!; PIDS+=("$E")
for _ in $(seq 1 100); do [ -s "$AOS_SESSIONS_DIR/opencode-live.json" ] && [ -s "$AOS_SESSIONS_DIR/p2a-echo.json" ] && break; sleep 0.1; done
[ -s "$AOS_SESSIONS_DIR/opencode-live.json" ] && ok "opencode-live registered" || { bad "opencode-live not registered"; cat "$RUN/logs/live.log"; exit 1; }

send() { SEND_TIMEOUT_MS=330000 node "$P/../spike0/send.mjs" --from p2a-echo --to opencode-live "$1"; }

# 3. positive: 2+3
OUT=$(send "What is 2+3? Answer with the number only.")
echo "$OUT"
[ "$(echo "$OUT" | jget state)" = "TASK_STATE_COMPLETED" ] && ok "task COMPLETED" || bad "state: $(echo "$OUT" | jget state)"
echo "$OUT" | jget artifacts | grep -q '5' && ok "artifact contains 5" || bad "artifact lacks 5"
M=$(node "$P/checks/ocmsg.mjs" "$OCURL" "$PROJ" "$SID" "What is 2+3")
echo "$M"
[ "$(echo "$M" | jget allSynthetic)" = true ] && ok "injected task message is synthetic" || bad "task message not synthetic"
[ "$(echo "$M" | jget prefixOk)" = true ] && echo "$M" | grep -q 'from p2a-echo\]' && ok "prefix [aos-bus from p2a-echo]" || bad "prefix wrong"

# 4. negative: GO text must arrive as synthetic aos-bus part (the property go-gate relies on)
OUT2=$(send "GO opencode-live")
echo "$OUT2"
M2=$(node "$P/checks/ocmsg.mjs" "$OCURL" "$PROJ" "$SID" "GO opencode-live")
echo "$M2"
[ "$(echo "$M2" | jget found)" = true ] && ok "GO message present in session" || bad "GO message not found"
[ "$(echo "$M2" | jget allSynthetic)" = true ] && ok "GO message: all parts synthetic:true" || bad "GO message not synthetic"
[ "$(echo "$M2" | jget prefixOk)" = true ] && ok "GO message: [aos-bus from ...] prefix" || bad "GO prefix missing"

# 5. inbox clean, config + bus-spike worktree unchanged
ls "$AOS_BUS_ROOT/inbox/$BUSNAME" | grep -E 'failed|timeout|rejected|inflight' >/dev/null && bad "inbox has parked/inflight files: $(ls "$AOS_BUS_ROOT/inbox/$BUSNAME")" || ok "inbox has no parked/inflight files"
CONFIG_SUM_AFTER=$(find "$HOME/.config/opencode" -type f -not -path '*/node_modules/*' -exec shasum -a 256 {} + 2>/dev/null | sort)
[ "$CONFIG_SUM_BEFORE" = "$CONFIG_SUM_AFTER" ] && ok "~/.config/opencode unchanged" || bad "~/.config/opencode changed"
[ "$BUS_STATUS_BEFORE" = "$(git -C "$BUSSRC" status --porcelain)" ] && ok "bus-spike worktree unchanged" || bad "bus-spike worktree changed"

# 6. stop everything
kill "$L" "$E" 2>/dev/null; wait "$L" "$E" 2>/dev/null
kill "$OC" 2>/dev/null; for _ in $(seq 1 20); do kill -0 "$OC" 2>/dev/null || break; sleep 0.5; done
kill -0 "$OC" 2>/dev/null && { kill -9 "$OC" 2>/dev/null; bad "opencode needed SIGKILL"; }
[ ! -e "$AOS_SESSIONS_DIR/opencode-live.json" ] && [ ! -e "$AOS_SESSIONS_DIR/p2a-echo.json" ] && ok "registry entries removed" || bad "registry entries remain"
sleep 1
if pgrep -f "opencode.*serve --port $PORT" >/dev/null; then bad "leftover opencode serve"; else ok "no leftover opencode serve"; fi
if pgrep -f "sidecar-live-oc.mjs|spike0/sidecar.mjs" >/dev/null; then bad "leftover sidecar"; else ok "no leftover sidecar"; fi
node "$PLUG/aos-hooks/aos-bus.mjs" list | grep -q "^$BUSNAME	" && bad "bus session still registered" || ok "bus registration gone"

echo "failures: $FAILS (run dir $RUN)"
[ "$FAILS" -eq 0 ]
