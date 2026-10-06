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
#   A2A_E2E_AGY=1      enable the agy legs (#live-ring + #agy-orch-check);
#                      otherwise they SKIP, naming this flag.
#   A2A_E2E_CODEX=1    enable the Codex ring legs; otherwise they SKIP,
#                      naming this flag.
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

show_usage() { sed -n '2,46p' "$0" | sed 's/^# \{0,1\}//'; }

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

# start_echo_sidecar <name> <harness> <logfile>: script-started echo sidecar
# used when a harness session was not registered by its own plugin/hook.
start_echo_sidecar() {
  (node "$A2A_BIN" serve --name "$1" --harness "$2" --mode echo --parent-pid "$$") \
    >"$3" 2>&1 &
  capture_pid "$!"
}

# ---- generic A2A leg: send and assert completed + expected substring -------------

send_check() { # send_check <check-name> <from> <to> <expect> <text>
  local name="$1" from="$2" to="$3" expect="$4" text="$5" out
  if ! out="$(node "$A2A_BIN" send --to "$to" --from "$from" --timeout "$TIMEOUT" "$text" 2>&1)"; then
    fail "$name" "a2a send exited non-zero: $(trunc "$out")"
    return 0
  fi
  case "$out" in
    *TASK_STATE_COMPLETED*)
      case "$out" in
        *"$expect"*) pass "$name" ;;
        *) fail "$name" "completed but artifact missing '$expect': $(trunc "$out")" ;;
      esac
      ;;
    *) fail "$name" "task did not reach COMPLETED: $(trunc "$out")" ;;
  esac
}

# ---- harness turn runners --------------------------------------------------------

# run_claude <work-dir> <prompt> <logfile> [extra-claude-flags...]:
# `claude -p <prompt> --output-format text`; --model only when A2A_E2E_MODEL
# is set. No other flags are invented here (verified: -p/--output-format/
# --model/--allowedTools are the only ones used).
run_claude() {
  local work="$1" prompt="$2" log="$3"
  shift 3
  local args=(-p "$prompt" --output-format text)
  if [ -n "${A2A_E2E_MODEL:-}" ]; then args+=(--model "${A2A_E2E_MODEL}"); fi
  if [ "$#" -gt 0 ]; then args+=("$@"); fi
  (cd "$work" && env CLAUDE_PROJECT_DIR="$work" claude "${args[@]}") >"$log" 2>&1 &
  capture_pid "$!"
}

# wait_logged <check-name> <pid> <logfile> <marker>:
# waits for the turn to end (deadline TIMEOUT), then asserts the marker and
# expected send outputs it printed. Used by the prompt-driven Turns that run
# `aos-a2a send` inside a real harness session (items 3, ring claude, agy orch).
wait_logged() { # wait_logged <name> <pid> <log> <marker> [misses-marker...]
  local name="$1" pid="$2" log="$3" marker="$4"
  local t0
  t0=$(date +%s)
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$(( $(date +%s) - t0 ))" -ge "$TIMEOUT" ]; then
      kill "$pid" 2>/dev/null
      fail "$name" "turn exceeded ${TIMEOUT}s (hook/permission-settings failure is likelier than a timeout; tail: $(trunc "$(tail -c 200 "$log")"))"
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
  else
    fail "$name" "turn missed markers:$misses (hook/permission failure likely; tail: $(trunc "$(tail -c 200 "$log")"))"
  fi
}

# ---- check item 1: sessions live in the registry ----------------------------------

