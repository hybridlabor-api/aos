// Session-start sidecar starter (WP-HOOK): ensure exactly one `aos-a2a serve` per session, detached.
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { sessionsDir, validName } from "./a2a-registry.mjs";

export function sessionName({ harness, sessionId, env = process.env } = {}) {
  if (env.AOS_A2A_NAME) return validName(env.AOS_A2A_NAME);
  const raw = String(sessionId ?? "").toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return validName(`${String(harness).toLowerCase()}-${raw.slice(0, 8)}`);
}

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

export function ensureSidecar({
  harness,
  sessionId,
  parentPid,
  env = process.env,
  spawnImpl = spawn,
  binPath,
} = {}) {
  try {
    if (env.AOS_A2A_SIDECAR === "off") return { skipped: "off" };
    if (Number(env.AOS_DELEGATE_DEPTH || 0) > 0) return { skipped: "depth" };

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

    const args = [binPathStr, "serve", "--name", name, "--harness", String(harness), "--mode", "live", "--parent-pid", String(parentPid)];
    const child = spawnImpl(process.execPath, args, { detached: true, stdio: "ignore", env: cleanEnv(env) });
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
