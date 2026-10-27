# Windows support, fixed in 5.1.1 - 5.3.0

Windows was handled as a first-class platform in the 5.1.1 to 5.3.0 series.
This file records what the code does and how it was verified. Commits carry
the release/5.2-bundle merge (PR #164) or the release/5.2.2-bundle merge
(PR #167); all statements were checked against the current tree.

## Background spawns do not flash console windows

Every background child process spawn on Windows passes `windowsHide: true`.
The fix wave covered the installer and v5 step runner, detached hook and hub
spawns, cli-spawn children, the session-start trail probe, the a2a process
start-time probe, store-ui, sandbox detection, npm `.cmd` calls and the
module-stop tooling:

- installer + v5 steps: `windows: hide the console of installer and v5 step
  child processes` (ec219f0); detached hooks/hub (1338646), cli-spawn and
  trail probe (6bcf2fd), a2a start-time probe (9e3ba57, lib/a2a-registry.mjs:104).
- tooling: `b2c8f53` (a2a-agy, aos-acp, agenttrail, store-ui, aos-gogate) and
  the underlying `run()` in lib/v5/run.js:24, spawn sites in lib/a2a-spawn.mjs,
  lib/a2a-session.mjs, lib/a2a-agy.mjs, lib/store-ui/server.mjs,
  lib/cli-spawn.js:94, lib/v5/versions.js:11.

## `core.longpaths` for spawned CLIs

Git under the ~-paths Claude/Antigravity use exceeds the default MAX_PATH
limit, so longpath config is injected per child via the GIT_CONFIG_* mechanism
(lib/cli-spawn.js:76-80), from `windows: pass core.longpaths to spawned CLIs so
marketplace add can clone` (6607b1b).

## Tar extraction: cwd-relative paths

GNU tar (Git Bash) reads `C:` inside an argument as a remote host. The
extractor therefore hands tar a cwd-relative archive name and a relative `-C`
destination, so no argument contains a drive letter (lib/tar-extract-args.js,
commit 37889b6). npm pack tarballs list no directory entries at all (verified
with npm 11: only `package/<file>` entries), and extraction strips the
`package/` prefix with `--strip-components=1`.

## Module swap with rename retry

A running Windows service holds its module directory, so swapping it fails
with EPERM/EBUSY/EACCES. The swap is a guarded two-phase dance in
`downloadOrUpdateModule` (installer.js:2795-2860):

1. unpack into `<dir>.incoming-<ts>`, moving persisted entries
   (`.venv`, `.env`, `data`, `logs`, ...) over,
2. rename the live tree to `<dir>.previous-<ts>` via `renameWithRetry`
   (lib/rename-retry.js: exponential backoff, and after the backoff is used
   up it calls the optional `release()` hook — stopping the module's
   processes — and starts a fresh round), restore the previous tree on any
   failure,
3. promote the staging dir; cleanup of the retired dir is best effort
   (the new version is already in place).

"retry the module swap rename and report a locked module clearly" is b1129e0.
Interrupted swaps of earlier runs are recovered first (`recoverStaleSwaps`,
installer.js, S1-1).

## stop-module-processes: stopping only what must die

lib/stop-module-processes.js (introduced by 32e7b326, extended by a11541e):

- Service modules are opt-in: only directories named `memb` (memB) and
  `bdb-synapse` run long-lived services from their own directory
  (SERVICE_MODULES, lib/stop-module-processes.js:10); MCP copies are
  deliberately left alone because sessions depend on them.
- Pass 1 lists processes via PowerShell `Get-CimInstance Win32_Process`, and
  kills those whose command line or image path points into the module
  directory — directory-bounded, so `memB2` and `xmemB` never match
  (`pointsInto`, lib/stop-module-processes.js:45-55). The installer's own
  ancestor chain is protected (never kills its parent).
- Pass 2 catches orphaned workers that map `.pyd`/`.dll` files from the
  module's venv (uvicorn-style reload workers): it scans for held module
  files (`listModuleHolders`) and kills the holders still mapped,
  minus the protected ancestors (a11541e).
- `AOS_NO_STOP_SERVICES=1` skips both passes (lib/stop-module-processes.js:66).
- Both passes are wired into the module swap's `release()` hook
  (installer.js:2827-2837), so processes are stopped exactly when a rename
  refuses, and the module's own step starts the service again.

## CRLF tolerance in file ownership

A checkout on Windows may carry `installer.js`'s shipped text files with CRLF
line endings. `resolveFileConflict` (installer.js:1036-1043) normalises line
endings before comparing: if the LF-normalised hash matches the payload or any
shipped release, the file is ours and is replaced silently
(ca1cb0e: "a CRLF copy of a shipped text file is ours, not a user edit").

## Store-Python and Token Saver

Microsoft Store Python virtualises `%APPDATA%` writes into its package's
`LocalCache\Roaming`, so the Token Saver CLI may not be where Windows
normally puts it. The detector scans
`%LOCALAPPDATA%\Packages\PythonSoftwareFoundation.Python.*\LocalCache\Roaming\token-saver\src\cli.py`
in addition to the normal path, preferring the most recently used Store
package (lib/v5/packages.js:346-380; check 738759e, bundled in PR #169 and
the test coverage shipped as "Token Saver Store-Python detection" in
b192618).

## How it was verified

- A 46-row acceptance matrix exists for release verification
  (`install from a non-home cwd, hooks, rules file, launchers, status,
  verify kernel/memb, gateway, hub health, a2a, uninstall dry run and real`)
  — docs/aos-4.16-to-5.1-agent-notes.md:35; Linux containers cannot host
  systemd-user rows by design.
- Windows acceptance runs happen on a separate Windows test machine through a
  harness session with computer-use supervision, with the human giving GO
  there rather than at the repo (docs/aos-4.16-to-5.1-agent-notes.md:36).
  Several fix rounds ("Windows test rounds") were cut from those findings
  between 5.0.0-beta.1 and 5.2.x before they stabilized.
- The lock path is forced in tests, not observed live only:
  tests/rename-retry.test.js:15 asserts the clear "module directory is locked
  by a running service *" message from a persistent EPERM, and
  tests/stop-module-processes.test.js covers both passes, the
  `AOS_NO_STOP_SERVICES` opt-out, ancestor protection and the orphaned-worker
  mapping case with fake process tables.
- The graduation commit for 5.0.0 recorded Windows as green alongside macOS
  and Docker in its message (3b309af).