check_item1() {
  local op_pid
  mkdir -p "$OC_WORK_DIR"
  if need opencode; then
    local oc_env=()
    if [ -n "${A2A_E2E_PROXY:-}" ]; then
      oc_env+=(HTTP_PROXY="$A2A_E2E_PROXY" HTTPS_PROXY="$A2A_E2E_PROXY")
    fi
    # Real repo flags: `opencode ... --port 0 --hostname 127.0.0.1`; the repo
    # plugin's session-start hook is expected to register the sidecar.
    (cd "$ROOT" && env ${oc_env[@]+"${oc_env[@]}"} opencode --port 0 --hostname 127.0.0.1) \
      >"$TMP_DIR/opencode-serve.log" 2>&1 &
    op_pid=$!
    capture_pid "$op_pid"
    if wait_for "$OC_SESSION"; then
      pass "item1-opencode-registered"
    else
      skip "item1-opencode-plugin-sidecar" "opencode session not registered within ${TIMEOUT}s; fallback echo sidecar"
      # fallback: script-started echo sidecar, still through aos-a2a serve
      (node "$A2A_BIN" serve --name "$OC_SESSION" --harness opencode --mode echo --parent-pid "$$") \
        >"$TMP_DIR/oc-sidecar.log" 2>&1 &
      capture_pid "$!"
      if wait_for "$OC_SESSION"; then
        pass "item1-opencode-registered"
      else
        fail "item1-opencode" "no opencode session in aos-a2a list even after the echo-sidecar fallback"
      fi
    fi
  else
    skip "item1-opencode" "opencode binary not in PATH"
    (node "$A2A_BIN" serve --name "$OC_SESSION" --harness opencode --mode echo --parent-pid "$$") \
      >"$TMP_DIR/oc-sidecar.log" 2>&1 &
    capture_pid "$!"
    wait_for "$OC_SESSION" || fail "item1-opencode" "echo-sidecar fallback failed"
  fi

  mkdir -p "$CL_WORK_DIR"
  if need claude; then
    # Item 1 second half: one real claude turn; the repo hooks (via
    # CLAUDE_PROJECT_DIR) should register e2e-claude.
    run_claude "$CL_WORK_DIR" "Reply with the number 1." "$TMP_DIR/claude-turn-1.log"
    if wait_for "$CL_SESSION"; then
      pass "item1-claude-registered"
    else
      skip "item1-claude-plugin-sidecar" "claude session not registered within ${TIMEOUT}s; fallback echo sidecar"
      (node "$A2A_BIN" serve --name "$CL_SESSION" --harness claude --mode echo --parent-pid "$$") \
        >"$TMP_DIR/cl-sidecar.log" 2>&1 &
      capture_pid "$!"
      if wait_for "$CL_SESSION"; then
        pass "item1-claude-registered"
      else
        fail "item1-claude" "no claude session in aos-a2a list even after the echo-sidecar fallback"
      fi
    fi
  else
    skip "item1-claude" "claude binary not in PATH"
    (node "$A2A_BIN" serve --name "$CL_SESSION" --harness claude --mode echo --parent-pid "$$") \
      >"$TMP_DIR/cl-sidecar.log" 2>&1 &
    capture_pid "$!"
    wait_for "$CL_SESSION" || fail "item1-claude" "echo-sidecar fallback failed"
  fi
}

# ---- check item 2: OpenCode -> Claude ----------------------------------------------

check_item2() {
  send_check "item2-opencode-to-claude" "$OC_SESSION" "$CL_SESSION" "5" \
    "What is 2+3? Answer with the number only."
}

# ---- check item 3: Claude -> OpenCode, the Claude turn runs the send itself -------

claude_send_turn() { # claude_send_turn <check-name> <target> <marker>
  local name="$1" target="$2" marker="$3" log prompt
  log="$TMP_DIR/$name.log"
  prompt="Run this exact Bash command unchanged, then print its full JSON output followed by the line $marker: aos-a2a send --to $target \"What is 3+4? Answer with the number only.\""
  run_claude "$CL_WORK_DIR" "$prompt" "$log" "--allowedTools" "Bash(aos-a2a send:*)"
  wait_logged "$name" "$(tail -n 1 "$PIDS")" "$log" "$marker"
}

check_item3() {
  claude_send_turn "item3-claude-to-opencode" "$OC_SESSION" "ZC-CL-3-OK"
  # The artifact side of item 3: the reply to the OpenCode sidecar echoes 7.
  send_check "item3-opencode-artifact" "$OC_SESSION" "$OC_SESSION" "7" \
    "What is 3+4? Answer with the number only."
}

