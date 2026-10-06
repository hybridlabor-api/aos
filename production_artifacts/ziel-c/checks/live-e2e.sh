#!/usr/bin/env bash
# live-e2e.sh — host live end-to-end check of the A2A peer network.
# Implements plan items 1-5 of production_artifacts/ziel-c/00_execution_plan.md
# ("Host live check"), the ring Claude -> OpenCode -> agy -> Codex -> Claude
# with every ordered pair at least once (#live-ring), and the agy orchestrator
# check (#agy-orch-check: agy sends to OpenCode and Claude and starts one
# OpenCode worker via aos-acp).
#
# Run LATER on the host by a human with a GO; the go-gate blocks freshly
# written scripts, so this file must be committed before it runs.
#
# usage: live-e2e.sh [--dry-run] [--help]
#   --dry-run   print the planned steps (one numbered line each: what would be
#               started, sent or asserted) and exit 0 WITHOUT starting any
#               process, sending anything or creating any file.
#   --help      print this usage text.
#
# Environment variables (all optional; no proxy URL, model name or machine
# path is hardcoded anywhere in this script):
#   A2A_E2E_PROXY      proxy URL passed ONLY into the OpenCode launch
#                      environments (opencode serve, aos-acp worker). When
#                      unset, no proxy is used anywhere.
#   A2A_E2E_MODEL      model id passed to `claude --model` and to the
#                      `aos-acp opencode` worker launch (--model) when set.
#   A2A_E2E_ROOT       repo root. Default: three levels up from this script.
#   A2A_E2E_TIMEOUT    deadline in seconds for every wait. Default: 60.
#                      Raise it for live harness turns (claude/agy/codex).
#   A2A_E2E_AGY=1      enable the agy legs (#live-ring + #agy-orch-check) and
#                      launch the agy sidecar itself before the ring:
#                      `aos-a2a serve --name e2e-agy --mode agy` with cwd
#                      $A2A_E2E_AGY_DIR (default $AGY_WORK_DIR under the temp
#                      root). NOTE: `agy --continue` continues the most recent
#                      conversation of that project directory, so
#                      A2A_E2E_AGY_DIR should be a directory where you already
#                      HAVE an agy conversation; an empty temp dir means agy
#                      starts fresh conversations. Otherwise the legs SKIP,
#                      naming this flag.
#   A2A_E2E_AGY_DIR    working directory for the agy sidecar (see above).
#   A2A_E2E_AGY_TIMEOUT  per-send timeout (seconds, default 300) used for every
#                      send that targets the agy sidecar ($AGY_SESSION) and for
#                      the agy-orchestrator turn deadline: a headless
#                      `agy --continue --print` turn can take >120 s on this
#                      machine, so the default A2A_E2E_TIMEOUT=60 is too low.
#   A2A_E2E_CODEX=1    enable the Codex ring legs; requires
#                      A2A_E2E_CODEX_THREAD to be set to the session UUID or
#                      exact name of an ALREADY OPEN Codex session of yours
#                      (this script never creates one). The codex sidecar is
#                      launched as `aos-a2a serve --name e2e-codex --mode codex
#                      --thread $A2A_E2E_CODEX_THREAD`. If the thread variable
#                      is missing, the codex legs SKIP naming it.
#   A2A_E2E_CODEX_TIMEOUT  per-send timeout (seconds, default 300) used for
#                      every send that targets the codex sidecar
#                      ($CODEX_SESSION) and, combined with
#                      A2A_E2E_AGY_TIMEOUT, to size the ring-claude-send turn
#                      deadline (see below).
#   A2A_E2E_AGY_YOLO=1 pass `--dangerously-skip-permissions` to agy. A human
#                      must be present; the flag is never passed otherwise.
#
# Output: one line per check: `PASS <name>`, `FAIL <name>: <reason>` or
# `SKIP <name>: <reason>`, then a `summary:` line with the counts. A missing
# optional binary is a SKIP, never a FAIL. Exit code is non-zero if any check
# FAILed, else 0.
#
# Safety: this script deletes nothing (no rm anywhere); all temporary state
# lives in ONE mktemp -d directory which is LEFT IN PLACE, its path is printed
# at the end. The A2A registry, bus inbox and scratch projects are isolated
# into it via AOS_SESSIONS_DIR / AOS_BUS_ROOT / AOS_A2A_INBOX, so ~/.aos is
# never read or touched. Harnesses run in the repo ROOT (where the hooks
# already live) via CLAUDE_PROJECT_DIR / --cwd; no ~/.claude or ~/.opencode
# config tree is copied anywhere. The only access beyond the repo is READING
# ~/.config/opencode for a shasum snapshot (skipped when the dir is absent),
# and `node bin/go-check.mjs` as the only consumer of GO state (no file under
# ~/.aos/go is ever read directly, and --consume is NEVER passed). Cleanup
# kills only PIDs this script captured (never pkill/killall).
set -u

# ---- resolved configuration ---------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${A2A_E2E_ROOT:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
A2A_BIN="$ROOT/bin/aos-a2a.mjs"
GO_CHECK_BIN="$ROOT/bin/go-check.mjs"
A2A_E2E_TIMEOUT="${A2A_E2E_TIMEOUT:-60}"
TIMEOUT="$A2A_E2E_TIMEOUT"
AGY_ENABLED="${A2A_E2E_AGY:-0}"  # 1 = agy legs on
CODEX_ENABLED="${A2A_E2E_CODEX:-0}" # 1 = codex legs on
# Harness-turn timeouts: agy turns are slow (>120 s for one headless turn on
# this machine), so sends that target the agy sidecar and the agy-orch turn
# deadline use A2A_E2E_AGY_TIMEOUT (default 300); the same for the codex
# sidecar. The ring-claude-send turn (which sends to agy AND codex inside one
# claude turn) gets max(CL_TURN_TIMEOUT, AGY_TIMEOUT + CODEX_TIMEOUT).
AGY_TIMEOUT="${A2A_E2E_AGY_TIMEOUT:-300}"
CODEX_TIMEOUT="${A2A_E2E_CODEX_TIMEOUT:-300}"

show_usage() { sed -n '2,50p' "$0" | sed 's/^# \{0,1\}//'; }

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) show_usage; exit 0 ;;
    *) echo "unknown argument: $arg (try --help)" >&2; exit 2 ;;
  esac
done

pass() { echo "PASS $1"; PASS_COUNT=$((PASS_COUNT + 1)); }

fail() { echo "FAIL $1: $2"; FAIL_COUNT=$((FAIL_COUNT + 1)); RUN_RC=1; }
skip() { echo "SKIP $1: $2"; SKIP_COUNT=$((SKIP_COUNT + 1)); }
say() { echo "$*"; }
need() { command -v "$1" >/dev/null 2>&1; }
trunc() { printf '%s' "$1" | tr '\n' ' ' | cut -c1-200; }
summary_line() { echo "summary: pass=$PASS_COUNT fail=$FAIL_COUNT skip=$SKIP_COUNT"; }

# ---- temp state: ONE mktemp -d dir (no /tmp literal, no rm, never deleted) -----

