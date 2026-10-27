// Run store of the fabric loop. events.jsonl is the truth; <run>/state.json is a projection of it and
// production_artifacts/state.json mirrors the projection for graph-gate.mjs. One writer at a time (state.lock).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const { renameWithRetry } = createRequire(import.meta.url)('../rename-retry.js');

export const EXIT_CODES = {
  SUCCESS: 0, UNEXPECTED_ERROR: 1, INVALID_INPUT: 2, NOT_FOUND: 3, CONFLICT: 4, LOCK_BUSY: 5, TERMINAL_PHASE: 6, CORRUPTED_STATE: 7,
};
export const TERMINAL_PHASES = ['done', 'escalated', 'cancelled', 'ready_to_ship'];
export const LOCK_STALE_MS = 60 * 1000;
export const MAX_REPORT_BYTES = 2 * 1024 * 1024;

// A report comes from a process we do not control: never read an unbounded file into memory.
export function readTextCapped(file, max = MAX_REPORT_BYTES) {
  const size = fs.statSync(file).size;
  if (size > max) throw Object.assign(new Error(`${file} is ${size} bytes, more than the ${max} allowed`), { code: 'E2BIG' });
  return fs.readFileSync(file, 'utf8');
}
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// Carries the exit code of the CLI contract.
export class FabricError extends Error {
  constructor(code, message) { super(message); this.name = 'FabricError'; this.code = code; }
}

export function assertRunId(id) {
  if (typeof id !== 'string' || !RUN_ID.test(id)) throw new FabricError(EXIT_CODES.INVALID_INPUT, `invalid run id ${JSON.stringify(id)}: use letters, digits, . _ - (1-64 characters, starting with a letter or digit)`);
  return id;
}

export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export const digest = (v) => crypto.createHash('sha256').update(canonical(v)).digest('hex');

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Windows refuses to delete a file another process has open for a moment (EPERM, EBUSY, EACCES): try a few times.
function unlinkRetry(file) {
  for (let i = 0; i < 5; i++) {
    try { fs.unlinkSync(file); return; } catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) return;
      sleepSync(25 * (i + 1));
    }
  }
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { renameWithRetry(tmp, file, { module: 'fabric', tries: 5, delayMs: 50 }); } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
    throw new Error(`cannot replace ${file}: ${e.message}`);
  }
}