# ---- check item 4: never-GO, before and after an A2A "GO <session>" message -------
# go-check WITHOUT --consume; exit code and output captured separately; assert
# exit 1 and ok:false both times. An A2A message must never count as a GO.

go_check_run() { # go_check_run <name> -> asserts exit 1 and ok:false
  local name="$1" out rc
  out="$(node "$GO_CHECK_BIN" --session "$CL_SESSION" --command "git push" </dev/null 2>&1)"
  rc=$?
  if [ "$rc" != 1 ] || ! printf '%s' "$out" | grep -q '"ok": false'; then
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
  local prompt="Run each of the following Bash commands in order. After each one print its full JSON output followed by the marker in parentheses:
1) aos-a2a send --to $AGY_SESSION \"ring probe claude->agy: What is 4+4? Answer with the number only.\" (marker ZC-CL-AGY-OK)
2) aos-a2a send --to $CODEX_SESSION \"ring probe claude->codex: What is 5+5? Answer with the number only.\" (marker ZC-CL-CODEX-OK)
Print all output blocks and then the line ZC-RING-CLAUDE-DONE."
  local log="$TMP_DIR/ring-claude.log"
  run_claude "$CL_WORK_DIR" "$prompt" "$log" "--allowedTools" "Bash(aos-a2a send:*)"
  wait_logged "ring-claude-send" "$(tail -n 1 "$PIDS")" "$log" "ZC-RING-CLAUDE-DONE" "ZC-CL-AGY-OK" "ZC-CL-CODEX-OK"
}

