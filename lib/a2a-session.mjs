// Session-start sidecar starter (WP-HOOK): ensure exactly one `aos-a2a serve` per session, detached.
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
const LOG_MAX_BYTES = 5 << 20; // rotated once at spawn (the child keeps the fd), like gateway.log
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createRequire } from "node:module";
import { replyDir } from "./a2a-inbox.mjs";
import { autoLabel, sessionsDir, validName, validLabel } from "./a2a-registry.mjs";
import { touchSeen, usableOwnerPid } from "./a2a-liveness.mjs";

export function sessionName({ harness, sessionId, env = process.env } = {}) {
  if (env.AOS_A2A_NAME) return validName(env.AOS_A2A_NAME);
  const raw = String(sessionId ?? "").toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return validName(`${String(harness).toLowerCase()}-${raw.slice(0, 8)}`);
}

export function sessionLabel({ env = process.env } = {}) {
  if (!env.AOS_A2A_LABEL) return undefined;
  const s = String(env.AOS_A2A_LABEL).trim();
  return s ? validLabel(s) : undefined;
}

// The session's human-visible name, read opportunistically from whatever the hook sees (audit
// phonebook): an explicit env override first; for Claude-style SessionStart payloads the title
// fields they carry; for agy/codex (opaque hook payloads) the workspace folder name, falling
// back to the thread/session id. Only present values are used — an absent name labels nothing.
export function sessionTitleOf({ harness, payload = {}, env = process.env, cwd = process.cwd(), home = "" } = {}) {
  const envTitle = () => {
    for (const k of ["AOS_A2A_SESSION_TITLE", "AOS_SESSION_TITLE"]) {
      const v = env[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };
  const payloadTitle = () => {
    for (const k of ["title", "session_name", "sessionTitle", "sessionName", "thread"]) {
      const v = payload && payload[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };
  const workspaceName = () => {
    const base = basename(String(cwd || "").replace(/[\\/]+$/, "")) || "";
    if (!base) return null;
    const homeBase = basename(String(home || "").replace(/[\\/]+$/, ""));
    if (homeBase && base === homeBase) return null; // running from $HOME is not a project name
    return base;
  };
  const h = String(harness || "").toLowerCase();
  if (h === "agy" || h === "codex") return workspaceName() || payloadTitle() || null;
  return envTitle() || payloadTitle() || null;
}

// Wrapper the hooks call: an auto label update must never fail a hook, and an entry that has
// not registered yet (sidecar still starting) simply answers null until the next hook fire.
export function ensureAutoLabel(name, title) {
  try { return autoLabel(name, title); } catch { return null; }
}

export const nodeCommand = (execPath = process.execPath) => (/(^|[\\/])node(\.exe)?$/i.test(execPath) ? execPath : "node");

const PROXY_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];

const cleanEnv = (env) => {
  const out = { ...env };
  for (const k of PROXY_KEYS) delete out[k];
  return out;
};

const validPid = (pid) => {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return null;
  try { process.kill(n, 0); return n; } catch (e) { return e.code === "EPERM" ? n : null; }
};

export const SIDECAR_MODES = ["live", "agy", "codex"];

// agy has no push path into an open interactive chat (its hooks only run when agy calls the model), so an idle agy
// session would never answer a `live` sidecar. Its default is the resume executor (`--mode agy`: `agy --print` in the
// sidecar's own conversation, never `--continue`), which completes without anyone typing. AOS_A2A_AGY_MODE=live opts
// back into the hook-drained inbox (answers only at the next typed prompt, but inside the open chat).
export function defaultMode(harness, env = process.env) {
  if (String(harness).toLowerCase() !== "agy") return "live";
  return env.AOS_A2A_AGY_MODE === "live" ? "live" : "agy";
}

const WIN_SHELLS = new Set(["cmd.exe", "powershell.exe", "pwsh.exe", "bash.exe", "sh.exe", "conhost.exe", "wsl.exe"]);

// "pid,name" lines for `pid` and up to 5 ancestors: one PowerShell start, the pid is a validated integer, no cmd.exe line.
function winChain(pid, until) {
  const script = `$p=${pid}; for($i=0;$i -lt 5;$i++){ $c=Get-CimInstance Win32_Process -Filter "ProcessId=$p"; if(-not $c){break}; "$($c.ProcessId),$($c.Name)"; $p=$c.ParentProcessId }`;
  const timeout = until ? Math.min(4000, Math.max(1, until - Date.now())) : 4000;
  return execFileSync(createRequire(import.meta.url)("./win-bin.js").winBin("powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
}

// Windows hooks run through a shell wrapper, so process.ppid is a shell that exits right after the hook and the
// sidecar's parent watch would stop it. Walk up to the first non-shell process; any failure falls back to `ppid`.
const POSIX_SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);

// "pid,name" lines for `pid` and its ancestors up to the first non-shell (at most 5), via `ps` (macOS and Linux).
// Login shells show as "-zsh". Every `ps` blocks the hook's event loop, so the walk shares one deadline (`until`).
function posixChain(pid, until = Date.now() + 2000) {
  const lines = [];
  let p = pid;
  for (let i = 0; i < 5 && p > 1 && Date.now() < until; i++) {
    const out = execFileSync("ps", ["-o", "ppid=", "-o", "comm=", "-p", String(p)], { encoding: "utf8", timeout: Math.max(1, until - Date.now()), stdio: ["ignore", "pipe", "ignore"], windowsHide: true, env: { ...process.env, LC_ALL: "C" } }).trim();
    const m = out.match(/^(\d+)\s+(.+)$/);
    if (!m) break;
    const name = basename(m[2].trim());
    lines.push(`${p},${name}`);
    if (!POSIX_SHELLS.has(name.toLowerCase().replace(/^-/, ""))) break;
    p = Number(m[1]);
  }
  return lines.join("\n");
}

// The hook runs through a shell wrapper on some harnesses, so process.ppid can be a shell that exits right after the
// hook; the sidecar's parent watch would then stop it within 5 s. Walk up to the first non-shell process on every
// platform; a failed query falls back to `ppid`. `until` caps the query (the hook passes its own deadline).
// The harness image (codex.exe, claude) wins over any other ancestor, so a node shim between the shell and the CLI is skipped.
// The walk must run while the wrapper is alive: a dead pid yields no rows and falls back to `ppid`.
export function resolveHarnessPid(ppid = process.ppid, { platform = process.platform, chain, until, harness } = {}) {
  if (!Number.isInteger(ppid) || ppid <= 1) return ppid;
  const shells = platform === "win32" ? WIN_SHELLS : POSIX_SHELLS;
  const query = chain ?? (platform === "win32" ? winChain : posixChain);
  try {
    const rows = String(query(ppid, until)).split(/\r?\n/).map((l) => l.trim().split(","))
      .filter(([pid, name]) => /^\d+$/.test(pid) && name).map(([pid, name]) => [Number(pid), name.toLowerCase().replace(/^-/, "")]);
    const image = harness ? String(harness).toLowerCase() : "";
    const own = image && rows.find(([, name]) => name === image || name === `${image}.exe`);
    if (own) return own[0];
    const harnessRow = rows.find(([, name]) => !shells.has(name));
    if (harnessRow) return harnessRow[0];
  } catch { /* PowerShell or ps missing, blocked or slow */ }
  return ppid;
}

export function ensureSidecar({
  harness,
  sessionId,
  parentPid,
  env = process.env,
  // "live" (inbox drained by the harness hooks) | "agy" (agy --print resume executor)
  // | "codex" (needs `thread`: codex queue into that session)
  mode = defaultMode(harness, env),
  thread,
  spawnImpl = spawn,
  binPath,
  label = (() => { try { return sessionLabel({ env }); } catch { return undefined; } })(),
  // The session name/title the harness reports (audit phonebook): labels an unlabeled session,
  // and updates the auto label when the hook sees a new name after a rename. Manual always wins.
  title,
} = {}) {
  try {
    if (!SIDECAR_MODES.includes(mode)) return { skipped: "error", error: `unknown mode ${mode}` };
    if (mode === "codex" && !String(thread ?? "").trim()) return { skipped: "error", error: "codex mode needs a thread (the codex session id)" };
    if (env.AOS_A2A_SIDECAR === "off") return { skipped: "off" };
    if (Number(env.AOS_DELEGATE_DEPTH || 0) > 0 || Number(env.MCSC_DEPTH || 0) > 0) return { skipped: "depth" };

    const bin = binPath ?? new URL("../bin/aos-a2a.mjs", import.meta.url);
    const binPathStr = bin instanceof URL ? fileURLToPath(bin) : String(bin);
    const name = sessionName({ harness, sessionId, env });
    const dir = sessionsDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const pidfile = join(dir, `${name}.pid`);
    // The reply dir is made here, outside any harness sandbox, so a sandboxed `aos-a2a reply` only has to write a file.
    try { mkdirSync(replyDir(name), { recursive: true, mode: 0o700 }); } catch { /* best effort */ }
    // The owner's sign of life for the idle reaper (shared-host harnesses): every hook fire refreshes it.
    try { touchSeen(dir, name); } catch { /* best effort */ }

    // Stale pidfile (dead or non-parsable pid) falls through and is overwritten by the spawn below.
    let livePid = null;
    try {
      const raw = readFileSync(pidfile, "utf8").trim();
      livePid = raw ? validPid(raw) : null;
    } catch { /* no pidfile */ }
    if (livePid) {
      // A sidecar of this session is already up: only the auto label can change here (rename).
      if (title && !label) ensureAutoLabel(name, title);
      return { skipped: "running", name };
    }

    const args = [binPathStr, "serve", "--name", name, "--harness", String(harness), "--mode", mode];
    const owner = usableOwnerPid(parentPid);
    if (owner !== null) args.push("--parent-pid", String(owner));
    if (mode === "codex") args.push("--thread", String(thread));
    if (label) args.push("--label", String(label), "--label-source", "manual");
    else if (title) args.push("--label", String(title), "--label-source", "auto");
    // sidecar output goes to <name>.log (0600): a detached child that dies must leave a reason behind
    let out = "ignore";
    let logFd = null;
    try {
      const logFile = join(dir, `${name}.log`);
      try { if (statSync(logFile).size > LOG_MAX_BYTES) renameSync(logFile, `${logFile}.1`); } catch { /* none yet */ }
      logFd = openSync(logFile, "a", 0o600); out = logFd;
    } catch { /* fall back to ignore */ }
    // Inside OpenCode (a compiled binary) process.execPath is `opencode`, not node: running it would just print its help.
    // The sidecar and everything it spawns (agy --print, codex queue) know their own peer name: a reply run from there
    // without --name still lands in this session's reply dir instead of an inherited or invented one.
    const child = spawnImpl(nodeCommand(), args, { detached: true, windowsHide: true, stdio: ["ignore", out, out], env: { ...cleanEnv(env), AOS_A2A_NAME: name } });
    if (logFd !== null) { try { closeSync(logFd); } catch { /* already closed */ } }
    child.unref();
    const childPid = child.pid;
    if (Number.isInteger(childPid) && childPid > 0) {
      writeFileSync(pidfile, String(childPid), { mode: 0o600 });
      chmodSync(pidfile, 0o600);
    }
    return { started: true, name, pid: childPid };
  } catch (e) {
    return { skipped: "error", error: e?.message || String(e) };
  }
}
