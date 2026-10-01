# Recap: Add --json output and exit codes to the stash CLI

> Invented example. Replace every fact with your own change. Use this for a PR or handover where a reviewer must decide.

**PR:** #87  **Branch:** feat/cli-json-output into main  **Commit:** 9d2e7b1  **Date:** 2026-04-22  **Size:** 6 files, +214 / -37

## Summary

- **What:** `stashctl list` and `stashctl prune` accept `--json` and return exit codes 0 (ok), 2 (usage) and 3 (nothing to do).
- **Why:** CI scripts parsed the table output with `awk` and broke whenever a column changed.
- **Scope:** output formatting only. Storage format and the default human output are unchanged.

## Changed areas

| File | Change | Note |
|------|--------|------|
| src/cli/list.ts | modified | --json flag, exit codes |
| src/cli/prune.ts | modified | --json flag, exit 3 when nothing pruned |
| src/cli/output.ts | added | Shared table and JSON writer |
| src/cli/legacy-format.ts | deleted | Replaced by output.ts |
| tests/cli-json.test.ts | added | Schema and exit code cases |

Most important change, list output:

| Before | After |
|--------|-------|
| `stashctl list` prints a table, exit 0 | `stashctl list --json` prints `[{"id":"a1f3","ageDays":2,"bytes":4300800}, ...]`, exit 0 |

## Decisions

| Question | Chosen | Rejected alternative |
|----------|--------|----------------------|
| JSON shape | One JSON array per command | One JSON object per line: consumers read the whole output anyway |
| Exit code for an empty prune | Exit 3 | Exit 0: hides the no-op from CI |

## Verification

| Command | Exit code | Result |
|---------|-----------|--------|
| npm test | 0 | 41 passed, 0 failed |
| npm run lint | 0 | No warnings |
| stashctl list --json \| jq length | 0 | Printed 2 on the sample stash |
| stashctl prune --json (empty stash) | 3 | Exit 3 as designed |
| stashctl list --bogus | 2 | Usage error printed to stderr |

| Verified | Not verified |
|----------|--------------|
| JSON shape and the three exit codes, in unit tests | Windows and macOS terminals |
| Human table output is byte-identical to before | Stashes with more than 10,000 entries |
| Linux x64, Node 20 | Any downstream script that parsed the old table |

## Risks and follow-ups

- [ ] Exit 3 for an empty prune can break scripts that expect 0: announce it in the release notes
- [ ] Run the large-stash case (10,000 entries) before the next release
- [ ] Check Windows output encoding for non-ASCII ids
- [ ] Add --ndjson only if a real consumer asks for it