if [ "$DRY_RUN" = 0 ]; then
  TMP_DIR="$(mktemp -d)"
  export AOS_SESSIONS_DIR="$TMP_DIR/sessions"
  export AOS_BUS_ROOT="$TMP_DIR/bus"
  export AOS_A2A_INBOX="$TMP_DIR/inbox"
  PIDS="$TMP_DIR/pids"
  OC_WORK_DIR="$TMP_DIR/oc-project"
  CL_WORK_DIR="$TMP_DIR/claude-project"
  AGY_WORK_DIR="$TMP_DIR/agy-worker"
fi
# Claude turns are kept busy (`sleep 45`, see check_item1) so an inbound probe
# can be delivered inside the turn window; their deadline is max(TIMEOUT, 90).
CL_TURN_TIMEOUT="$A2A_E2E_TIMEOUT"
if [ "$CL_TURN_TIMEOUT" -lt 90 ]; then CL_TURN_TIMEOUT=90; fi
# Per-turn deadline override read by wait_logged (claude turns only).
TURN_TIMEOUT_CURRENT=""

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
RUN_RC=0
OC_SESSION="e2e-opencode"
CL_SESSION="e2e-claude"
AGY_SESSION="e2e-agy"
CODEX_SESSION="e2e-codex"

# Global proxy policy: nothing may leak a proxy into loopback A2A traffic; the
# real proxy (if any) is applied ONLY inside the OpenCode launch envs below.
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
export NO_PROXY="127.0.0.1,localhost,::1"
export no_proxy="127.0.0.1,localhost,::1"

# ---- registry helpers ----------------------------------------------------------

reg_line_for() { # reg_line_for <name> -> first matching list line (or nothing)
  node "$A2A_BIN" list 2>/dev/null | awk -F'\t' -v n="$1" '$1 == n { print; exit }'
}

wait_for() { # wait_for <name> -> polls until the session is registered; 0 on success
  local want="$1" t0
  t0=$(date +%s)
  while :; do
    if [ -n "$(reg_line_for "$want")" ]; then return 0; fi
    if [ "$(( $(date +%s) - t0 ))" -ge "$TIMEOUT" ]; then return 1; fi
    sleep 2
  done
}

# capture_pid <pid>: remember every background pid; cleanup kills only these.
capture_pid() { say "$1" >>"$PIDS"; }
# --echo-selftest is NOT implemented: no echo sidecar fallback exists here. A
# harness sidecar that fails to register live is reported as FAIL instead.

# ---- nonce probes (E3) -------------------------------------------------------------
# Arithmetic questions put the expected answer inside the question, so an echo
# reply always "passes". Every live send uses a nonce probe: the expected
# string is BUILT by the model (prefix, dash, two letters) and the expected
# string itself never appears verbatim in the prompt text.

NONCE=0
gen_probe() { # gen_probe: sets PROBE_TEXT and PROBE_OK for the next send
  NONCE=$((NONCE + 1))
  local p
  p="N${NONCE}Z"
  PROBE_OK="$p-OK"
  PROBE_TEXT="Build one word and print ONLY that word, nothing else. The word is: the string '$p', then a dash character, then the two-letter word 'O' followed immediately by 'K'."
}

# ---- generic A2A leg: send and assert completed + expected substring -------------

send_check() { # send_check <check-name> <from> <to> <expect> <text>
  local name="$1" from="$2" to="$3" expect="$4" text="$5" out to_timeout
  # Per-target timeout: sends that target the agy or codex sidecar get the
  # slower harness timeouts (A2A_E2E_AGY_TIMEOUT / A2A_E2E_CODEX_TIMEOUT,
  # default 300 each); everything else keeps $TIMEOUT.
  case "$to" in
    "$AGY_SESSION") to_timeout="$AGY_TIMEOUT" ;;
    "$CODEX_SESSION") to_timeout="$CODEX_TIMEOUT" ;;
    *) to_timeout="$TIMEOUT" ;;
  esac
  # Run-10 evidence: the busy claude turn can end before a send targets
  # e2e-claude ("no live registry entry" / "fetch failed"), so make sure the
  # sidecar is up AND answering before every claude-targeted send.
  if [ "$to" = "$CL_SESSION" ]; then ensure_claude_busy || true; fi
  # Run-10 evidence: a timeout on a codex-targeted send is usually NOT the
  # script or sidecar but the Codex session itself (queue is only answered
  # while the session is open and resumed); say so in every failure for it.
  local codex_note=""
  if [ "$to" = "$CODEX_SESSION" ]; then
    codex_note=" [codex session must be open and resumed (not only listed in the resume picker); thread=${A2A_E2E_CODEX_THREAD:-<unset>}]"
  fi
  if ! out="$(node "$A2A_BIN" send --to "$to" --from "$from" --timeout "$to_timeout" "$text" 2>&1)"; then
    fail "$name" "a2a send exited non-zero (timeout was ${to_timeout}s): $(trunc "$out")$codex_note"
    return 0
  fi
  case "$out" in
    *TASK_STATE_COMPLETED*)
      case "$out" in
        *"$expect"*) pass "$name" ;;
        *) fail "$name" "completed but artifact missing '$expect': $(trunc "$out")$codex_note" ;;
      esac
      ;;
    *) fail "$name" "task did not reach COMPLETED: $(trunc "$out")$codex_note" ;;
  esac
}

send_probe() { # send_probe <check-name> <from> <to>: one nonce-probe send (E3)
  local name="$1" from="$2" to="$3"
  gen_probe
  send_check "$name" "$from" "$to" "$PROBE_OK" "$PROBE_TEXT"
}

# ---- harness turn runners --------------------------------------------------------

# run_claude <prompt> <logfile> [extra-claude-flags...]:
# `claude -p <prompt> --output-format text`; --model only when A2A_E2E_MODEL
# is set. No other flags are invented here (verified: -p/--output-format/
# --model/--allowedTools are the only ones used). E4: `exec` inside the
# subshell so the captured PID IS the claude process. E6: cwd and
# CLAUDE_PROJECT_DIR are always ROOT, where the repo hooks and the PATH shim
# (prepared at start) make `aos-a2a` resolvable.
run_claude() {
  local prompt="$1" log="$2"
  shift 2
  local args=(-p "$prompt" --output-format text)
  if [ -n "${A2A_E2E_MODEL:-}" ]; then args+=(--model "${A2A_E2E_MODEL}"); fi
  if [ "$#" -gt 0 ]; then args+=("$@"); fi
  ( cd "$ROOT" && exec env AOS_A2A_NAME="$CL_SESSION" CLAUDE_PROJECT_DIR="$ROOT" claude "${args[@]}" ) >"$log" 2>&1 &
  capture_pid "$!"
}

