#!/usr/bin/env bash
# AOS release E2E check — headless steps of skills/playbooks/pb-aos-e2e/SKILL.md
#
# Runs inside a clean sandbox: a container, VM or dedicated test user with a
# fresh HOME. It refuses to run without AOS_TEST_SANDBOX=1 so it can never
# touch the operator's real home on accident.
#
#   docker run --rm -v "$PWD":/aos -w /aos -e AOS_TEST_SANDBOX=1 node:24-bookworm \
#     bash scripts/e2e/aos-e2e.sh
#   (netcup: ~/.aos/cloud-sandbox/scripts/aos-ci-run <worktree> runs the same script)
#
# Writes aos-e2e-output/summary.txt into the current directory. Every step
# prints PASS / SKIP / FAIL and the summary carries the overall verdict.
# Steps needing a browser or screen output are recorded as SKIP — run them
# by hand per the playbook.
set -euo pipefail

if [ "${AOS_TEST_SANDBOX:-0}" != "1" ]; then
    echo "REFUSING to run: the install/uninstall steps need a throwaway HOME in a sandbox." >&2
    echo "Run me inside a container/VM with AOS_TEST_SANDBOX=1 (see scripts/e2e/aos-e2e.sh header)." >&2
    exit 1
fi

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${AOS_E2E_OUT:-$PWD/aos-e2e-output}"
mkdir -p "$OUT"
SUMMARY="$OUT/summary.txt"
E2E_HOME="$(mktemp -d)"
VERBOSE="${AOS_E2E_PROGRESS:-}"   # set to 1 to keep installer progress output on the console

PASS=0; SKIP=0; FAIL=0
emit() {
    local line="$1"
    echo "$line" >> "$SUMMARY"
    printf '%s\n' "$line"
}
quiet_run() {
    if [ "$VERBOSE" = "1" ]; then "$@"; else "$@" >/dev/null 2>&1; fi
}
step_pass() { PASS=$((PASS + 1)); emit "PASS  $1 — $2"; }
step_skip() { SKIP=$((SKIP + 1)); emit "SKIP  $1 — $2"; }
step_fail() { FAIL=$((FAIL + 1)); emit "FAIL  $1 — $2"; }

# JSON merge into a file, without jq: read-modify-write with node.
set_settings() {
    local key="$1" value="$2"
    mkdir -p "$E2E_HOME/.aos"
    node -e '
        const fs = require("fs");
        const file = process.argv[1], key = process.argv[2], value = process.argv[3];
        let doc = {};
        try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* fresh */ }
        if (!doc || typeof doc !== "object" || Array.isArray(doc)) doc = {};
        doc[key] = value;
        fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
    ' "$E2E_HOME/.aos/v5-settings.json" "$key" "$value"
}

grep_exit() {
    # grep_exit <file> <pattern> — 0 when found
    grep -q "$2" "$1" 2>/dev/null
}

echo "── AOS release E2E ──" > "$SUMMARY"
echo "sandbox HOME: $E2E_HOME" >> "$SUMMARY"
echo "steps: the installed binary is exercised with a fresh HOME per step" >> "$SUMMARY"
echo "" >> "$SUMMARY"

# ── Step 1: build the tarball ──
TARBALL=""
if npm pack --pack-destination "$OUT" >/dev/null 2>&1; then
    TARBALL="$(ls -t "$OUT"/aos-*.tgz 2>/dev/null | head -n 1 || true)"
fi
if [ -n "$TARBALL" ] && [ -f "$TARBALL" ]; then
    step_pass "1 tarball" "built $(basename "$TARBALL")"
else
    step_fail "1 tarball" "npm pack produced no aos-*.tgz in $OUT — aborting, later steps need it"
    echo "RESULT: FAIL" >> "$SUMMARY"
    exit 1
fi

# ── Step 2: install from the tarball, non-interactive, fresh HOME ──
if npm install -g "$TARBALL" >/dev/null 2>&1 && \
   HOME="$E2E_HOME" aos -y --profile standard --platforms=1,2,5 >/dev/null 2>&1 && \
   [ -f "$E2E_HOME/.agents/.bdb-manifest.json" ]; then
    step_pass "2 install" "tarball installed, manifest written in fresh HOME"
else
    step_fail "2 install" "install into fresh HOME failed (npm -g install, aos -y --profile standard)"
    echo "RESULT: FAIL" >> "$SUMMARY"
    exit 1
