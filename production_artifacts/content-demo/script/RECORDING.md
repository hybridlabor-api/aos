# Recording Runbook: agenttrail Board — Pulse Demo (36 s)

## Setup (before recording)

1. Close unnecessary apps. Hide notifications: macOS Preferences > Notifications > Do Not Disturb.
2. Set theme to **dark**. Resize browser to **1920×1080** (or plan 9:16 crop from 16:9).
3. Position window left edge at x=0 for crop. Hide address bar.
4. **macOS Screen Recording permission**: System Preferences > Security & Privacy > Screen Recording → allow Terminal.
5. Verify no real session names, repo paths, or PII visible in window titles.
6. **Optional dry run first**: `node driver.mjs --dry-run` (verify aos-trail + driver connection).

## Recording (3 terminals)

**Terminal 1: Start board**
```bash
aos-trail --ensure --cwd /tmp/pulse-demo --plan PLAN.md
# → URL: http://localhost:5350
# Verify: board shows demo repo only, no real data
```

**Terminal 2: Start recording (3 s before driver)**
```bash
./record.sh list-devices    # Find device index (usually 1 for screen)
./record.sh start 1 46      # Records 46 s: 3 s + 36 s + 3 s trailer
```

**Terminal 1/3: Start driver (after 3 s of recording)**
```bash
node driver.mjs --dir /tmp/pulse-demo --duration 36 --speed 1 --port 5350
# Driver runs 36 s. Watch board update in real time.
```

**Terminal 2: Stop recording**
- Let timer expire at 46 s, or press Ctrl+C.
- Output: `./pulse-demo-<timestamp>.mp4`

## Post-Recording: Crop & Trim

**Crop 16:9 (1920×1080) to 9:16 (1080×1920) center:**
```bash
./record.sh crop916 pulse-demo-<timestamp>.mp4 pulse-demo-cropped.mp4
# ffmpeg: crop=1080:1920:(1920-1080)/2:0
```

**Trim 3 s header + 3 s trailer (keep 40 s center):**
```bash
./record.sh trim pulse-demo-cropped.mp4 3 40 pulse-demo-final.mp4
```

## Output

Move final file to:
```
footage/pulse-demo-final.mp4
```

## Notes

- Device index: Use `./record.sh list-devices`; screen capture is typically index 1.
- Never overwrites existing files; each `start` generates a new `pulse-demo-<timestamp>.mp4`.
- Exact ffmpeg commands embedded in `record.sh`.