# wait_logged <check-name> <pid> <logfile> <marker>:
# waits for the turn to end (deadline TIMEOUT), then asserts the marker and
# expected send outputs it printed. Used by the prompt-driven Turns that run
# `aos-a2a send` inside a real harness session (items 3, ring claude, agy orch).
wait_logged() { # wait_logged <name> <pid> <log> <marker> [misses-marker...]
  # Deadline: TURN_TIMEOUT_CURRENT (busy claude turns, max(TIMEOUT,90)) or TIMEOUT.
  local name="$1" pid="$2" log="$3" marker="$4" deadline="${TURN_TIMEOUT_CURRENT:-$TIMEOUT}"
  local t0
  t0=$(date +%s)
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$(( $(date +%s) - t0 ))" -ge "$deadline" ]; then
      kill "$pid" 2>/dev/null
      fail "$name" "turn exceeded ${deadline}s (hook/permission-settings failure is likelier than a timeout; tail: $(trunc "$(tail -c 200 "$log")"))"
      return 0
    fi
    sleep 2
  done
  local misses="" m
  grep -q "$marker" "$log" || misses="$misses $marker"
  for m in "$@"; do
    grep -q "$m" "$log" || misses="$misses $m"
  done
  if [ -z "$misses" ]; then
    pass "$name"
  elif ! grep -q 'aos-a2a' "$log"; then
    fail "$name" "turn never ran a send (hook/permission failure likely; missed:$misses; tail: $(trunc "$(tail -c 200 "$log")"))"
  else
    fail "$name" "turn ran but missed markers:$misses (tail: $(trunc "$(tail -c 200 "$log")"))"
  fi
}

# wait_logged_send <name> <pid> <log> <expect>:
# like wait_logged, but for a turn whose success is defined by ONE
# `aos-a2a send` JSON result: COMPLETED works if the log contains
# TASK_STATE_COMPLETED AND the expected artifact text. The trailing marker
# line is advisory only (run-8 evidence: marker was missing although the
# send completed with the expected answer). The hook/permission diagnosis
# is kept for the case where the log contains no send result at all.
wait_logged_send() { # wait_logged_send <name> <pid> <log> <expect>
  local name="$1" pid="$2" log="$3" expect="$4" deadline="${TURN_TIMEOUT_CURRENT:-$TIMEOUT}"
  local t0
  t0=$(date +%s)
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$(( $(date +%s) - t0 ))" -ge "$deadline" ]; then
      kill "$pid" 2>/dev/null
      fail "$name" "turn exceeded ${deadline}s (hook/permission-settings failure is likelier than a timeout; tail: $(trunc "$(tail -c 200 "$log")"))"
      return 0
    fi
    sleep 2
  done
  if grep -q 'TASK_STATE_COMPLETED' "$log" && grep -q "$expect" "$log"; then
    pass "$name"
  elif ! grep -q 'aos-a2a' "$log"; then
    fail "$name" "turn never ran a send (hook/permission failure likely; expected '$expect'; tail: $(trunc "$(tail -c 200 "$log")"))"
  else
    fail "$name" "send did not reach COMPLETED with '$expect' (marker line advisory only; tail: $(trunc "$(tail -c 200 "$log")"))"
  fi
}

# ---- check item 1: sessions live in the registry ----------------------------------
# E2: every launched harness/sidecar env exports AOS_A2A_NAME so the plugin/
# hook registers a known name instead of `opencode-<8 chars>`. E5: no echo
# fallback exists; a leg that never comes up live is reported as FAIL.

# ---- sidecar bring-up for the agy / codex ring legs (#live-ring) -------------------
# A2A_E2E_AGY=1 starts an agy sidecar (`--mode agy`) so agy is reachable as an
# INBOUND target: the executor spawns `agy --continue --print <injected prompt>`
# in the sidecar's cwd and answers with its stdout. $A2A_E2E_AGY_DIR (default:
# the temp AGY_WORK_DIR) should hold an existing agy conversation, because
# `agy --continue` resumes the most recent conversation of that project
# directory.
# A2A_E2E_CODEX=1 with $A2A_E2E_CODEX_THREAD set starts a codex sidecar against
# an ALREADY OPEN Codex session (UUID or exact name); the script never creates
# the Codex session, and without the thread variable the legs SKIP.

start_agy_sidecar() { # FAILs if the sidecar never registers
  local log="$TMP_DIR/agy-sidecar.log" dir
  dir="${A2A_E2E_AGY_DIR:-$AGY_WORK_DIR}"
  mkdir -p "$dir"
  ( cd "$dir" && exec env AOS_A2A_NAME="$AGY_SESSION" \
      AOS_SESSIONS_DIR="$AOS_SESSIONS_DIR" AOS_BUS_ROOT="$AOS_BUS_ROOT" \
      AOS_A2A_INBOX="$AOS_A2A_INBOX" node "$A2A_BIN" serve \
      --name "$AGY_SESSION" --harness agy --mode agy --parent-pid "$$" ) \
    >"$log" 2>&1 &
  capture_pid "$!"
  if ! wait_for "$AGY_SESSION"; then
    fail "sidecar-agy-bringup" "$AGY_SESSION not registered within ${TIMEOUT}s (log tail: $(trunc "$(tail -c 300 "$log")"))"
    return 1
  fi
  pass "sidecar-agy-bringup"
  return 0
}

start_codex_sidecar() { # requires $A2A_E2E_CODEX_THREAD; FAILs if never registered
  if [ -z "${A2A_E2E_CODEX_THREAD:-}" ]; then
    return 1 # caller SKIPs naming the missing variable
  fi
  local log="$TMP_DIR/codex-sidecar.log"
  ( cd "$ROOT" && exec env AOS_A2A_NAME="$CODEX_SESSION" \
      AOS_SESSIONS_DIR="$AOS_SESSIONS_DIR" AOS_BUS_ROOT="$AOS_BUS_ROOT" \
      AOS_A2A_INBOX="$AOS_A2A_INBOX" node "$A2A_BIN" serve \
      --name "$CODEX_SESSION" --harness codex --mode codex \
      --thread "$A2A_E2E_CODEX_THREAD" --parent-pid "$$" ) \
    >"$log" 2>&1 &
  capture_pid "$!"
  if ! wait_for "$CODEX_SESSION"; then
    fail "sidecar-codex-bringup" "$CODEX_SESSION not registered within ${TIMEOUT}s (log tail: $(trunc "$(tail -c 300 "$log")"))"
    return 1
  fi
  pass "sidecar-codex-bringup"
  return 0
}

# ---- OpenCode bring-up -----------------------------------------------------------
# Verified in the docs (2026-10): https://opencode.ai/docs/server — headless HTTP
# server: `opencode serve [--port <number>] [--hostname <string>]` (the bare
# `opencode` command is the TUI and must NOT be used here); POST /session with
# body `{ parentID?, title? }` creates a session. https://opencode.ai/docs/plugins —
# local project plugins live in `.opencode/plugins/` and are loaded automatically
# at startup; the opencode.json `plugin` array is for npm packages.
oc_log_tail() { tail -n 20 "$1" 2>/dev/null | tr '\n' ' '; }

