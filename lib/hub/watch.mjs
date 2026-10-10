import { dirname, join as pjoin } from 'node:path';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { statusService, controlService } from './services.mjs';

// ------------------------------------------------------------------- watcher
// The hub as supervisor (plan 5.0.0): poll statusService, count consecutive
// misses for installed, controllable services, restart after 2, brake after
// 3 restarts in 10 minutes. The watcher never spawns a process itself — it
// only calls controlService, so launchd/systemd stay the single source of
// process ownership.

const MAX_MISSES = 2;       // restart on the second consecutive failed probe
const RESTART_BRAKE = 3;    // at most this many restarts ...
const BRAKE_WINDOW = 10 * 60_000; // ... per 10 minutes, then failed until seen up

export function createWatcher({
  ctx,
  status = statusService,
  control = controlService,
  now = Date.now,
  intervalMs = 30000,
  statusFile = pjoin(ctx.home, '.aos', 'status.json'),
}) {
  // id -> { misses, restarts: [timestamps], failed, lastError, up }
  const state = new Map();
  let running = null; // in-flight tick promise, if any

  const entryFor = (id) => {
    let e = state.get(id);
    if (!e) {
      e = { misses: 0, restarts: [], failed: false, lastError: null, up: null };
      state.set(id, e);
    }
    return e;
  };

  async function tick() {
    if (running) return running; // one round at a time
    running = (async () => {
      const rows = await status(ctx);
      const t = now();
      for (const row of rows) {
        const e = entryFor(row.id);
        e.up = row.up;
        if (row.observe || row.installed === false || row.control === 'observe') {
          e.misses = 0;
          continue;
        }
        if (row.up === true) {
          e.misses = 0;
          e.failed = false;
        } else if (row.up === false && row.loaded !== false) {
          e.misses += 1;
          if (e.misses >= MAX_MISSES && !e.failed) {
            e.restarts = e.restarts.filter((ts) => t - ts < BRAKE_WINDOW);
            if (e.restarts.length >= RESTART_BRAKE) {
              e.failed = true;
            } else {
              e.restarts.push(t);
              e.misses = 0;
              try {
                await control(ctx, row.id, 'restart');
              } catch (err) {
                e.lastError = err && err.message ? err.message : String(err);
              }
            }
          }
        }
      }
      writeStatus(t);
    })();
    try {
      await running;
    } finally {
      running = null;
    }
    return running;
  }

  function writeStatus(at) {
    const services = {};
    for (const [id, e] of state) {
      services[id] = {
        up: e.up, misses: e.misses, restarts: [...e.restarts],
        failed: e.failed, lastError: e.lastError,
      };
    }
    const payload = JSON.stringify({ at, services });
    // Atomic write in the target dir: a reader (the UI) must never see a
    // half-written file, and rename is only atomic on the same filesystem.
    mkdirSync(dirname(statusFile), { recursive: true });
    const tmp = `${statusFile}.tmp`;
    writeFileSync(tmp, payload);
    renameSync(tmp, statusFile);
  }

  let timer = null;
  function start() {
    if (timer) return;
    // A failed round (status probe or status.json write) must not take the hub down.
    timer = setInterval(() => { tick().catch(() => {}); }, intervalMs);
    timer.unref();
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  return { tick, start, stop, state };
}