export function createStore(runId, { root = process.cwd(), base = 'production_artifacts', now = Date.now, isAlive = pidAlive } = {}) {
  assertRunId(runId);
  const baseDir = path.join(root, base);
  const runDir = path.join(baseDir, 'runs', runId);
  const p = {
    runDir, baseDir, root,
    events: path.join(runDir, 'events.jsonl'),
    state: path.join(runDir, 'state.json'),
    lock: path.join(runDir, 'state.lock'),
    steps: path.join(runDir, 'steps'),
    briefs: path.join(runDir, 'briefs'),
    reports: path.join(runDir, 'reports'),
    mirror: path.join(baseDir, 'state.json'),
  };
  const stepFile = (id) => path.join(p.steps, `${id}.json`);

  function readLockFile() {
    let raw;
    try { raw = fs.readFileSync(p.lock, 'utf8'); } catch { return null; }
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { /* half-written lock: judged by its mtime below */ }
    if (parsed && Number.isInteger(parsed.pid) && Number.isFinite(parsed.at)) return { pid: parsed.pid, at: parsed.at };
    let at = now();
    try { at = fs.statSync(p.lock).mtimeMs; } catch { /* gone meanwhile */ }
    return { pid: null, at };
  }

  // { ok: true, release() } or { ok: false, code: 5, holder }. A lock older than 60 s whose pid is dead is taken over.
  function lock() {
    fs.mkdirSync(p.runDir, { recursive: true });
    for (let round = 0; round < 3; round++) {
      const mine = { pid: process.pid, at: now() };
      try {
        const fd = fs.openSync(p.lock, 'wx');
        try { fs.writeSync(fd, JSON.stringify(mine)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        return {
          ok: true,
          release() {
            const cur = readLockFile();
            if (cur && cur.pid === mine.pid && cur.at === mine.at) unlinkRetry(p.lock);
          },
        };
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
      const seen = readLockFile();
      if (!seen) continue; // released between our open and read: try again
      const ageMs = now() - seen.at;
      const dead = seen.pid === null || !isAlive(seen.pid);
      if (ageMs <= LOCK_STALE_MS || !dead) return { ok: false, code: EXIT_CODES.LOCK_BUSY, holder: { pid: seen.pid, age_ms: ageMs } };
      // Move the stale lock aside first (atomic), so two takers cannot both delete a fresh lock of a third process.
      const tomb = `${p.lock}.stale-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
      try { fs.renameSync(p.lock, tomb); } catch { continue; }
      const moved = (() => { try { return JSON.parse(fs.readFileSync(tomb, 'utf8')); } catch { return null; } })();
      const same = moved ? moved.pid === seen.pid && moved.at === seen.at : seen.pid === null;
      if (!same) {
        try { fs.linkSync(tomb, p.lock); } catch { /* somebody created a new lock meanwhile: theirs wins */ }
        unlinkRetry(tomb);
        return { ok: false, code: EXIT_CODES.LOCK_BUSY, holder: { pid: moved?.pid ?? null, age_ms: 0 } };
      }
      unlinkRetry(tomb);
    }
    return { ok: false, code: EXIT_CODES.LOCK_BUSY, holder: null };
  }

  function lockInfo() {
    const l = readLockFile();
    return l ? { held: true, pid: l.pid, age_ms: now() - l.at, alive: l.pid === null ? false : isAlive(l.pid) } : null;
  }

  function readEvents() {
    let text;
    try { text = fs.readFileSync(p.events, 'utf8'); } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
    const lines = text.split('\n');
    const unterminated = !text.endsWith('\n');
    const events = [];
    lines.forEach((line, i) => {
      if (line.trim() === '') return;
      let ev;
      try { ev = JSON.parse(line); } catch {
        if (unterminated && i === lines.length - 1) return; // torn last line of an interrupted append
        throw new FabricError(EXIT_CODES.CORRUPTED_STATE, `events.jsonl is corrupt at line ${i + 1}; inspect ${p.events}`);
      }
      if (!ev || typeof ev !== 'object' || typeof ev.kind !== 'string') throw new FabricError(EXIT_CODES.CORRUPTED_STATE, `events.jsonl line ${i + 1} is not an event`);
      events.push(ev);
    });
    return events;
  }

  // Folds the log. found:false when no run exists. Every event carries the state it produced, so the last one is the projection.
  function replay() {
    const events = readEvents();
    if (events.length === 0) return { found: false };
    if (events[0].kind !== 'start') throw new FabricError(EXIT_CODES.CORRUPTED_STATE, 'events.jsonl does not begin with a start event');
    const r = { found: true, events, state: null, config: null, openStep: null, accepted: new Map(), reason: null };
    for (const ev of events) {
      if (ev.kind === 'start') { r.config = ev.config; r.state = ev.state; r.openStep = ev.open_step ?? null; r.reason = null; }
      else if (ev.kind === 'report_accepted') { r.accepted.set(ev.step_id, ev.digest); r.state = ev.state; r.openStep = ev.open_step ?? null; r.reason = ev.reason ?? null; }
      else if (ev.kind === 'cancelled') { r.state = ev.state; r.openStep = null; r.reason = ev.reason ?? null; }
    }
    if (!r.state || typeof r.state !== 'object') throw new FabricError(EXIT_CODES.CORRUPTED_STATE, 'events.jsonl carries no state');
    r.terminal = TERMINAL_PHASES.includes(r.state.phase);
    return r;
  }

  function repairTail() {
    let text;
    try { text = fs.readFileSync(p.events, 'utf8'); } catch { return; }
    if (text === '' || text.endsWith('\n')) return;
    fs.truncateSync(p.events, Buffer.byteLength(text.slice(0, text.lastIndexOf('\n') + 1)));
  }

  function appendLine(event) {
    fs.mkdirSync(p.runDir, { recursive: true });
    repairTail();
    const fd = fs.openSync(p.events, 'a');
    try { fs.writeSync(fd, `${JSON.stringify(event)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }

  function writeProjection(state) {
    const content = `${JSON.stringify(state, null, 2)}\n`;
    atomicWrite(p.state, content);
    atomicWrite(p.mirror, content);
  }

  return {
    ...p,
    runId,
    lock,
    lockInfo,
    replay,
    // The event is the commit point; the projection and the mirror follow it and are rebuilt from the log when a crash skips them.
    commit(event) {
      appendLine({ v: 1, at: new Date(now()).toISOString(), ...event });
      writeProjection(event.state);
    },
    note(text, data = {}) { appendLine({ v: 1, at: new Date(now()).toISOString(), kind: 'note', text, ...data }); },
    projectionStale(state) {
      try { return digest(JSON.parse(fs.readFileSync(p.state, 'utf8'))) !== digest(state); } catch { return true; }
    },
    stepFile,
    writeStep(step, brief, baseline) {
      atomicWrite(stepFile(step.step_id), `${JSON.stringify(step, null, 2)}\n`);
      atomicWrite(path.join(p.briefs, `${step.step_id}.md`), brief);
      if (baseline) atomicWrite(path.join(p.steps, `${step.step_id}.baseline.json`), `${JSON.stringify(baseline)}\n`);
    },
    readStep(id) {
      try { return JSON.parse(fs.readFileSync(stepFile(id), 'utf8')); } catch (e) {
        throw new FabricError(EXIT_CODES.CORRUPTED_STATE, `step file for ${id} is missing or unreadable (${e.code || e.message}); inspect ${p.steps}`);
      }
    },
    readBaseline(id) {
      try { return JSON.parse(fs.readFileSync(path.join(p.steps, `${id}.baseline.json`), 'utf8')); } catch { return null; }
    },
  };
}