# start_busy_claude_turn <logfile>: launches ONE busy claude turn exactly
# like check_item1's (same launch env, same 45 s sleep window, captured PID)
# and waits until $CL_SESSION is registered. Returns wait_for's status; the
# caller reports pass/fail with its own name.
start_busy_claude_turn() { # start_busy_claude_turn <logfile>
  local log="$1"
  local busy_prompt='Keep this turn busy: first run sleep 45 via the Bash tool, then say done. If sleep is not permitted, instead write a 1000-word essay on bash quoting, then say done.'
  run_claude "$busy_prompt" "$log"
  wait_for "$CL_SESSION"
}

# CLAUDE_MISSING=1 when the claude binary is absent; ensure_claude_busy is then
# a no-op and every claude leg reports its own SKIP instead.
CLAUDE_MISSING=0
need claude || CLAUDE_MISSING=1

# ensure_claude_busy: run-8/run-10 evidence — a busy claude turn from an
# earlier item may have already ended by the time a send targets e2e-claude,
# so the sidecar is not registered ("no live registry entry"). Call this
# immediately before EVERY send that targets $CL_SESSION. It starts a fresh
# busy turn (same launch and sleep window as item 1, captured PID) when no
# registry entry exists, then verifies the sidecar actually ANSWERS: the
# agent card URL is taken from the registry line and curled directly (no
# proxy). If it does not answer within TIMEOUT, the busy turn is restarted
# ONCE. Callable from ring_checks AND ring_agy_turn.
ensure_claude_busy() {
  if [ "$CLAUDE_MISSING" = 1 ]; then return 0; fi
  [ -z "$(reg_line_for "$CL_SESSION")" ] &&
    start_busy_claude_turn "$TMP_DIR/claude-busy-restart.log" || true
  if ! wait_for "$CL_SESSION"; then return 1; fi
  local url t0
  url="$(reg_line_for "$CL_SESSION" | grep -oE 'https?://[^[:space:]]+' | head -n 1)"
  [ -n "$url" ] || return 1
  t0=$(date +%s)
  while :; do
    if curl -sf --noproxy '*' --max-time 5 -o /dev/null "$url" 2>/dev/null; then return 0; fi
    if [ "$(( $(date +%s) - t0 ))" -ge "$TIMEOUT" ]; then break; fi
    sleep 2
  done
  # Registered but not answering: restart the busy turn once, then re-check.
  start_busy_claude_turn "$TMP_DIR/claude-busy-restart-2.log" || true
  curl -sf --noproxy '*' --max-time 5 -o /dev/null "$url" 2>/dev/null
}

check_item1() {
  local log
  mkdir -p "$OC_WORK_DIR"
  if need opencode; then
    local oc_env=()
    if [ -n "${A2A_E2E_PROXY:-}" ]; then
      oc_env+=(HTTP_PROXY="$A2A_E2E_PROXY" HTTPS_PROXY="$A2A_E2E_PROXY")
    fi
    log="$TMP_DIR/opencode-serve.log"
    # `opencode serve --port 0 --hostname 127.0.0.1` (docs-verified), cwd = the
    # scratch project dir whose .opencode/plugins/bdb-aos.js re-exports the repo
    # plugin. The plugin only starts the sidecar when a session exists
    # (session.created -> ensureBus -> ensureSidecar), so after the URL is
    # parsed a session is created over the HTTP API, then the registry is polled.
    ( cd "$OC_WORK_DIR" && exec env ${oc_env[@]+"${oc_env[@]}"} \
        AOS_A2A_NAME="$OC_SESSION" AOS_SESSIONS_DIR="$AOS_SESSIONS_DIR" \
        AOS_BUS_ROOT="$AOS_BUS_ROOT" AOS_A2A_INBOX="$AOS_A2A_INBOX" \
        NO_PROXY="127.0.0.1,localhost,::1" no_proxy="127.0.0.1,localhost,::1" \
        opencode serve --port 0 --hostname 127.0.0.1 ) \
      >"$log" 2>&1 &
    local op_pid=$!
    capture_pid "$op_pid"
    local oc_url="" t0
    t0=$(date +%s)
    while :; do
      # UNVERIFIED exact log line: the docs give no "listening" line format for
      # serve, so parse any http://127.0.0.1:<port> the log prints.
      oc_url="$(grep -oE 'http://127\.0\.0\.1:[0-9]+' "$log" 2>/dev/null | tail -n 1)"
      [ -n "$oc_url" ] && break
      if ! kill -0 "$op_pid" 2>/dev/null; then break; fi
      if [ "$(( $(date +%s) - t0 ))" -ge "$TIMEOUT" ]; then break; fi
      sleep 1
    done
    # The server may log its URL slightly before it accepts requests: retry a few times and keep
    # the HTTP status and body of the last attempt for the failure message.
    local post_ok=0 post_try post_code=""
    if [ -n "$oc_url" ]; then
      for post_try in 1 2 3 4 5; do
        post_code="$(curl -s --noproxy '*' --max-time 10 -o "$TMP_DIR/oc-session.body" -w '%{http_code}' \
          -X POST "$oc_url/session" -H 'content-type: application/json' \
          -d "{\"title\":\"$OC_SESSION\"}" 2>"$TMP_DIR/oc-session.err")" || post_code="curl-failed"
        case "$post_code" in 2??) post_ok=1; break ;; esac
        sleep 2
      done
    fi
    if [ "$post_ok" = 1 ]; then
      if wait_for "$OC_SESSION"; then
        pass "item1-opencode-registered"
      else
        fail "item1-opencode" "$OC_SESSION not registered (serve log tail: $(oc_log_tail "$log"))"
      fi
    else
      fail "item1-opencode" "serve URL not parsed or POST $oc_url/session failed (status: ${post_code:-none}; body: $(head -c 300 "$TMP_DIR/oc-session.body" 2>/dev/null | tr '\n' ' '); curl: $(head -c 200 "$TMP_DIR/oc-session.err" 2>/dev/null | tr '\n' ' '); log tail: $(oc_log_tail "$log"))"
    fi
  else
    (node "$A2A_BIN" serve --name "$OC_SESSION" --harness opencode --mode echo --parent-pid "$$") \
      >"$TMP_DIR/oc-sidecar.log" 2>&1 &
    capture_pid "$!"
    wait_for "$OC_SESSION" || fail "item1-opencode" "$OC_SESSION did not come up live"
  fi

  mkdir -p "$CL_WORK_DIR"
  if need claude; then
    # `claude -p` is ONE turn: the SessionStart hook (.claude/hooks/a2a-session.mjs,
    # sidecar name = AOS_A2A_NAME) registers the sidecar only while the turn
    # runs, so the turn is kept BUSY while item 2 sends its probe; inbound A2A
    # is delivered at the UserPromptSubmit drain or the Stop hook
    # (.claude/hooks/a2a-inbox.mjs, exit 2 on first Stop), which forces the
    # reply via `aos-a2a reply`. cwd = ROOT so the repo hooks and permissions load.
    start_busy_claude_turn "$TMP_DIR/claude-turn-1.log" || true
    if wait_for "$CL_SESSION"; then
      pass "item1-claude-registered"
    else
      fail "item1-claude" "$CL_SESSION did not come up live (turn log tail: $(trunc "$(tail -c 200 "$TMP_DIR/claude-turn-1.log")"))"
    fi
  else
    (node "$A2A_BIN" serve --name "$CL_SESSION" --harness claude --mode echo --parent-pid "$$") \
      >"$TMP_DIR/cl-sidecar.log" 2>&1 &
    capture_pid "$!"
    wait_for "$CL_SESSION" || fail "item1-claude" "$CL_SESSION did not come up live"
  fi
}