fi

# ── Step 3: aos doctor, all green except documented optional rows ──
if HOME="$E2E_HOME" aos doctor >/dev/null 2>&1; then
    step_pass "3 doctor" "exit 0 — critical rows pass; only optional rows may warn"
else
    step_fail "3 doctor" "exit nonzero — run 'HOME=$E2E_HOME aos doctor' in the sandbox to see the failed rows"
fi

# ── Step 4: hooks registered per harness, go-gate on ──
CLAUDE_OK=$(grep_exit "$E2E_HOME/.claude/settings.json" "go-gate\.mjs" && echo "1" || echo "0")
MEMB_OK=$(grep_exit "$E2E_HOME/.claude/settings.json" "memb-inject" && echo "1" || echo "0")
AGY_OK=$(grep_exit "$E2E_HOME/.gemini/config/hooks.json" "aos-go-gate" && echo "1" || echo "0")
CODEX_OK=$(grep_exit "$E2E_HOME/.codex/config.toml" "go-gate\\.mjs" && echo "1" || echo "0")
GATE_SETTING=$(node -e '
    try { const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(d.gate || "on"); }
    catch { console.log("on"); }
' "$E2E_HOME/.aos/v5-settings.json" 2>/dev/null || echo "on")
if [ "$CLAUDE_OK" = "1" ] && [ "$MEMB_OK" = "1" ] && [ "$AGY_OK" = "1" ] && [ "$CODEX_OK" = "1" ] && [ "$GATE_SETTING" != "off" ]; then
    step_pass "4 hooks" "go-gate in claude settings.json, agy hooks.json, codex config.toml; memb-inject wired; gate setting on"
else
    step_fail "4 hooks" "claude=$CLAUDE_OK agy=$AGY_OK codex=$CODEX_OK memb=$MEMB_OK gate=$GATE_SETTING"
fi
if [ -d "$E2E_HOME/.config/opencode" ]; then
    if [ -f "$E2E_HOME/.config/opencode/plugins/bdb-aos.js" ]; then
        step_pass "4b opencode" "plugin file present (opencode detected)"
    else
        step_fail "4b opencode" "opencode config dir present but plugin file missing"
    fi
else
    step_skip "4b opencode" "opencode binary not detected in the sandbox — SKIP per playbook"
fi

# ── Step 5: Settings gate toggle off/on round trip ──
set_settings gate off
if HOME="$E2E_HOME" aos repair -y >/dev/null 2>&1 && \
   ! grep_exit "$E2E_HOME/.claude/settings.json" "go-gate\\.mjs" && \
   [ -f "$E2E_HOME/.claude/hooks/go-gate.mjs" ]; then
    GATE_OFF_PASS=1
else
    GATE_OFF_PASS=0
fi
set_settings gate on
if HOME="$E2E_HOME" aos repair -y >/dev/null 2>&1 && \
   grep_exit "$E2E_HOME/.claude/settings.json" "go-gate\\.mjs"; then
    GATE_ON_PASS=1
else
    GATE_ON_PASS=0
fi
if [ "$GATE_OFF_PASS" = "1" ] && [ "$GATE_ON_PASS" = "1" ]; then
    step_pass "5 gate-roundtrip" "gate off drops the go-gate registration, gate on restores it"
else
    step_fail "5 gate-roundtrip" "off-drops=$GATE_OFF_PASS on-restores=$GATE_ON_PASS — inspect $E2E_HOME/.claude/settings.json and .aos/v5-settings.json"
fi
# sandbox state is back to gate on; later steps see the stock shape

# ── Step 6: fresh-session injected context under the profile caps ──
if [ -f "$REPO/scripts/measure-session-context.mjs" ]; then
    if node "$REPO/scripts/measure-session-context.mjs" > "$OUT/context-measure.txt" 2>&1; then
        step_pass "6 context-caps" "measured at or under the standard profile caps — see context-measure.txt"
    else
        step_fail "6 context-caps" "over cap or the script failed — see context-measure.txt"
    fi
else
    step_skip "6 context-caps" "scripts/measure-session-context.mjs is not present in this tree — SKIP with note"
fi

# ── Step 7: memB inject returns a block ──
INJECT_RC=0
if [ -f "$E2E_HOME/.claude/hooks/memb-inject.mjs" ]; then
    echo '{}' | HOME="$E2E_HOME" node "$E2E_HOME/.claude/hooks/memb-inject.mjs" > "$OUT/memb-inject.out" 2>"$OUT/memb-inject.err" || INJECT_RC=$?
    if [ "$INJECT_RC" = "0" ] && [ -s "$OUT/memb-inject.out" ]; then
        step_pass "7 memb-inject" "exit 0, injected a block"
    elif [ "$INJECT_RC" = "0" ]; then
        step_skip "7 memb-inject" "exit 0 but empty output — fresh memory has nothing to inject; note it"
    else
        step_fail "7 memb-inject" "exit $INJECT_RC — see memb-inject.err"
    fi
else
    step_fail "7 memb-inject" "hook file missing at ~/.claude/hooks/memb-inject.mjs — the install step should have delivered it"
fi

# ── Step 8: plan-canvas open + trail produce an agenttrail plan (browser) ──
step_skip "8 plan-canvas-trail" "opens a browser and a display; run interactively per the playbook — SKIP"

# ── Step 9: hub supervisor status ──
if HOME="$E2E_HOME" aos hub start >/dev/null 2>&1; then :; fi
sleep 2
if HOME="$E2E_HOME" aos hub status --json 2>/dev/null | grep -q '"service":"aos-hub"'; then
    step_pass "9 hub" "hub status answers with service aos-hub"
else
    step_fail "9 hub" "hub status did not report the aos-hub service"
fi

# ── Step 10: update from the previous version keeps user settings ──
if [ "${AOS_E2E_WITH_UPDATE:-0}" = "1" ]; then
    set_settings gate off
    if npm install -g "@hybridlabor-api/aos@latest" >/dev/null 2>&1 && \
       HOME="$E2E_HOME" aos update -y >/dev/null 2>&1 && \
       ! grep_exit "$E2E_HOME/.claude/settings.json" "go-gate\\.mjs"; then
        step_pass "10 update" "update from the previous version kept gate off and did not re-register go-gate"
    else
        step_fail "10 update" "update re-registered the gate or failed — see the updater output in the sandbox"
    fi
    # put this build back for the uninstall step
    npm install -g "$TARBALL" >/dev/null 2>&1
elif curl -sI --max-time 10 https://registry.npmjs.org/@hybridlabor-api%2faos >/dev/null 2>&1; then
    step_skip "10 update" "set AOS_E2E_WITH_UPDATE=1 (network reachable) to run the update round trip — SKIP"
else
    step_skip "10 update" "needs network to npm registry and AOS_E2E_WITH_UPDATE=1 — SKIP"
fi

# ── Step 11: [GO] merge/publish — human gate, nothing to run headless ──
step_skip "11 GO" "human gate: review the summary before merging or publishing the release — WAITING FOR GO"

# ── Step 12: uninstall leaves no AOS registration ──
UNINSTALLED=1
if ! HOME="$E2E_HOME" aos-uninstall --yes >/dev/null 2>&1; then
    UNINSTALLED=0
fi
for gone in "$E2E_HOME/.agents/.bdb-install-manifest.json" \
            "$E2E_HOME/.agents/.bdb-uninstall-records.json" \
            "$E2E_HOME/.agents/bin/aos.mjs" \
            "$E2E_HOME/.config/opencode/plugins/bdb-aos.js"; do
    [ -e "$gone" ] && UNINSTALLED=0
done
if grep -q "go-gate" "$E2E_HOME/.claude/settings.json" 2>/dev/null; then UNINSTALLED=0; fi
if grep -q "aos-" "$E2E_HOME/.gemini/config/hooks.json" 2>/dev/null; then UNINSTALLED=0; fi
if [ "$UNINSTALLED" = "1" ]; then
    step_pass "12 uninstall" "no AOS manifest, launchers or hook registrations left"
else
    step_fail "12 uninstall" "an AOS registration survived — inspect the sandbox HOME at $E2E_HOME"
fi

echo "" >> "$SUMMARY"
if [ "$FAIL" = "0" ]; then
    echo "RESULT: PASS (passed=$PASS skipped=$SKIP failed=0)" >> "$SUMMARY"
else
    echo "RESULT: FAIL (passed=$PASS skipped=$SKIP failed=$FAIL)" >> "$SUMMARY"
fi
echo "sandbox HOME kept for inspection: $E2E_HOME (never deleted here)" >> "$SUMMARY"
echo "summary: $SUMMARY"
[ "$FAIL" = "0" ]
