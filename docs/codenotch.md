# BDB AO Codenotch (macOS, opt-in)

The AOS installer can install the BDB AO Codenotch desktop app. It is **macOS only**: on Windows and Linux the step is never offered and no code of it runs.

## Enabling

| Mode | How |
|---|---|
| Interactive | Answer the "Install BDB AO Codenotch?" prompt (default: no) |
| Non-interactive | `AOS_CODENOTCH=1 aos -y` or `aos -y --codenotch` |
| Both | `--codenotch` / `AOS_CODENOTCH=1` skips the question |

## What it does

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
