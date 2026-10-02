# BDB AO Codenotch (macOS and Windows, default on)

The AOS installer installs the BDB AO Codenotch desktop app by default on **macOS and Windows**. On Linux the step is never offered and no code of it runs.

## Controlling it

| Mode | Behavior |
|---|---|
| Interactive | Prompt "Install BDB AO Codenotch?", default **yes** |
| Non-interactive (`-y`, no TTY) | Installs unless opted out |
| Opt out | `AOS_CODENOTCH=0` or `--no-codenotch` (wins over everything) |
| Force on | `AOS_CODENOTCH=1` or `--codenotch` (skips the question) |

A failure at any step (no release yet, 404, offline, rate limit, checksum mismatch, mount error) prints a warning and the AOS install continues; the exit code is never affected. The installer ends with one line saying whether Codenotch was installed, skipped or failed, and how to remove it.

## Windows

- Asset: `Codenotch-Setup-<version>.exe` plus `Codenotch-Setup-<version>.exe.sha256` from the same latest release. If the exact name is absent, the single `*Setup*.exe` that has a matching `.sha256` is used; anything ambiguous is refused.
- The SHA-256 is verified before the installer runs; a mismatch only warns.
- Runs the NSIS installer silently as `Setup.exe /S`, per-user, no admin, no elevation, with a 5 minute timeout, then checks the version in the per-user uninstall registry key (`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall`, key `Codenotch`, fallback scan for a subkey whose DisplayName is Codenotch).
- Installed version same or newer: skipped. An older install AOS did not record is kept unless you confirm interactively.
- The path of the uninstaller and the version are recorded in `~/.agents/.bdb-codenotch.json` (`%USERPROFILE%` on Windows).
- `aos-uninstall` runs `<recorded uninstall.exe> /S` only if that file still exists and the registry version and uninstaller path still match the record; otherwise the install is left alone.
- Not yet verified against a real NSIS build: the registry key name and the exact uninstall behavior.

## What it does (macOS)

1. Reads `https://api.github.com/repos/hybridlabor-api/bdb-ao-codenotch-releases/releases/latest` (public repo, unauthenticated, created and maintained by Tim). A missing repo (404) or a GitHub rate limit prints a friendly note and the install continues; nothing fails.
2. Downloads the `.dmg` and verifies its `.sha256` asset from the same release **before** mounting. A mismatch or a missing checksum refuses the install.
3. Mounts with `hdiutil attach -nobrowse -readonly -mountpoint <temp dir>` and always detaches again, even on failure.
4. Copies the single `.app` from the DMG to `/Applications`, or to `~/Applications` when `/Applications` is not writable. Never uses sudo.
5. Runs `xattr -dr com.apple.quarantine` on the copy. The app is **ad-hoc signed** until Apple developer certificates are in place, so Gatekeeper would otherwise block it.
6. Records path, version and bundle id in `~/.agents/.bdb-codenotch.json`.

## Idempotence and safety

- Installed version same or newer (`CFBundleShortVersionString`): skipped.
- Older and installed by AOS (recorded path, bundle id and version still match): asked in interactive mode, replaced automatically with `AOS_CODENOTCH=1`. The old copy is restored if the new copy fails.
- Older and not installed by AOS: kept with a note in non-interactive mode; in interactive mode replaced only after you confirm.

## Uninstall

`aos-uninstall` removes only the recorded `.app`, and only while its bundle id and version still match the record. A replaced or otherwise unknown app is kept. `--dry-run` lists the decision.
