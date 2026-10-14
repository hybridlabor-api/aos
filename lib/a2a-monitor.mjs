// Claude Code plugin monitor for the A2A inbox: wakes an idle interactive session.
// The monitor process gets no session_id, so it learns its own session name from a pid binding the
// SessionStart hook writes (<sessionsDir>/claude-pids/<pid>.name, for the Claude process). Each message is claimed (rename to .delivered, same as the UserPromptSubmit drain, so a
// message is delivered exactly once whichever side wins) and printed as ONE stdout line: Claude turns every
// monitor output line into a notification, and a multi-line block could be split across notifications.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { claim, formatInjection, pending, replyCommand, safeField } from "./a2a-inbox.mjs";
import { sessionsDir, validName } from "./a2a-registry.mjs";

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "fish", "ksh", "mksh", "tcsh", "csh"]);
const BIND_DIR = "claude-pids";
export const LINE_SEP = " \u23ce "; // shown where the injection had a line break

export const bindingDir = () => join(sessionsDir(), BIND_DIR);

const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

// One `ps` per hop. Windows has no `ps`: the chain is empty there and only AOS_A2A_NAME resolves a name.
export function psParent(pid) {
  if (process.platform === "win32") return null;
  try {
    const out = execFileSync("ps", ["-o", "ppid=,comm=", "-p", String(pid)], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000, env: { ...process.env, LC_ALL: "C" },
    }).trim();
    const m = out.match(/^(\d+)\s+(.*)$/);
    return m ? { ppid: Number(m[1]), comm: m[2] } : null;
  } catch { return null; }
}

const commName = (comm) => basename(String(comm ?? "")).replace(/^-/, "").toLowerCase();

// [{ pid, comm }] starting at `pid` itself, walking up, at most `depth` entries, never pid 0/1.
export function ancestorChain(pid, { depth = 6, ps = psParent } = {}) {
  const chain = [];
  let cur = Number(pid);
  const seen = new Set();
  while (chain.length < depth && Number.isInteger(cur) && cur > 1 && !seen.has(cur)) {
    seen.add(cur);
    const info = ps(cur);
    if (!info) break;
    chain.push({ pid: cur, comm: commName(info.comm) });
    cur = info.ppid;
  }
  return chain;
}

// Which pid of the hook's chain to bind: only the Claude process, never the hook's short-lived shells (a reused
// shell pid could resolve another session's name). Preferred is a comm containing "claude"; without one (npm
// install runs as `node`), the first non-shell process.
export function bindTargets(chain) {
  if (!chain.length) return [];
  let idx = chain.findIndex((e) => e.comm.includes("claude"));
  if (idx < 0) idx = chain.findIndex((e) => !SHELLS.has(e.comm));
  if (idx < 0) idx = chain.length - 1;
  return [chain[idx].pid];
}

// Bindings of dead pids are removed on every write (only our own <pid>.name files, nothing else).
function pruneBindings(dir) {
  let files = [];
  try { files = readdirSync(dir); } catch { return; }
  for (const f of files) {
    const m = f.match(/^(\d+)\.name$/);
    if (m && !pidAlive(Number(m[1]))) { try { unlinkSync(join(dir, f)); } catch { /* raced */ } }
  }
}

export function writeBindings(name, pids) {
  const n = validName(name);
  const dir = bindingDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch { /* best effort */ }
  pruneBindings(dir);
  const written = [];
  for (const pid of pids) {
    if (!Number.isInteger(pid) || pid <= 1) continue;
    const file = join(dir, `${pid}.name`);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, n, { mode: 0o600 });
    renameSync(tmp, file);
    written.push(file);
  }
  return written;
}

// SessionStart side: bind the hook's ancestors (from its parent up to Claude) to the session name.
export function bindSession(name, { ppid = process.ppid, ps = psParent } = {}) {
  try { return writeBindings(name, bindTargets(ancestorChain(ppid, { depth: 4, ps }))); } catch { return []; }
}

export function readBinding(pid) {
  try { return validName(readFileSync(join(bindingDir(), `${Number(pid)}.name`), "utf8").trim()); } catch { return null; }
}

// Monitor side. AOS_A2A_NAME wins (same rule as sessionName in lib/a2a-session.mjs); otherwise the nearest
// ancestor with a binding. Re-run on every tick: /clear starts a new session id and rewrites the binding.
export function resolveOwnName({ env = process.env, pids = [] } = {}) {
  if (env.AOS_A2A_NAME) { try { return validName(env.AOS_A2A_NAME); } catch { return null; } }
  for (const pid of pids) {
    const n = readBinding(pid);
    if (n) return n;
  }
  return null;
}

// The never-GO line and the reply command spelled with --name travel with every message.
export function renderLine(msg, session, pathEnv = process.env.PATH) {
  const taskId = safeField(msg?.taskId);
  if (!taskId) return null;
  const text = `${formatInjection({ ...msg, from: safeField(msg.from) || "unknown" })}\nAnswer by running: ${replyCommand(taskId, undefined, pathEnv, session)}`;
  return text.split(/\r\n|\r|\n/).join(LINE_SEP);
}

const MAX_PER_TICK = 5;

// Deliver up to `max` pending messages of `session`, oldest first: write the line, THEN claim, so a failed write
// leaves the note pending for the next tick (at-least-once; the drain hook can then still deliver it).
export function drainOnce(session, { pathEnv, write = () => {}, max = MAX_PER_TICK } = {}) {
  const lines = [];
  for (const m of pending(session).slice(0, max)) {
    const line = renderLine(m, session, pathEnv);
    if (line) {
      write(`${line}\n`);
      lines.push(line);
    }
    claim(m.file); // a message without a usable taskId is claimed and dropped
  }
  return lines;
}

// Poll loop. stdout is reserved for notifications: diagnostics never go there.
export function runMonitor({
  intervalMs = 1000,
  write = (s) => process.stdout.write(s),
  env = process.env,
  pids = ancestorChain(process.ppid).map((e) => e.pid),
  parentAlive = () => process.ppid !== 1,
  setTimer = setTimeout,
} = {}) {
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    if (!parentAlive()) { stopped = true; return; }
    try {
      const name = resolveOwnName({ env, pids });
      if (name) drainOnce(name, { write });
    } catch { /* a broken tick must not kill the monitor */ }
    setTimer(tick, intervalMs);
  };
  tick();
  return { stop: () => { stopped = true; } };
}
