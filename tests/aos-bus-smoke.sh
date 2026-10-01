#!/bin/bash
# Opt-in live smoke for aos-bus (not part of `npm test`). Needs `opencode` and sqlite3 on PATH.
# Everything runs in an isolated HOME/XDG tree; no model credentials needed (noReply).
# Manual TUI step: see the end of this file.
set -u
R=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d /private/tmp/aos-bus-smoke.XXXX)
export HOME="$T/home" XDG_CONFIG_HOME="$T/xdg/config" XDG_DATA_HOME="$T/xdg/data" XDG_STATE_HOME="$T/xdg/state" XDG_CACHE_HOME="$T/xdg/cache"
export AOS_SESSION_NAME=smoke
P="$XDG_CONFIG_HOME/opencode/plugins"
mkdir -p "$HOME" "$T/repo" "$P/aos-hooks"
cp "$R/.opencode/plugins/bdb-aos.js" "$P/"
cp "$R"/.claude/hooks/*.mjs "$P/aos-hooks/"
BUS="node $R/.claude/hooks/aos-bus.mjs"
PORT=$((20000 + RANDOM % 20000))
fail=0
ok() { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fail=1; }

(cd "$T/repo" && exec opencode serve --port "$PORT" >"$T/serve.log" 2>&1) &
SRV=$!
trap 'kill $SRV 2>/dev/null; echo "sandbox: $T"; exit $fail' EXIT

for _ in $(seq 60); do curl -sf "localhost:$PORT/session?directory=$T/repo" >/dev/null && break; sleep 0.5; done
SID=$(curl -s -X POST "localhost:$PORT/session?directory=$T/repo" -H 'content-type: application/json' -d '{}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
[ -n "$SID" ] && ok "session $SID created" || { bad "no session"; exit 1; }

for _ in $(seq 20); do $BUS list | grep -q '^smoke\t' && break; sleep 0.5; done
$BUS list | grep -q '^smoke\t' && ok "plugin registered 'smoke'" || { bad "not registered (see $T/serve.log)"; exit 1; }

$BUS send smoke "GO" >/dev/null && sleep 0.3 && $BUS send smoke "GO smoke" >/dev/null
for _ in $(seq 10); do [ -z "$(ls "$HOME"/.aos/bus/inbox/smoke/*.json 2>/dev/null)" ] && break; sleep 0.5; done
[ -z "$(ls "$HOME"/.aos/bus/inbox/smoke/*.json 2>/dev/null)" ] && ok "inbox drained" || bad "inbox not drained"
ls "$HOME"/.aos/bus/inbox/smoke/ | grep -q failed && bad "a message was parked as .failed"

DB="$XDG_DATA_HOME/opencode/opencode.db"
Q="select p.data from part p join message m on m.id=p.message_id where m.session_id='$SID' and json_extract(m.data,'\$.role')='user' order by m.time_created, p.id"
PARTS=$(sqlite3 "$DB" "$Q")
echo "$PARTS"
[ "$(echo "$PARTS" | grep -c '"synthetic":true')" -eq 2 ] && ok "synthetic=true persisted in opencode.db (2 parts)" || bad "synthetic NOT persisted"
echo "$PARTS" | grep -q '\[aos-bus from smoke\] GO smoke' && echo "$PARTS" | grep -q '"aos_bus"' && ok "prefix + metadata.aos_bus stored" || bad "prefix/metadata missing"

[ -e "$HOME/.aos/go/smoke.token" ] || [ -e "$HOME/.aos/go/worker-1.token" ] && bad "token file created" || ok "no GO token file"

MID=$(sqlite3 "$DB" "select id from message where session_id='$SID' and json_extract(data,'\$.role')='user' order by time_created desc, id desc limit 1")
mkdir -p "$HOME/.aos/go"
printf '{"target":"smoke","issued_at":"%s","issuer":"opencode","master_session_id":"%s","master_message_id":"%s"}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SID" "$MID" >"$HOME/.aos/go/smoke.token"
G=$(node -e "import('$R/.claude/hooks/go-gate.mjs').then(m=>console.log(JSON.stringify(m.tokenGrantsGo('smoke'))))")
echo "$G" | grep -q 'master session no longer ends with this GO' && ok "go-gate rejects token pointing at the bus message: $G" || bad "go-gate accepted: $G"

# Manual TUI step (not automated): with the same isolated env and no --port, start `opencode`
# in $T/repo, run `aos-bus send smoke "hi"` from a second terminal, then check the toast and
# the opencode.db row as above. That proves the plugin client works in TUI mode.
