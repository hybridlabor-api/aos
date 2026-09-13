#!/bin/bash
# End-to-end installer check in a throwaway $HOME.
#
# Not part of `npm test`: it makes real network calls and takes minutes. Run it
# before a release. Every case here is a defect that shipped at least once —
# the unit tests cover the logic, this covers whether the installer actually
# does anything, which is the failure mode that kept getting through.
#
#   bash tests/installer-e2e.sh
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
F=$(mktemp -d)
pass=0; fail=0
chk(){ if eval "$2"; then echo "  ✅ $1"; pass=$((pass+1)); else echo "  ❌ $1"; fail=$((fail+1)); fi; }
run(){ HOME=$F node "$REPO/installer.js" -y --platforms=2 >/dev/null 2>&1; }

echo "throwaway HOME: $F"

echo "── dry-run writes nothing AOS owns ──"
HOME=$F node "$REPO/installer.js" --dry-run -y --platforms=2 >/dev/null 2>&1
chk "no AOS file created" '[ "$(find $F -type f -not -path "*/.npm/*" 2>/dev/null | wc -l | tr -d " ")" = "0" ]'
chk "no memb-mcp venv created" "[ ! -d $F/.gemini/config/mcps/memb-mcp/.venv ]"

echo "── fresh install ──"
run
chk "manifest written"        "[ -f $F/.agents/.bdb-manifest.json ]"
chk "skills synced"           "[ -d $F/.claude/skills/startcycle ]"
chk "memb-inject delivered"   "[ -f $F/.claude/hooks/memb-inject.mjs ]"
chk "hook is current (v2)"    "grep -q 'aos-hook-version: 2' $F/.claude/hooks/memb-inject.mjs"
chk "hook wired"              "grep -q 'memb-inject' $F/.claude/settings.json"
chk "dispatcher workflows"    "[ -d $F/.claude/workflows ]"

echo "── uninstalled harnesses get no directories ──"
chk "no .cursor/skills"       "[ ! -d $F/.cursor/skills ]"
chk "no .roo/skills"          "[ ! -d $F/.roo/skills ]"

echo "── update refreshes what a fresh install would ──"
echo '// aos-hook-version: 1' > $F/.claude/hooks/memb-inject.mjs
echo 'STALE' > $F/.claude/skills/startcycle/SKILL.md
rm -rf $F/.claude/workflows
run
chk "stale hook replaced"     "grep -q 'aos-hook-version: 2' $F/.claude/hooks/memb-inject.mjs"
chk "workflows restored"      "[ -d $F/.claude/workflows ]"
chk "stale skill replaced"    "! grep -q 'STALE' $F/.claude/skills/startcycle/SKILL.md"
chk "and backed up"           "ls $F/.claude/skills/startcycle/SKILL.md.*.bak >/dev/null 2>&1"

echo "── the user's own files survive ──"
mkdir -p $F/.claude/skills/my-own && echo 'MINE' > $F/.claude/skills/my-own/SKILL.md
python3 - "$F" <<'PY'
import json,sys
p=f"{sys.argv[1]}/.claude/settings.json"; d=json.load(open(p))
d['theme']='dark'; d['myKey']=1
d['hooks'].setdefault('UserPromptSubmit',[]).append({'hooks':[{'type':'command','command':'node /my/hook.mjs'}]})
json.dump(d,open(p,'w'),indent=2)
PY
run
chk "foreign skill untouched" "grep -q 'MINE' $F/.claude/skills/my-own/SKILL.md"
chk "user settings keys kept" "python3 -c \"import json,sys;d=json.load(open('$F/.claude/settings.json'));sys.exit(0 if d.get('theme')=='dark' and d.get('myKey')==1 else 1)\""
chk "foreign hook kept"       "grep -q '/my/hook.mjs' $F/.claude/settings.json"
chk "no duplicate BDB hook"   '[ "$(grep -c "memb-inject" $F/.claude/settings.json)" = "1" ]'

echo
echo "$pass passed, $fail failed"
rm -rf "$F"
exit $((fail > 0))
