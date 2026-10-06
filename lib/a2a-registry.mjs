// Local A2A session registry: one <name>.json (public metadata) + one <name>.token (bearer secret) per session.
import { chmodSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

export const sessionsDir = () => process.env.AOS_SESSIONS_DIR || join(homedir(), ".aos", "sessions");

// Same alphabet as aos-bus slug(); reject instead of normalising so a name can never alias another file.
export function validName(name) {
  const n = String(name ?? "");
  if (!n || n.length > 64 || n.startsWith(".") || !/^[a-z0-9._-]+$/.test(n) || n.startsWith("-") || n.endsWith("-")) {
    throw new Error(`invalid session name: ${JSON.stringify(n)} (use [a-z0-9._-], no leading dot/dash, max 64)`);
  }
  return n;
}

function ensureDir() {
  const dir = sessionsDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
}

const paths = (name) => {
  const n = validName(name);
  const dir = sessionsDir();
  return { name: n, dir, reg: join(dir, `${n}.json`), tok: join(dir, `${n}.token`) };
};

function writePrivate(file, data) {
  writeFileSync(file, data, { mode: 0o600 });
  chmodSync(file, 0o600);
}

// Token goes in its own file so list()/card tooling and `cat <name>.json` never expose the secret.
export function register({ name, harness, pid = process.pid, url, cardUrl, cwd = process.cwd(), token }) {
  const p = paths(name);
  if (!harness) throw new Error("harness required");
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("pid must be a positive integer");
  ensureDir();
  const now = new Date().toISOString();
  writePrivate(p.reg, JSON.stringify({ name: p.name, harness, pid, url, cardUrl, cwd, started: now, ts: now }, null, 2));
  if (token != null) writePrivate(p.tok, String(token));
  return p.reg;
}

export function readToken(name) {
  try { return readFileSync(paths(name).tok, "utf8").trim(); } catch { return null; }
}

export function unregister(name) {
  const p = paths(name);
  for (const f of [p.reg, p.tok]) { try { unlinkSync(f); } catch { /* already gone */ } }
}

const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

// ponytail: PID-reuse check compares the live process's start time (ps lstart, 1s resolution) with the entry's
// `started`; a reused pid belongs to a process that started after registration. Ceiling: a reused pid whose
// process started within 2s of registration, or a host without `ps`, passes as alive. Upgrade: heartbeat ts like aos-bus.
function sameProcess(entry) {
  try {
    const out = execFileSync("ps", ["-o", "lstart=", "-p", String(entry.pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, LC_ALL: "C" } });
    const t = Date.parse(out.trim());
    return Number.isNaN(t) || t <= Date.parse(entry.started) + 2000;
  } catch { return true; }
}

const isLive = (e) => Number.isInteger(e?.pid) && pidAlive(e.pid) && sameProcess(e);

// prune removes only the stale entry's own .json and .token (never other files in the dir).
export function list({ prune = false } = {}) {
  let files = [];
  try { files = readdirSync(sessionsDir()).filter((f) => f.endsWith(".json")); } catch { return []; }
  const out = [];
  for (const f of files) {
    const name = f.slice(0, -5);
    let entry = null;
    try { validName(name); entry = JSON.parse(readFileSync(join(sessionsDir(), f), "utf8")); } catch { /* corrupt or foreign name */ }
    if (entry && isLive(entry)) out.push(entry);
    else if (prune) { try { unregister(name); } catch { /* invalid name: leave the file alone */ } }
  }
  return out;
}

// A session heartbeats by rewriting its own entry's ts (and status); a stale ts is how the book knows
// a sidecar stopped heartbeating even if the pid is somehow still alive.
export function heartbeat({ name, status } = {}) {
  const p = paths(name);
  const e = JSON.parse(readFileSync(p.reg, "utf8"));
  e.ts = new Date().toISOString();
  if (status === "working" || status === "idle") e.status = status;
  writePrivate(p.reg, JSON.stringify(e, null, 2));
  return e;
}

export const bookPath = () => process.env.AOS_A2A_BOOK || join(homedir(), ".agents", "a2a", "a2abook.json");

const BOOK_MAX_AGE_MS = 30_000;

// The book is a single 0600 snapshot of every live, freshly-heartbeating agent. It never carries
// tokens; the only file it writes (or tmp-replaces) is the book file itself.
export function book() {
  const entries = list()
    .filter((e) => e.ts && Date.now() - Date.parse(e.ts) <= BOOK_MAX_AGE_MS)
    .map((e) => ({
      name: e.name, harness: e.harness, url: e.url, cardUrl: e.cardUrl, cwd: e.cwd,
      since: e.started, heartbeat: e.ts, status: e.status === "working" ? "working" : "idle", pid: e.pid,
    }));
  const file = bookPath();
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(entries, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  return entries;
}

// Read-only: returns aos-bus registrations for migration; never writes or moves them.
export function importBusSessions() {
  const dir = join(homedir(), ".aos", "bus", "sessions");
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { return []; }
  const out = [];
  for (const f of files) {
    try {
      const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
      out.push({ name: r.name ?? f.slice(0, -5), harness: r.harness, pid: r.pid, cwd: r.cwd, ts: r.ts, source: "bus" });
    } catch { /* corrupt entry */ }
  }
  return out;
}
