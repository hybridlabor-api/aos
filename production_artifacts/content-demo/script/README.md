# Recording Helper: agenttrail Board Demo

Screen recording runbook and script for a 30–40 s demo of the agenttrail board showing a single-agent Pulse build.

## Files

- **RECORDING.md** — Step-by-step runbook for Tim: setup, recording, post-processing (crop, trim).
- **record.sh** — Bash helper with subcommands: `check`, `list-devices`, `start`, `crop916`, `trim`.
  - **Make executable**: `chmod +x record.sh` before first use.
- **driver.mjs** — CLI driver (built by another worker) that replays build events to agenttrail hub.

## Quick Start

1. Make `record.sh` executable: `chmod +x record.sh`
2. Verify setup: `./record.sh check`
3. Follow **RECORDING.md** steps for setup, recording, and post-processing.
4. Optional dry run: `node driver.mjs --dry-run` (verifies aos-trail connection).

## One-liner: Record, Crop, Trim

```bash
./record.sh start 1 46 && \
  ./record.sh crop916 pulse-demo-*.mp4 cropped.mp4 && \
  ./record.sh trim cropped.mp4 3 40 final.mp4
```

Then move `final.mp4` to `~/.aos/briefs/brag-output-2026-10-07-aos/footage/`.