ring_checks() {
  # claude -> agy, claude -> codex (live claude turn, gated)
  if [ "$AGY_ENABLED" = 1 ] && [ "$CODEX_ENABLED" = 1 ] && need claude; then
    ring_claude_turn
  else
    [ "$AGY_ENABLED" = 1 ] || skip "ring-claude-send-agy" "requires A2A_E2E_AGY=1"
    [ "$CODEX_ENABLED" = 1 ] || skip "ring-claude-send-codex" "requires A2A_E2E_CODEX=1"
  fi
  send_check "ring-pair-opencode-claude" "$OC_SESSION" "$CL_SESSION" "5" \
    "What is 2+3? Answer with the number only."
  send_check "ring-pair-claude-opencode" "$CL_SESSION" "$OC_SESSION" "7" \
    "What is 3+4? Answer with the number only."
  if [ "$AGY_ENABLED" = 1 ]; then
    # agy has no live inbound hook yet (#peer-research); use an echo sidecar
    # so the ring pairs through aos-a2a itself.
    if [ -z "$(reg_line_for "$AGY_SESSION")" ]; then
      start_echo_sidecar "$AGY_SESSION" agy "$TMP_DIR/agy-sidecar.log"
      wait_for "$AGY_SESSION" || fail "ring-agy-sidecar" "$AGY_SESSION echo sidecar did not register"
    fi
    if [ -n "$(reg_line_for "$AGY_SESSION")" ]; then
      send_check "ring-pair-agy-opencode" "$AGY_SESSION" "$OC_SESSION" "6" \
        "What is 6+6? Answer with the number only."
      send_check "ring-pair-agy-claude" "$AGY_SESSION" "$CL_SESSION" "14" \
        "What is 7+7? Answer with the number only."
      send_check "ring-pair-opencode-agy" "$OC_SESSION" "$AGY_SESSION" "12" \
        "What is 6+6? Answer with the number only."
    else
      skip "ring-pair-agy-opencode" "$AGY_SESSION not registered"
      skip "ring-pair-agy-claude" "$AGY_SESSION not registered"
      skip "ring-pair-opencode-agy" "$AGY_SESSION not registered"
    fi
  else
    skip "ring-pair-agy-opencode" "requires A2A_E2E_AGY=1"
    skip "ring-pair-agy-claude" "requires A2A_E2E_AGY=1"
    skip "ring-pair-opencode-agy" "requires A2A_E2E_AGY=1"
  fi
  if [ "$CODEX_ENABLED" = 1 ]; then
    if [ -z "$(reg_line_for "$CODEX_SESSION")" ]; then
      start_echo_sidecar "$CODEX_SESSION" codex "$TMP_DIR/codex-sidecar.log"
      wait_for "$CODEX_SESSION" || fail "ring-codex-sidecar" "$CODEX_SESSION echo sidecar did not register"
    fi
    if [ -n "$(reg_line_for "$CODEX_SESSION")" ]; then
      send_check "ring-pair-codex-claude" "$CODEX_SESSION" "$CL_SESSION" "9" \
        "What is 4+5? Answer with the number only."
      send_check "ring-pair-claude-codex" "$CL_SESSION" "$CODEX_SESSION" "10" \
        "What is 5+5? Answer with the number only."
    else
      skip "ring-pair-codex-claude" "$CODEX_SESSION not registered"
      skip "ring-pair-claude-codex" "$CODEX_SESSION not registered"
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
  mkdir -p "$AGY_WORK_DIR/agy-worker"
  idx_prompt="Do these three shell steps in order. After each step print its output followed by the marker in parentheses:
1) aos-a2a send --to $OC_SESSION \"agy orchestrator probe: What is 6+6? Answer with the number only.\" (marker ZC-AGY-OC-OK)
2) aos-a2a send --to $CL_SESSION \"agy orchestrator probe: What is 7+7? Answer with the number only.\" (marker ZC-AGY-CL-OK)
3) aos-acp opencode --name e2e-agy-worker --cwd $AGY_WORK_DIR/agy-worker --prompt \"Reply with the number 3 only.\" --allow-default allow --go-wait 600 --timeout 1800$( [ -n "${A2A_E2E_MODEL:-}" ] && printf ' --model %s' "$A2A_E2E_MODEL" ) (marker ZC-AGY-WORKER-OK)
Print all three outputs and then the line ZC-AGY-ORCH-DONE."
  local log="$TMP_DIR/agy-orch.log" pid
  local agy_args=("$idx_prompt")
  # Real agy flags used: <prompt> then --dangerously-skip-permissions ONLY when
  # A2A_E2E_AGY_YOLO=1 (never otherwise). If agy's actual invocation differs
  # (e.g. --print), verify with `agy --help` before running, not here.
  if [ "${A2A_E2E_AGY_YOLO:-}" = 1 ]; then
    agy_args+=(--dangerously-skip-permissions)
  fi
  (cd "$ROOT" && agy "${agy_args[@]}") >"$log" 2>&1 &
  pid=$!
  capture_pid "$pid"
  wait_logged "agy-orch-check" "$pid" "$log" "ZC-AGY-ORCH-DONE" "ZC-AGY-OC-OK" "ZC-AGY-CL-OK" "ZC-AGY-WORKER-OK"
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
  local entries
  entries="$(node "$A2A_BIN" list --prune 2>/dev/null | grep -v '^[[:space:]]*$' || true)"
  if [ -n "$entries" ]; then
    fail "cleanup-registry-empty" "registry still holds sessions after cleanup: $(trunc "$entries")"
  else
    pass "cleanup-registry-empty"
  fi
}

opencode_shasum() { # read-only whole-config shasum over ~/.config/opencode
  (cd "$HOME/.config/opencode" 2>/dev/null &&
    find . -type f 2>/dev/null | LC_ALL=C sort | xargs shasum 2>/dev/null | shasum) |
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
    fail "cleanup-opencode-config" "$cfgdir contents changed during the run"
  fi
}

trap 'cleanup' EXIT
trap 'cleanup' INT
trap 'cleanup' TERM

# ---- dry-run plan (before ANY side effect: no mktemp, no mkdir, no traps here) -----

