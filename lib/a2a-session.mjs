// Session-start sidecar starter (WP-HOOK): ensure exactly one `aos-a2a serve` per session, detached.
import { spawn } from "node:child_process";
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { sessionsDir, validName, validLabel } from "./a2a-registry.mjs";

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

    // Stale pidfile (dead or non-parsable pid) falls through and is overwritten by the spawn below.
    let livePid = null;
    try {
      const raw = readFileSync(pidfile, "utf8").trim();
      livePid = raw ? validPid(raw) : null;
    } catch { /* no pidfile */ }
    if (livePid) return { skipped: "running", name };

    const args = [binPathStr, "serve", "--name", name, "--harness", String(harness), "--mode", mode, "--parent-pid", String(parentPid)];
    if (mode === "codex") args.push("--thread", String(thread));
    if (label) args.push("--label", String(label));
    // sidecar output goes to <name>.log (0600): a detached child that dies must leave a reason behind
    let out = "ignore";
    let logFd = null;
    try { logFd = openSync(join(dir, `${name}.log`), "a", 0o600); out = logFd; } catch { /* fall back to ignore */ }
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
