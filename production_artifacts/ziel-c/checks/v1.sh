#!/usr/bin/env bash
# V1: one read-only agy research call; verifies answer, clean fixture, no mcsc, agy count returns to baseline.
FIX=${FIX:-/private/tmp/claude-501/-Users-timrennings/2f3aed09-052a-4360-86c5-4b1856c50064/scratchpad/ziel-c/fixture-agy}
SET=$HOME/.gemini/antigravity-cli/settings.json
fail=0; bad(){ echo "FAIL: $*"; fail=1; }
cnt(){ pgrep -f '(^|/)agy( |$)' | wc -l | tr -d ' '; }

[ "$(grep -c mcsc "$HOME/.gemini/config/mcp_config.json")" = 0 ] || { echo "ABORT: mcsc in agy mcp config"; exit 2; }
[ -z "$(git -C "$FIX" status --porcelain)" ] || { echo "ABORT: fixture not clean"; exit 2; }
mbase=$(pgrep -f mcsc | sort | tr '\n' ' ')
newm(){ comm -13 <(echo $mbase | tr ' ' '\n' | sort) <(pgrep -f mcsc | sort) | grep -v "^$$\$"; }
base=$(cnt); sum_before=$(shasum "$SET" | cut -d' ' -f1)
out=$(mktemp); err=$(mktemp)
cd "$FIX" || exit 2
agy --dangerously-skip-permissions --print-timeout 5m --print "Summarise README.md in two sentences. Read-only: do not create or modify any files." </dev/null >"$out" 2>"$err" &
pid=$!
max=$base; mcsc_seen=0; t0=$(date +%s)
while kill -0 $pid 2>/dev/null; do
  c=$(cnt); [ "$c" -gt "$max" ] && max=$c
  if [ -n "$(newm)" ]; then mcsc_seen=1; kill $pid; bad "new mcsc process: $(newm)"; break; fi
  if [ "$c" -gt $((base+5)) ]; then kill $pid; bad "agy count $c > baseline+5"; break; fi
  if [ $(( $(date +%s)-t0 )) -gt 330 ]; then kill $pid; bad "exceeded 330s"; break; fi
  sleep 2
done
wait $pid; rc=$?; dur=$(( $(date +%s)-t0 ))
for i in $(seq 1 15); do [ "$(cnt)" -le "$base" ] && break; sleep 2; done
after=$(cnt)
[ "$rc" = 0 ] || bad "agy exit $rc"
[ -s "$out" ] || bad "empty stdout"
[ -z "$(git -C "$FIX" status --porcelain)" ] || bad "fixture modified: $(git -C "$FIX" status --porcelain)"
[ "$after" -le "$base" ] || bad "agy count $after not back to baseline $base within 30s"
[ "$(shasum "$SET" | cut -d' ' -f1)" = "$sum_before" ] || bad "settings.json changed during run"
echo "baseline=$base max=$max after=$after rc=$rc duration=${dur}s mcsc_seen=$mcsc_seen"
echo "--- answer ---"; cat "$out"; echo "--- stderr ---"; cat "$err"
[ "$fail" = 0 ] && echo "V1 PASS" || echo "V1 FAIL"
exit $fail
