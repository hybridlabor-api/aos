import { dirname, join as pjoin } from 'node:path';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { statusService, controlService } from './services.mjs';
import { defaultIdentify } from './identity.mjs';

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
  beforeTick = null, // optional async hook, runs at the start of every round
  onRows = null, // optional (rows) => void, e.g. the endpoints.json writer; must never break a round
  isDisabled = () => false, // (serviceId) => true when the user switched the service off in settings
  identify = defaultIdentify, // (serviceId) => true | false | null (null = not verifiable)
}) {
  // id -> { misses, restarts: [timestamps], failed, lastError, up, foreign }
  const state = new Map();
  let running = null; // in-flight tick promise, if any

  const entryFor = (id) => {
    let e = state.get(id);
    if (!e) {
      e = { misses: 0, restarts: [], failed: false, lastError: null, up: null, foreign: false };
      state.set(id, e);
    }
    return e;
  };

  async function tick() {
    if (running) return running; // one round at a time
    running = (async () => {
      if (beforeTick) await beforeTick();
      const rows = await status(ctx);
      const t = now();
      for (const row of rows) {
        const e = entryFor(row.id);
        e.up = row.up;
        if (row.observe || row.installed === false || row.control === 'observe' || isDisabled(row.id)) {
          e.misses = 0;
          continue;
        }
        if (row.up === true) {
          e.misses = 0;
          e.failed = false;
          // Port answers, but not as our service: report it, restart nothing.
          const who = await identify(row.id, 800, row.port ?? null).catch(() => null);
          e.foreign = who === false;
          if (e.foreign) e.lastError = 'port answered by a foreign process (not the AOS service)';
          else if (e.lastError && e.lastError.startsWith('port answered')) e.lastError = null;
        } else if (row.up === false && (row.loaded !== false || row.status === 'service not loaded')) {
          // 'service not loaded': the plist exists but launchd dropped the job (reboot, bootout) -> start it again.
          e.misses += 1;
          if (e.misses >= MAX_MISSES && !e.failed) {
            e.restarts = e.restarts.filter((ts) => t - ts < BRAKE_WINDOW);
            if (e.restarts.length >= RESTART_BRAKE) {
              e.failed = true;
            } else {
              e.restarts.push(t);
              e.misses = 0;
              try {
                await control(ctx, row.id, row.loaded === false ? 'start' : 'restart');
              } catch (err) {
                e.lastError = err && err.message ? err.message : String(err);
              }
            }
          }
        }
      }
      writeStatus(t);
      if (onRows) { try { await onRows(rows); } catch { /* discovery file is best effort */ } }
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
        failed: e.failed, lastError: e.lastError, foreign: e.foreign,
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