# ---- check item 2: OpenCode -> Claude ----------------------------------------------

check_item2() {
  send_probe "item2-opencode-to-claude" "$OC_SESSION" "$CL_SESSION"
}

# ---- check item 3: Claude -> OpenCode, the Claude turn runs the send itself -------

claude_send_turn() { # claude_send_turn <check-name> <target> <marker>
  local name="$1" target="$2" marker="$3" log prompt
  gen_probe
  log="$TMP_DIR/$name.log"
  prompt="Run this exact Bash command unchanged, then print its full JSON output followed by the line $marker: aos-a2a send --to $target \"$PROBE_TEXT\""
  run_claude "$prompt" "$log" "--allowedTools" "Bash(aos-a2a send:*)"
  TURN_TIMEOUT_CURRENT="$CL_TURN_TIMEOUT"
  wait_logged_send "$name" "$(tail -n 1 "$PIDS")" "$log" "$PROBE_OK"
  TURN_TIMEOUT_CURRENT=""
}

check_item3() {
  claude_send_turn "item3-claude-to-opencode" "$OC_SESSION" "ZC-CL-3-OK"
  # The artifact side of item 3: the reply to the OpenCode sidecar.
  send_probe "item3-opencode-artifact" "$OC_SESSION" "$OC_SESSION"
}

# ---- check item 4: never-GO, before and after an A2A "GO <session>" message -------
# go-check WITHOUT --consume; exit code and output captured separately; assert
# exit 1 and ok:false both times. An A2A message must never count as a GO.

go_check_run() { # go_check_run <name> -> asserts exit 1 and ok:false
  local name="$1" out rc
  out="$(node "$GO_CHECK_BIN" --session "$CL_SESSION" --command "git push" </dev/null 2>&1)"
  rc=$?
  if [ "$rc" != 1 ] || ! printf '%s' "$out" | grep -Eq '"ok": ?false'; then
    fail "$name" "expected exit 1 and ok:false, got exit $rc, output: $(trunc "$out")"
  else
    pass "$name"
  fi
}

check_item4() {
  go_check_run "item4-never-go-before"
  node "$A2A_BIN" send --to "$CL_SESSION" --from "$OC_SESSION" --timeout "$TIMEOUT" \
    "GO $CL_SESSION" >/dev/null 2>&1
  go_check_run "item4-never-go-after"
}

# ---- #live-ring: every ordered pair at least once ---------------------------------

ring_claude_turn() { # claude-source sends (claude->agy, claude->codex)
  gen_probe
  local probe_agy_text="$PROBE_TEXT" probe_agy_ok="$PROBE_OK"
  gen_probe
  local probe_codex_text="$PROBE_TEXT" probe_codex_ok="$PROBE_OK"
  # Each leg's own send timeout matches its sidecar's harness timeout, so the
  # slow agy/codex turns are not cut off after the (shorter) $TIMEOUT.
  local prompt="Run each of the following Bash commands in order. After each one print its full JSON output followed by the marker in parentheses:
1) aos-a2a send --to $AGY_SESSION \"$probe_agy_text\" --timeout $AGY_TIMEOUT (marker ZC-CL-AGY-OK)
2) aos-a2a send --to $CODEX_SESSION \"$probe_codex_text\" --timeout $CODEX_TIMEOUT (marker ZC-CL-CODEX-OK)
Print all output blocks and then the line ZC-RING-CLAUDE-DONE."
  local log="$TMP_DIR/ring-claude.log"
  run_claude "$prompt" "$log" "--allowedTools" "Bash(aos-a2a send:*)"
  # Run-10 evidence: this turn waits for BOTH slow legs while AGY and CODEX are
  # enabled, so CL_TURN_TIMEOUT alone can run out even when both sends would
  # still complete. Deadline: max(CL_TURN_TIMEOUT, AGY_TIMEOUT + CODEX_TIMEOUT).
  local ring_deadline="$CL_TURN_TIMEOUT"
  if [ "$(( AGY_TIMEOUT + CODEX_TIMEOUT ))" -gt "$ring_deadline" ]; then
    ring_deadline=$(( AGY_TIMEOUT + CODEX_TIMEOUT ))
  fi
  TURN_TIMEOUT_CURRENT="$ring_deadline"
  wait_logged "ring-claude-send" "$(tail -n 1 "$PIDS")" "$log" "ZC-RING-CLAUDE-DONE" "ZC-CL-AGY-OK" "ZC-CL-CODEX-OK"
  TURN_TIMEOUT_CURRENT=""
}

ring_checks() {
  # E8: each claude-sourced leg reports its own reason when dropped because
  # claude is missing. ensure_claude_busy is hoisted to the top level (see
  # its definition above) so ring_agy_turn can call it too.
  if [ "$AGY_ENABLED" = 1 ] && [ "$CODEX_ENABLED" = 1 ] && [ "$CLAUDE_MISSING" = 0 ]; then
    ring_claude_turn
  else
    if [ "$AGY_ENABLED" = 1 ] && [ "$CLAUDE_MISSING" = 1 ]; then
      skip "ring-claude-send-agy" "claude binary not in PATH"
    else
      [ "$AGY_ENABLED" = 1 ] || skip "ring-claude-send-agy" "requires A2A_E2E_AGY=1"
    fi
    if [ "$CODEX_ENABLED" = 1 ] && [ "$CLAUDE_MISSING" = 1 ]; then
      skip "ring-claude-send-codex" "claude binary not in PATH"
    else
      [ "$CODEX_ENABLED" = 1 ] || skip "ring-claude-send-codex" "requires A2A_E2E_CODEX=1"
    fi
  fi
  ensure_claude_busy
  send_probe "ring-pair-opencode-claude" "$OC_SESSION" "$CL_SESSION"
  send_probe "ring-pair-claude-opencode" "$CL_SESSION" "$OC_SESSION"
  if [ "$AGY_ENABLED" = 1 ]; then
    if [ -n "$(reg_line_for "$AGY_SESSION")" ]; then
      send_probe "ring-pair-agy-opencode" "$AGY_SESSION" "$OC_SESSION"
      ensure_claude_busy
      send_probe "ring-pair-agy-claude" "$AGY_SESSION" "$CL_SESSION"
      send_probe "ring-pair-opencode-agy" "$OC_SESSION" "$AGY_SESSION"
    else
      skip "ring-pair-agy-opencode" "$AGY_SESSION not registered (agy sidecar did not come up; see sidecar-agy-bringup)"
      skip "ring-pair-agy-claude" "$AGY_SESSION not registered (agy sidecar did not come up; see sidecar-agy-bringup)"
      skip "ring-pair-opencode-agy" "$AGY_SESSION not registered (agy sidecar did not come up; see sidecar-agy-bringup)"
    fi
  else
    skip "ring-pair-agy-opencode" "requires A2A_E2E_AGY=1"
    skip "ring-pair-agy-claude" "requires A2A_E2E_AGY=1"
    skip "ring-pair-opencode-agy" "requires A2A_E2E_AGY=1"
  fi
  if [ "$CODEX_ENABLED" = 1 ]; then
    if [ -n "$(reg_line_for "$CODEX_SESSION")" ]; then
      ensure_claude_busy
      send_probe "ring-pair-codex-claude" "$CODEX_SESSION" "$CL_SESSION"
      send_probe "ring-pair-claude-codex" "$CL_SESSION" "$CODEX_SESSION"
    else
      skip "ring-pair-codex-claude" "$CODEX_SESSION not registered (codex sidecar did not come up; needs A2A_E2E_CODEX_THREAD)"
      skip "ring-pair-claude-codex" "$CODEX_SESSION not registered (codex sidecar did not come up; needs A2A_E2E_CODEX_THREAD)"
    fi
  else
    skip "ring-pair-codex-claude" "requires A2A_E2E_CODEX=1"
    skip "ring-pair-claude-codex" "requires A2A_E2E_CODEX=1"
  fi
}

