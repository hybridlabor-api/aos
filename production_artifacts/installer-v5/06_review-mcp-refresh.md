# Installer v5 — review of the MCP refresh (sonnet, read-only, 8bfb94e..HEAD)

No blocking findings. Merge resolutions in lib/mcp-secrets.js verified (exports shippedPicks, shippedAll, setSecret).

## Fix (PO, on feat/mcp-refresh; dispatcher cherry-picks)

| ID | Fix |
|---|---|
| AD-1 (major) | adopt.js: when a server is defined in several harness files and only some rewrites succeed, adopted.json must not keep an entry that a harness still launches directly (compute `stillBad` per source, roll back the adopted entry or skip it). Test: two sources, one fails. |
| AE-2 (major) | Node >= 24 requirement of mcp-aftereffects@0.3.1 (verify in the package metadata): doctor warning and a gateway preflight line when the Node on PATH is older; installer output only a warning, never a failure. Test. |
| AE-3 (minor) | `bdb_after_effects_mcp_legacy` must not be installed by default next to the new AE entry (rollback entry only: shipped in mcp_config but disabled/opt-in), so AE tools are not exposed twice. Test. |
| AD-4 (minor) | adopt: also skip entries whose positional args look like tokens (sk-, ghp_, long high-entropy values), not only env names. Test. |
| GM-2/GM-3 (minor) | patch_fixture: stop before the label command when the patch command reports an error; fix the docstrings of ma3_select (World) and ma3_set_label (Cue/Executor) to match SELECT_KINDS/LABEL_KINDS; collapse/trim spaces in names. Test. |
| GM-4 (minor) | grandma3_mcp.py import must work when the server is started with -m, a copied file or another cwd (insert the file's own dir into sys.path). Test. |

## Accepted trade-offs (for the opus security check V13)

- AE-1: top-level pin only, transitive dependencies float, runtime npm fetch (same class as other pinned npx servers).
- GM-1: `execute_command` stays raw, as before; the typed tools are the safe path.
- AD-2/AD-3: adopted.json read-modify-write without lock; backups of the whole harness file (0600, kept next to the original).
- AD-5: adopted commands run verbatim after an explicit `adopt`.
- PK-1: Windows `ProgramFiles` and the macOS Resolume path are trusted for detection.

## Dispatcher (me, after V6)

PK-2: installer.js must call shippedPicks with detectApps, write only winners, remove AOS-owned `retired` entries and pass shippedAll() to isAosOwned (otherwise a picked official entry is treated as user-owned).
