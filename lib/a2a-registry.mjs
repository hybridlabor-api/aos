// Local A2A session registry: one <name>.json (public metadata) + one <name>.token (bearer secret) per session.
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

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
  // Atomic write: tmp + rename in the same dir, 0600 — a concurrent reader never sees a truncated file.
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, data, { mode: 0o600 });
    try { chmodSync(tmp, 0o600); } catch { /* umask already capped it */ }
    renameSync(tmp, file);
  } finally {
    try { unlinkSync(tmp); } catch { /* renamed away or never created */ }
  }
}

// Token goes in its own file so list()/card tooling and `cat <name>.json` never expose the secret.
export function register({ name, harness, pid = process.pid, url, cardUrl, cwd = process.cwd(), token }) {
  const p = paths(name);
  if (!harness) throw new Error("harness required");
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("pid must be a positive integer");
  ensureDir();
  const now = new Date().toISOString();
  writePrivate(p.reg, JSON.stringify({ name: p.name, harness, pid, url, cardUrl, cwd, started: now, since: now, ts: Date.now(), status: "idle" }, null, 2));
  if (token != null) writePrivate(p.tok, String(token));
  refreshBook(true);
  return p.reg;
}

export function readToken(name) {
  try { return readFileSync(paths(name).tok, "utf8").trim(); } catch { return null; }
}

export function unregister(name) {
  const p = paths(name);
  for (const f of [p.reg, p.tok]) { try { unlinkSync(f); } catch { /* already gone */ } }
  refreshBook(true);
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
    try { validName(name); entry = JSON.parse(readFileSync(join(sessionsDir(), f), "utf8")); } catch {
      // Half-written or corrupt file: only prune it when it is older than 2 s. A file being
      // atomically replaced (tmp+rename) is never truncated, but a still-queued foreign writer is.
      // Continue either way so the live/prune branch below can never re-prune a FRESH corrupt file.
      if (prune && Date.now() - mtimeOf(join(sessionsDir(), f)) > 2000) {
        try { unregister(name); } catch { /* invalid name: leave the file alone */ }
      }
      continue;
    }
    if (entry && isLive(entry)) out.push(Object.defineProperty(entry, "fileName", { value: name, enumerable: false }));
    else if (prune) { try { unregister(name); } catch { /* invalid name: leave the file alone */ } }
  }
  return out;
}

// --- a2abook: one file listing every LIVE A2A agent (no tokens, ever). ---

export const bookPath = () => resolve(process.env.AOS_A2A_BOOK || join(homedir(), ".agents", "a2a", "a2abook.json"));

// Value hygiene for book entries: never leak userinfo/query/fragment (they can carry tokens).
function safeUrl(u) {
  if (u == null) return null;
  try {
    const x = new URL(String(u));
    return `${x.protocol}//${x.host}${x.pathname}`;
  } catch { return null; }
}
function safeCwd(c) {
  if (c == null) return null;
  const s = String(c);
  if (!isAbsolute(s)) return null;
  // a cwd segment that looks like a pasted token/credential is never written into the shared book
  if (/[\w.+]{16,}(?:[=/]|$)/.test(s.split("/").find((seg) => seg.length >= 16) ?? "")) return null;
  return s;
}

const BOOK_FIELDS = ["name", "harness", "url", "cardUrl", "cwd", "since", "ts", "status", "pid"];

function writeBookFile(entries) {
  const file = bookPath();
  const dir = dirname(file);
  const isDefaultBook = !process.env.AOS_A2A_BOOK && file === join(homedir(), ".agents", "a2a", "a2abook.json");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  // chmod only the default book dir; never tighten a user-supplied parent like /tmp or $HOME.
  if (isDefaultBook) {
    let st = null;
    try { st = lstatSync(dir); } catch { /* gone again; skip chmod */ }
    if (st && !st.isDirectory()) throw new Error(`book dir path is not a directory: ${dir}`);
    if (st && st.isSymbolicLink()) { /* never follow symlinks with chmod */ }
    else if (st) { try { chmodSync(dir, 0o700); } catch { /* best effort */ } }
  }
  // Concurrency note: concurrent writers can lose updates (last rename wins). Accepted: the next
  // heartbeat (<= ~5 s later) rebuilds the book from the registry, which repairs it.
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(entries, null, 2) + "\n", { mode: 0o600 });
    try { chmodSync(tmp, 0o600); } catch { /* umask already capped it */ }
    renameSync(tmp, file);
  } catch (e) {
    throw e;
  } finally {
    try { unlinkSync(tmp); } catch { /* renamed away or never created */ }
  }
  if (isDefaultBook) { try { chmodSync(file, 0o600); } catch { /* best effort */ } }
  return file;
}

// staleness: entry ts (fallback: session file mtime, ipo) older than maxAgeMs relative to `now`.
function mtimeOf(file) {
  try { return statSync(file).mtimeMs; } catch { return 0; }
}

export function book({ now = Date.now(), maxAgeMs = 30000 } = {}) {
  const live = list();
  const entries = [];
  for (const e of live) {
    // name comes only from the validated session FILE name (fileName, non-enumerable on the entry),
    // never from the json body.
    const fileName = e.fileName ?? e.name;
    let ts = typeof e.ts === "number" ? e.ts : Date.parse(e.ts ?? "");
    if (!Number.isFinite(ts)) ts = mtimeOf(join(sessionsDir(), `${e.name}.json`));
    if (now - ts > maxAgeMs) continue;
    if (!Number.isInteger(e.pid) || !pidAlive(e.pid)) continue;
    const out = {};
    for (const k of BOOK_FIELDS) out[k] = e[k] ?? (k === "ts" ? ts : k === "status" ? "idle" : null);
    out.name = validName(fileName);
    out.url = safeUrl(e.url);
    out.cardUrl = safeUrl(e.cardUrl);
    out.cwd = safeCwd(e.cwd);
    out.since = e.since ?? e.started ?? null;
    out.ts = Number.isInteger(out.ts) ? out.ts : ts;
    out.status = e.status === "working" ? "working" : "idle";
    entries.push(out);
  }
  entries.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  writeBookFile(entries);
  return entries;
}

export function heartbeat(name, { status } = {}) {
  const p = paths(name);
  let entry = JSON.parse(readFileSync(p.reg, "utf8"));
  entry.ts = Date.now();
  if (status === "working" || status === "idle") entry.status = status;
  writePrivate(p.reg, JSON.stringify(entry, null, 2));
  refreshBook();
  return entry;
}

// At most one book rewrite per 2 s per process from HEARTBEATS, so N sidecars on one host do not
// thrash the file. register/unregister always rewrite: a just-registered sidecar must appear in the
// book immediately (aos-a2a send resolves targets there); throttling it made the new agent invisible
// for up to 2 s (and within that window every later sidecar, too).
// Test hook: tests may reset _bookThrottle.last = 0 to force the next heartbeat sweep.
export const _bookThrottle = { last: 0 };

function refreshBook(force = false) {
  const now = Date.now();
  if (!force && now - _bookThrottle.last < 2000) return;
  _bookThrottle.last = now;
  try { book(); } catch { /* a book failure must never break register/unregister/heartbeat */ }
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