# ---- #agy-orch-check: agy orchestrator turn ----------------------------------------

ring_agy_turn() {
  if [ "$AGY_ENABLED" != 1 ]; then
    skip "agy-orch-check" "requires A2A_E2E_AGY=1"
    return 0
  fi
  if ! need agy; then
    skip "agy-orch-check" "agy binary not in PATH"
    return 0
  fi
  local idx_prompt
  gen_probe
  local probe_oc_text="$PROBE_TEXT" probe_oc_ok="$PROBE_OK"
  gen_probe
  local probe_cl_text="$PROBE_TEXT" probe_cl_ok="$PROBE_OK"
  # E5: worker flags depend on YOLO; proxy env goes ONLY to the worker launch.
  local worker_flags="--go-wait 600 --timeout 120"
  if [ "${A2A_E2E_AGY_YOLO:-}" = 1 ]; then
    worker_flags="--allow-default allow --go-wait 600 --timeout 120"
  fi
  local worker_proxy_env=""
  if [ -n "${A2A_E2E_PROXY:-}" ]; then
    worker_proxy_env="HTTPS_PROXY=$A2A_E2E_PROXY HTTP_PROXY=$A2A_E2E_PROXY ALL_PROXY=$A2A_E2E_PROXY "
  fi
  mkdir -p "$AGY_WORK_DIR/agy-worker"
  # The prompt-level sends target the OpenCode and Claude sessions; before the
  # turn starts, make sure the e2e-claude sidecar is up and answering so the
  # claude leg is not delivered into an ended turn (run-10 evidence).
  ensure_claude_busy || true
  idx_prompt="Do these three shell steps in order. After each step print its output followed by the marker in parentheses:
1) aos-a2a send --to $OC_SESSION \"agy orchestrator probe.\" --timeout $TIMEOUT (marker ZC-AGY-OC-OK)
2) aos-a2a send --to $CL_SESSION \"agy orchestrator probe.\" --timeout $TIMEOUT (marker ZC-AGY-CL-OK)
3) env ${worker_proxy_env}NO_PROXY=127.0.0.1,localhost,::1 aos-acp opencode --name e2e-agy-worker --cwd $AGY_WORK_DIR/agy-worker --prompt \"Reply with the number 3 only.\" $worker_flags$( [ -n "${A2A_E2E_MODEL:-}" ] && printf ' --model %s' "$A2A_E2E_MODEL" ) (marker ZC-AGY-WORKER-OK)
Print all three outputs and then the line ZC-AGY-ORCH-DONE."
  local log="$TMP_DIR/agy-orch.log" pid
  local agy_args=(--print "$idx_prompt")
  # Verified agy CLI: `agy -p/--print "<prompt>"` runs ONE non-interactive
  # turn and prints the answer (prompts are read only from -p/--print or
  # stdin; a bare positional prompt would be ignored — run-10 evidence).
  # --dangerously-skip-permissions is passed ONLY when A2A_E2E_AGY_YOLO=1.
  if [ "${A2A_E2E_AGY_YOLO:-}" = 1 ]; then
    agy_args+=(--dangerously-skip-permissions)
  fi
  # cwd = $AGY_WORK_DIR: the shell commands inside the turn (aos-a2a send,
  # aos-acp) resolve through the existing PATH shim prepared in main().
  ( cd "$AGY_WORK_DIR" && exec env AOS_A2A_NAME="$AGY_SESSION" agy "${agy_args[@]}" ) >"$log" 2>&1 &
  pid=$!
  capture_pid "$pid"
  # Deadline: A2A_E2E_AGY_TIMEOUT (default 300) — one headless agy turn takes
  # >120 s on this machine, so the plain $TIMEOUT is not enough (run-10).
  TURN_TIMEOUT_CURRENT="$AGY_TIMEOUT"
  wait_logged "agy-orch-check" "$pid" "$log" "ZC-AGY-ORCH-DONE" "ZC-AGY-OC-OK" "ZC-AGY-CL-OK" "ZC-AGY-WORKER-OK"
  TURN_TIMEOUT_CURRENT=""
  # The two orchestrator send legs are asserted here against the nonce probes.
  send_probe "agy-orch-send-opencode" "$AGY_SESSION" "$OC_SESSION"
  send_probe "agy-orch-send-claude" "$AGY_SESSION" "$CL_SESSION"
}

# ---- cleanup: kill candidates only, registry and config assertions -----------------

cleanup() {
  if [ "$DRY_RUN" = 1 ]; then exit 0; fi # no side effects on the dry-run path
  local pid
  if [ -f "$PIDS" ]; then
    while IFS= read -r pid; do
      [ -n "$pid" ] || continue
      kill "$pid" 2>/dev/null
    done <"$PIDS"
  fi
  assert_registry_empty
  assert_opencode_config
  summary_line
  say "temporary files left in place: $TMP_DIR (never deleted by this script)"
  exit "$RUN_RC"
}

assert_registry_empty() {
  # The OpenCode sidecar is a detached child that exits via --parent-pid
  # polling within ~5-10 s after `opencode serve` was killed; poll up to 20 s
  # (sleep 1) before reporting FAIL (run-8 evidence).
  local entries t0
  t0=$(date +%s)
  entries="$(node "$A2A_BIN" list --prune 2>/dev/null | grep -v '^[[:space:]]*$' || true)"
  while [ -n "$entries" ] && [ "$(( $(date +%s) - t0 ))" -lt 20 ]; do
    sleep 1
    entries="$(node "$A2A_BIN" list --prune 2>/dev/null | grep -v '^[[:space:]]*$' || true)"
  done
  if [ -n "$entries" ]; then
    fail "cleanup-registry-empty" "registry still holds sessions after cleanup: $(trunc "$entries")"
  else
    pass "cleanup-registry-empty"
  fi
}