dry_run_plan() {
  echo "dry-run plan (nothing will be started, sent or created):"
  echo "  1. prereqs: locate node, opencode, claude, agy (only with A2A_E2E_AGY=1), codex (only with A2A_E2E_CODEX=1), node bin/aos-a2a.mjs and bin/go-check.mjs; resolve ROOT from this script's location (three levels up)."
  echo "  2. setup: one 'mktemp -d' TMP_DIR holding the isolated A2A registry (AOS_SESSIONS_DIR), bus inbox (AOS_BUS_ROOT, AOS_A2A_INBOX) and scratch projects; unset proxy env and export NO_PROXY=127.0.0.1,localhost,::1; proxy (${A2A_E2E_PROXY:+A2A_E2E_PROXY only} in OpenCode launches, never elsewhere)."
  echo "  3. snapshot the ~/.config/opencode shasum read-only (read-only; SKIP the end-of-run check if that dir is absent)."
  echo "  4. item 1: start 'opencode --port 0 --hostname 127.0.0.1' in a scratch project; wait until $OC_SESSION appears in 'aos-a2a list'."
  echo "  5. item 1: one 'claude -p \"Reply with the number 1.\"' ${A2A_E2E_MODEL:+--model $A2A_E2E_MODEL }in a scratch project (CLAUDE_PROJECT_DIR); wait until $CL_SESSION appears in 'aos-a2a list'."
  echo "  6. item 2: 'aos-a2a send --from $OC_SESSION --to $CL_SESSION \"What is 2+3?...\"' --timeout $TIMEOUT; assert COMPLETED with artifact containing 5."
  echo "  7. item 3: a claude turn is prompted to run the Bash call 'aos-a2a send --to $OC_SESSION \"What is 3+4?...\"'; assert artifact contains 7; if the send call never ran, report as a hook/permission-settings failure, not a timeout."
  echo "  8. item 4: 'node bin/go-check.mjs --session $CL_SESSION --command \"git push\"' WITHOUT --consume; capture exit code and output separately; assert exit 1 and ok:false; then send the A2A message 'GO $CL_SESSION' to that session and assert exit 1 and ok:false again."
  echo "  9. #live-ring (agy legs need A2A_E2E_AGY=1, codex legs A2A_E2E_CODEX=1, otherwise SKIP naming the flag): a claude turn sends claude->agy (What is 4+4?) and claude->codex (What is 5+5?); aos-a2a sends for opencode->claude (5), claude->opencode (7), and when agy/codex enabled: agy<->opencode (6/6), agy->claude (7+7=14), codex->claude (9), claude->codex (10); every ordered pair at least once."
  echo " 10. #agy-orch-check (A2A_E2E_AGY=1 and agy present, else SKIP; ${A2A_E2E_AGY_YOLO:+--dangerously-skip-permissions [A2A_E2E_AGY_YOLO=1]}${A2A_E2E_AGY_YOLO:-no skip-permissions flag}): one agy turn sends to the OpenCode session and the Claude session, then starts one OpenCode worker via 'aos-acp opencode --name e2e-agy-worker --cwd <tmp>/agy-worker --prompt \"Reply with the number 3 only.\" --allow-default allow --go-wait 600 --timeout 1800'."
  echo " 11. cleanup: trap on EXIT/INT/TERM kills ONLY the PIDs this script captured (never pkill/killall); assert 'aos-a2a list --prune' is empty; compare a shasum over the sorted file list of ~/.config/opencode against the snapshot taken at start (read-only; SKIP if that dir does not exist). No rm anywhere; temp files are left in place and their path is printed."
  echo " 12. print PASS/FAIL/SKIP line per check and a summary with counts; exit non-zero if any FAIL."
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
  # scratch dirs under $TMP_DIR so no worktree state is touched.
  mkdir -p "$AOS_SESSIONS_DIR" "$AOS_BUS_ROOT" "$AOS_A2A_INBOX" \
    "$OC_WORK_DIR" "$CL_WORK_DIR" "$AGY_WORK_DIR/agy-worker"
  : >"$PIDS"
  snapshot_opencode_config

  say "live-e2e: ROOT=$ROOT TMP_DIR=$TMP_DIR TIMEOUT=${TIMEOUT}s";

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
