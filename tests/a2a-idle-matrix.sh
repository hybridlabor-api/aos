#!/bin/bash
# Opt-in live matrix for A2A delivery into IDLE sessions (not part of `npm test`).
# Needs one live, idle session per harness, each started with its own label (AOS_A2A_LABEL).
#
# Usage:
#   tests/a2a-idle-matrix.sh <claude-label> <agy-label> <opencode-label> <codex-label>
#   A2A_MATRIX_LABELS="c a o x" tests/a2a-idle-matrix.sh
#
# For every ordered pair (sender, receiver) with sender != receiver it runs
#   aos-a2a send --from <sender> --to <receiver> --timeout 60 "ping"
# and expects state TASK_STATE_COMPLETED and exit 0. Prints a pass/fail grid.
# Exit 0 only if every pair passed. Nobody has to type in the sessions.
set -u

AOS_A2A_BIN="${AOS_A2A_BIN:-aos-a2a}"
TIMEOUT_S="${A2A_MATRIX_TIMEOUT:-60}"

if [ "$#" -ge 4 ]; then
  LABELS=("$1" "$2" "$3" "$4")
elif [ -n "${A2A_MATRIX_LABELS:-}" ]; then
  # shellcheck disable=SC2206
  LABELS=($A2A_MATRIX_LABELS)
else
  echo "usage: $0 <claude-label> <agy-label> <opencode-label> <codex-label>" >&2
  exit 2
fi

if [ "${#LABELS[@]}" -ne 4 ]; then
  echo "need exactly 4 labels, got ${#LABELS[@]}" >&2
  exit 2
fi

OUT="$(mktemp "${TMPDIR:-/tmp}/a2a-idle-matrix.XXXXXX")" || exit 2
trap 'rm -f "$OUT"' EXIT

N=${#LABELS[@]}
FAILS=0
RESULTS=()

for ((i = 0; i < N; i++)); do
  for ((j = 0; j < N; j++)); do
    if [ "$i" -eq "$j" ]; then
      RESULTS+=("-")
      continue
    fi
    from="${LABELS[$i]}"
    to="${LABELS[$j]}"
    "$AOS_A2A_BIN" send --from "$from" --to "$to" --timeout "$TIMEOUT_S" "ping from $from" >"$OUT" 2>&1
    rc=$?
    if [ "$rc" -eq 0 ] && grep -q '"state": *"TASK_STATE_COMPLETED"' "$OUT"; then
      RESULTS+=("PASS")
    else
      RESULTS+=("FAIL")
      FAILS=$((FAILS + 1))
      echo "FAIL $from -> $to (exit $rc)" >&2
      sed 's/^/    /' "$OUT" >&2
    fi
  done
done

printf '\nsender \\ receiver'
for ((j = 0; j < N; j++)); do printf '\t%s' "${LABELS[$j]}"; done
printf '\n'
for ((i = 0; i < N; i++)); do
  printf '%s' "${LABELS[$i]}"
  for ((j = 0; j < N; j++)); do
    printf '\t%s' "${RESULTS[$((i * N + j))]}"
  done
  printf '\n'
done

if [ "$FAILS" -eq 0 ]; then
  echo "A2A idle matrix: all pairs COMPLETED within ${TIMEOUT_S}s"
  exit 0
fi
echo "A2A idle matrix: $FAILS pair(s) failed" >&2
exit 1