opencode_shasum() { # read-only whole-config shasum over ~/.config/opencode
  # E9: -print0/xargs -0 survives filenames with spaces; the shasum of the
  # null-separated file list is hashed so the sort order is still stable.
  (cd "$HOME/.config/opencode" 2>/dev/null &&
    find . -type f -print0 2>/dev/null | LC_ALL=C sort -z | xargs -0 shasum 2>/dev/null | shasum) |
    awk '{print $1}'
}

snapshot_opencode_config() {
  if [ -d "$HOME/.config/opencode" ]; then opencode_shasum >"$TMP_DIR/opencode-shasum"; fi
}

assert_opencode_config() {
  local cfgdir="$HOME/.config/opencode" now_sum saved_sum
  if [ ! -d "$cfgdir" ]; then
    skip "cleanup-opencode-config" "$cfgdir does not exist; checksum check skipped"
    return 0
  fi
  now_sum="$(opencode_shasum)"
  saved_sum="$(cat "$TMP_DIR/opencode-shasum" 2>/dev/null || printf 'missing')"
  if [ "$now_sum" = "$saved_sum" ]; then
    pass "cleanup-opencode-config"
  else
    # E9: advisory only — opencode may legitimately rewrite its config while
    # running, so a drift is a WARN, not a FAIL.
    skip "cleanup-opencode-config" "WARN: $cfgdir contents changed during the run (opencode may rewrite its config while running)"
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 130' TERM

# ---- dry-run plan (before ANY side effect: no mktemp, no mkdir, no traps here) -----

dry_run_plan() {
  local ROOT_PLACEHOLDER="<ROOT>"
  echo "dry-run plan (nothing will be started, sent or created):"
  echo "  1. prereqs: locate node, opencode, claude, agy (only with A2A_E2E_AGY=1), codex (only with A2A_E2E_CODEX=1), node bin/aos-a2a.mjs and bin/go-check.mjs; resolve ROOT from this script's location (three levels up)."
  echo "  2. setup: one 'mktemp -d' TMP_DIR holding the isolated A2A registry (AOS_SESSIONS_DIR), bus inbox (AOS_BUS_ROOT, AOS_A2A_INBOX) and scratch projects; unset proxy env and export NO_PROXY=127.0.0.1,localhost,::1; proxy (${A2A_E2E_PROXY:+A2A_E2E_PROXY only} in OpenCode launches, never elsewhere)."
  echo "  3. snapshot the ~/.config/opencode shasum read-only (read-only; SKIP the end-of-run check if that dir is absent)."
  echo "  4. item 1: in the scratch project <TMP>/oc-project (holding .opencode/plugins/bdb-aos.js, which re-exports <ROOT>/.opencode/plugins/bdb-aos.js) start:"
  echo "       env AOS_A2A_NAME=$OC_SESSION AOS_SESSIONS_DIR=<TMP>/sessions AOS_BUS_ROOT=<TMP>/bus AOS_A2A_INBOX=<TMP>/inbox${A2A_E2E_PROXY:+ HTTP_PROXY=$A2A_E2E_PROXY HTTPS_PROXY=$A2A_E2E_PROXY} NO_PROXY=127.0.0.1,localhost,::1 no_proxy=127.0.0.1,localhost,::1 opencode serve --port 0 --hostname 127.0.0.1   # cwd: <TMP>/oc-project"
  echo "     parse http://127.0.0.1:<port> from the serve log, then create the session over the HTTP API (https://opencode.ai/docs/server):"
  echo "       curl -sf --noproxy '*' -X POST http://127.0.0.1:<port>/session -H 'content-type: application/json' -d '{\"title\":\"$OC_SESSION\"}'"
  echo "     then wait until $OC_SESSION appears in 'aos-a2a list'; on failure FAIL with the last 20 serve-log lines."
  echo "  5. item 1: the busy claude turn, so its SessionStart-hook sidecar (AOS_A2A_NAME=$CL_SESSION) stays registered while item 2 sends:"
  echo "       cd $ROOT_PLACEHOLDER && env AOS_A2A_NAME=$CL_SESSION CLAUDE_PROJECT_DIR=$ROOT_PLACEHOLDER claude -p 'Keep this turn busy: first run sleep 45 via the Bash tool, then say done. If sleep is not permitted, instead write a 1000-word essay on bash quoting, then say done.' --output-format text${A2A_E2E_MODEL:+ --model $A2A_E2E_MODEL}"
  echo "     then wait until $CL_SESSION appears in 'aos-a2a list'."
  echo "  6. item 2: 'aos-a2a send --from $OC_SESSION --to $CL_SESSION \"What is 2+3?...\"' --timeout $TIMEOUT; assert COMPLETED with artifact containing 5."
  echo "  7. item 3: a claude turn is prompted to run the Bash call 'aos-a2a send --to $OC_SESSION \"What is 3+4?...\"'; assert the log contains TASK_STATE_COMPLETED and the expected probe answer text (e.g. N1Z-OK); the trailing marker line is advisory only; if the send call never ran, report as a hook/permission-settings failure, not a timeout. Exact claude turn launch:"
  echo "       cd $ROOT_PLACEHOLDER && env AOS_A2A_NAME=$CL_SESSION CLAUDE_PROJECT_DIR=$ROOT_PLACEHOLDER claude -p '<nonce probe text> ... aos-a2a send --to $OC_SESSION \"<probe>\"' --output-format text --allowedTools 'Bash(aos-a2a send:*)'"
  echo "  8. item 4: 'node bin/go-check.mjs --session $CL_SESSION --command \"git push\"' WITHOUT --consume; capture exit code and output separately; assert exit 1 and ok:false; then send the A2A message 'GO $CL_SESSION' to that session and assert exit 1 and ok:false again."
  echo "  9. #live-ring (agy legs need A2A_E2E_AGY=1, codex legs A2A_E2E_CODEX=1; A2A_E2E_AGY_TIMEOUT and A2A_E2E_CODEX_TIMEOUT default to 300 s): a claude turn sends claude->agy (What is 4+4?, --timeout ${AGY_TIMEOUT}s) and claude->codex (What is 5+5?, --timeout ${CODEX_TIMEOUT}s); turn deadline = max(CL_TURN_TIMEOUT, A2A_E2E_AGY_TIMEOUT + A2A_E2E_CODEX_TIMEOUT = $(( AGY_TIMEOUT + CODEX_TIMEOUT ))s); before every ring send that targets e2e-claude, ensure_claude_busy runs (fresh busy turn if not registered, then a registry-agent-card curl with no proxy; one restart if it does not answer); aos-a2a sends for opencode->claude (5), claude->opencode (7), and when agy/codex enabled: agy<->opencode (6/6, timeout ${AGY_TIMEOUT}s toward agy), agy->claude (7+7=14), codex->claude (9), claude->codex (10, --timeout ${CODEX_TIMEOUT}s; its failure message notes: codex session must be open and resumed, not only listed in the resume picker; thread=\$A2A_E2E_CODEX_THREAD); every ordered pair at least once."
  echo " 10. #agy-orch-check (A2A_E2E_AGY=1 and agy present, else SKIP; ${A2A_E2E_AGY_YOLO:+--dangerously-skip-permissions [A2A_E2E_AGY_YOLO=1]}${A2A_E2E_AGY_YOLO:-no skip-permissions flag}): one agy turn, invoked as 'agy --print \"<prompt>\"' with cwd=<TMP>/agy-worker (prompts are read only from -p/--print or stdin; a bare positional prompt is ignored), turn deadline A2A_E2E_AGY_TIMEOUT=${AGY_TIMEOUT}s: one agy turn sends to the OpenCode session and the Claude session (third send preceded in setup by ensure_claude_busy), then starts one OpenCode worker via 'aos-acp opencode --name e2e-agy-worker --cwd <tmp>/agy-worker --prompt \"Reply with the number 3 only.\" --allow-default allow --go-wait 600 --timeout 1800'."
  echo " 11. cleanup: trap on EXIT/INT/TERM kills ONLY the PIDs this script captured (never pkill/killall); poll 'aos-a2a list --prune' up to 20 s (sleep 1) until empty before asserting (the opencode sidecar exits via --parent-pid polling within ~5-10 s); compare a shasum over the sorted file list of ~/.config/opencode against the snapshot taken at start (read-only; SKIP if that dir does not exist). No rm anywhere; temp files are left in place and their path is printed."
  echo " 12. print PASS/FAIL/SKIP line per check and a summary with counts; exit non-zero if any FAIL."
  echo " 13. ring-leg sidecars, started BEFORE item 1:"
  echo "     with A2A_E2E_AGY=1, the agy sidecar (PASS/FAIL 'sidecar-agy-bringup'): ( cd ${A2A_E2E_AGY_DIR:+$A2A_E2E_AGY_DIR}${A2A_E2E_AGY_DIR:-<TMP>/agy-worker [set A2A_E2E_AGY_DIR to a dir with an existing agy conversation; agy --continue resumes the most recent conversation of the project dir]} && exec env AOS_A2A_NAME=$AGY_SESSION node $ROOT_PLACEHOLDER/bin/aos-a2a.mjs serve --name $AGY_SESSION --harness agy --mode agy --parent-pid \$\$ ) & ; wait via 'aos-a2a list' (wait_for), FAIL with the log tail if never registered."
  echo "     with A2A_E2E_CODEX=1 AND ${A2A_E2E_CODEX_THREAD:+A2A_E2E_CODEX_THREAD=$A2A_E2E_CODEX_THREAD}${A2A_E2E_CODEX_THREAD:-the A2A_E2E_CODEX_THREAD variable set to an already open Codex session UUID/name (never created by this script)}, the codex sidecar (PASS/FAIL 'sidecar-codex-bringup'): ( cd $ROOT_PLACEHOLDER && exec env AOS_A2A_NAME=$CODEX_SESSION node $ROOT_PLACEHOLDER/bin/aos-a2a.mjs serve --name $CODEX_SESSION --harness codex --mode codex --thread <A2A_E2E_CODEX_THREAD> --parent-pid \$\$ ) & ; same wait_for; without the thread variable the codex legs SKIP naming it."
  exit 0
}

main() {
  # prerequisite checks (item 0): repo bins and node must exist before anything runs
  if ! need node; then
    fail "prereq-node" "node not in PATH"
    exit 1
  fi
  if [ ! -f "$A2A_BIN" ] || [ ! -f "$GO_CHECK_BIN" ]; then
    fail "prereq-repo" "missing $A2A_BIN or $GO_CHECK_BIN"
    exit 1
  fi
  if [ "${A2A_E2E_AGY:-0}" = 1 ] && ! need agy; then
    say "note: A2A_E2E_AGY=1 but agy not in PATH; agy legs will SKIP"
  fi
  if [ "${A2A_E2E_CODEX:-0}" = 1 ] && ! need codex; then
    say "note: A2A_E2E_CODEX=1 but codex not in PATH; codex legs will SKIP"
  fi
  # E6: make `aos-a2a` resolvable inside harness sessions: a temp shim dir
  # prepended to PATH, holding an `aos-a2a` that execs the repo CLI.
  mkdir -p "$TMP_DIR/shim"
  printf '#!/usr/bin/env sh\nexec node "%s" "$@"\n' "$A2A_BIN" >"$TMP_DIR/shim/aos-a2a"
  chmod +x "$TMP_DIR/shim/aos-a2a"
  PATH="$TMP_DIR/shim:$PATH"
  export PATH
  # scratch dirs under $TMP_DIR so no worktree state is touched.
  mkdir -p "$AOS_SESSIONS_DIR" "$AOS_BUS_ROOT" "$AOS_A2A_INBOX" \
    "$OC_WORK_DIR" "$CL_WORK_DIR" "$AGY_WORK_DIR/agy-worker"
  # Scratch project plugin shim: `opencode serve` runs with cwd =
  # $OC_WORK_DIR, so project-local plugins are discovered there
  # (https://opencode.ai/docs/plugins). The shim re-exports the repo plugin by
  # absolute path instead of copying directories (the repo plugin's relative
  # imports resolve from its own import.meta.url inside the repo).
  mkdir -p "$OC_WORK_DIR/.opencode/plugins"
  {
    printf "import BdbAos from '%s';\n" "$ROOT/.opencode/plugins/bdb-aos.js"
    printf 'export default BdbAos;\n'
  } >"$OC_WORK_DIR/.opencode/plugins/bdb-aos.js"
  : >"$PIDS"
  snapshot_opencode_config

  say "live-e2e: ROOT=$ROOT TMP_DIR=$TMP_DIR TIMEOUT=${TIMEOUT}s AGY=$AGY_ENABLED CODEX=$CODEX_ENABLED"

  # sidecar bring-up for the agy / codex ring legs, BEFORE the ring runs
  # (independent of whether the real agy/codex binaries are in PATH: --mode gy
  # --mode agy spawns agy itself, --mode codex talks to the open Codex session
  # given via A2A_E2E_CODEX_THREAD through codex queue/exec resume).
  if [ "$AGY_ENABLED" = 1 ]; then
    say "starting agy sidecar (--mode agy)"
    start_agy_sidecar || true
  fi
  if [ "$CODEX_ENABLED" = 1 ]; then
    if [ -n "${A2A_E2E_CODEX_THREAD:-}" ]; then
      say "starting codex sidecar (--mode codex --thread $A2A_E2E_CODEX_THREAD)"
      start_codex_sidecar || true
    else
      skip "sidecar-codex-bringup" "A2A_E2E_CODEX=1 but A2A_E2E_CODEX_THREAD is not set (codex legs need an already open Codex session UUID/exact name; never created by this script)"
    fi
  fi

  say "checking item 1 sessions live"
  check_item1
  say "checking item 2 opencode->claude"
  check_item2
  say "checking item 3 claude->opencode"
  check_item3
  say "checking item 4 never-GO"
  check_item4
  say "checking #live-ring"
  ring_checks
  say "checking #agy-orch-check"
  ring_agy_turn
  return 0
}

if [ "$DRY_RUN" = 1 ]; then
  dry_run_plan
else
  main
fi
