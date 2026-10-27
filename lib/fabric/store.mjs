// AOS Fabric store: event log, state projection, locking, atomic writes, replay
// Runs the event truth; projects state.json from the log; holds exclusive lock during writes

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const EXIT_CODES = {
  SUCCESS: 0,
  UNEXPECTED_ERROR: 1,
  INVALID_INPUT: 2,
  NOT_FOUND: 3,
  CONFLICT: 4,
  LOCK_BUSY: 5,
  TERMINAL_PHASE: 6,
  CORRUPTED_STATE: 7,
};

export const TERMINAL_PHASES = ['done', 'escalated', 'cancelled', 'ready_to_ship'];

class Store {
  constructor(runId, baseDir = 'production_artifacts') {
    this.runId = runId;
    this.baseDir = baseDir;
    this.runDir = path.join(baseDir, 'runs', runId);
    this.eventsPath = path.join(this.runDir, 'events.jsonl');
    this.statePath = path.join(this.runDir, 'state.json');
    this.stateBackupPath = path.join(baseDir, 'state.json'); // mirror
    this.lockPath = path.join(this.runDir, 'state.lock');
    this.stepsDirPath = path.join(this.runDir, 'steps');
    this.briefsDirPath = path.join(this.runDir, 'briefs');
  }

  // Try to acquire exclusive lock. Returns { ok, locked, pid, ageMs } or { ok: false, code: 5 }
  tryLock() {
    try {
      const fd = fs.openSync(this.lockPath, 'wx');
      const now = Date.now();
      const data = JSON.stringify({ pid: process.pid, at: now });
      fs.writeSync(fd, data);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      return { ok: true };
    } catch (err) {
      if (err.code === 'EEXIST') {
        // Lock exists; check if stale
        try {
          const lockData = JSON.parse(fs.readFileSync(this.lockPath, 'utf8'));
          const ageMs = Date.now() - lockData.at;
          if (ageMs > 60 * 1000) {
            // Stale; try to take over if pid is dead
            try {
              process.kill(lockData.pid, 0); // ESRCH if dead, EPERM if alive
              return { ok: false, code: EXIT_CODES.LOCK_BUSY, locked: true, pid: lockData.pid, ageMs };
            } catch (killErr) {
              if (killErr.code === 'ESRCH') {
                // Dead; take over
                fs.unlinkSync(this.lockPath);
                return this.tryLock();
              }
              return { ok: false, code: EXIT_CODES.LOCK_BUSY, locked: true, pid: lockData.pid, ageMs };
            }
          } else {
            return { ok: false, code: EXIT_CODES.LOCK_BUSY, locked: true, pid: lockData.pid, ageMs };
          }
        } catch {
          return { ok: false, code: EXIT_CODES.LOCK_BUSY };
        }
      }
      return { ok: false, code: EXIT_CODES.UNEXPECTED_ERROR };
    }
  }

  releaseLock() {
    try {
      fs.unlinkSync(this.lockPath);
    } catch {
      // Best-effort cleanup
    }
  }

  // Compute digest (sha256) of an object for idempotency
  digest(obj) {
    const str = JSON.stringify(obj);
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  // Replay state from events.jsonl. Torn last line is silently dropped.
  replayState() {
    const state = { run_id: this.runId, phase: 'define', iteration: 0, findings: [], gate: {}, approvals: [] };

    if (!fs.existsSync(this.eventsPath)) {
      return state;
    }

    try {
      const content = fs.readFileSync(this.eventsPath, 'utf8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) {
          // Last line empty (well-terminated) or middle blank
          if (i === lines.length - 1) continue; // trailing newline is ok
        }
        try {
          const event = JSON.parse(line);
          if (event && typeof event === 'object') {
            // Apply event to state
            if (event.kind === 'start') {
              Object.assign(state, { goal: event.goal, phase: 'define', max_iterations: event.max_iterations || 3 });
              state.run_id = event.run_id || this.runId;
            } else if (event.kind === 'step_issued') {
              // Record in state which step is pending
              state.last_step_id = event.step_id;
            } else if (event.kind === 'report_accepted') {
              Object.assign(state, event.state_update || {});
              state.last_step_id = null; // cleared on report
            } else if (event.kind === 'cancelled') {
              state.phase = 'cancelled';
            }
          }
        } catch (parseErr) {
          // Line unparseable; skip it. But a non-empty unparseable line in the middle is corruption.
          if (line && i < lines.length - 1) {
            throw new Error(`Corrupted events.jsonl at line ${i + 1}: ${line.slice(0, 60)}`);
          }
        }
      }
    } catch (err) {
      if (err.message.includes('Corrupted')) throw err;
      // Any other read error returns the initial default state
    }

    return state;
  }

  // Atomic write: tmp file, fsync, rename. Creates dirs as needed.
  writeAtomic(filePath, content) {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpPath = `${filePath}.tmp`;
      fs.writeFileSync(tmpPath, content, 'utf8');
      fs.fsyncSync(fs.openSync(tmpPath, 'r'));
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      throw new Error(`Failed to write ${filePath}: ${err.message}`);
    }
  }

  // Append event to events.jsonl
  appendEvent(event) {
    const dir = path.dirname(this.eventsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    try {
      fs.appendFileSync(this.eventsPath, JSON.stringify(event) + '\n', 'utf8');
    } catch (err) {
      throw new Error(`Failed to append event: ${err.message}`);
    }
  }

  // Read current state (may not exist yet)
  readState() {
    if (!fs.existsSync(this.statePath)) {
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
    } catch {
      return null;
    }
  }

  // Write state and mirror to production_artifacts/state.json
  writeState(state) {
    const content = JSON.stringify(state, null, 2) + '\n';
    this.writeAtomic(this.statePath, content);
    this.writeAtomic(this.stateBackupPath, content); // mirror
  }

  // Write step JSON (immutable after issue)
  writeStepFile(stepId, stepData) {
    const filePath = path.join(this.stepsDirPath, `${stepId}.json`);
    const content = JSON.stringify(stepData, null, 2) + '\n';
    this.writeAtomic(filePath, content);
  }

  // Write brief Markdown (immutable after issue)
  writeBriefFile(stepId, briefContent) {
    const filePath = path.join(this.briefsDirPath, `${stepId}.md`);
    this.writeAtomic(filePath, briefContent);
  }
}

export function createStore(runId, baseDir = 'production_artifacts') {
  return new Store(runId, baseDir);
}

export { Store };
