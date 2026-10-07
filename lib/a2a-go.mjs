// Headless GO over A2A: the executor publishes TASK_STATE_AUTH_REQUIRED for a guarded action
// and a follow-up message with metadata.aos.goRef can resume the task. A GO counts only with
// a reference that was minted OUTSIDE any agent (today: the go-token.mjs hook after the human
// typed `GO <session>` in the master window; later: a Touch ID/WebAuthn receipt). The plain
// text "GO" in any A2A message never counts. This module TRANSPORTS and CHECKS references:
// it verifies and consumes them through bin/go-check.mjs (execFile, argument array, no shell)
// and never creates, extends or rewrites a token. Verify is read-only; consume is the gate's
// own single-use write.
import { promisify } from "node:util";
import crypto from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const goCheckPath = () => join(here, "..", "bin", "go-check.mjs");

// Short, opaque id of the pending action, shown to the human so they can see what is blocked.
export const actionHash = (action) => crypto.createHash("sha256").update(String(action ?? "")).digest("hex").slice(0, 12);

export const AUTH_REQUIRED_MARKER = "AOS-AUTH-REQUIRED:";

// The marker a worker output may carry: `AOS-AUTH-REQUIRED: <action text>` (first match wins,
// action text capped). Never contains any token or reference.
export const authRequiredFrom = (text) => {
  const m = /^[ \t]*AOS-AUTH-REQUIRED:[ \t]*(\S(?:.*\S)?)[ \t]*$/m.exec(String(text ?? ""));
  return m ? m[1].slice(0, 200) : null;
};

// Status text for TASK_STATE_AUTH_REQUIRED: names the session, shows the action hash and the
// instruction. NO token value, NO reference ever appears here.
export function authRequiredMessage({ taskId, session, action }) {
  const act = String(action ?? "").trim().slice(0, 200);
  return [
    `This task is blocked pending a human GO for the headless session "${session}".`,
    `Pending action: ${act}`,
    `Action hash: ${actionHash(act)} (task ${taskId})`,
    `The text "GO" in any message here never counts. To approve: type \`GO ${session}\` in the master window, then send the printed reference with \`aos-a2a send --task ${taskId} --go-ref <ref>\`.`,
  ].join("\n");
}

// ONLY for logging and dropping: such text never leads to approval by itself.
export const isGoText = (t) => /^\s*GO\b/i.test(typeof t === "string" ? t : "");

const reasonOf = (raw) => {
  const r = String(raw ?? "");
  if (/expired/i.test(r)) return "expired";
  if (/already used/i.test(r)) return "replayed";
  if (/another session/i.test(r)) return "wrong-target";
  if (/forged/i.test(r)) return "forged";
  if (/malformed/i.test(r)) return "malformed";
  return r || "go-check failed";
};

const runCheck = ({ session, ref, storeDir = "", consume = false }) => {
  const env = { ...process.env };
  if (storeDir) {
    env.HOME = storeDir; // test seam: point the store at a temp directory
    env.USERPROFILE = storeDir;
    env.XDG_DATA_HOME = join(storeDir, ".xdg");
  }
  const args = [goCheckPath(), "--session", String(session ?? ""), "--ref", String(ref ?? "")];
  if (consume) args.push("--consume");
  return run(process.execPath, args, { env, timeout: 10000, windowsHide: true })
    .then(
      ({ stdout }) => {
        let out;
        try { out = JSON.parse(stdout); } catch { return { ok: false, reason: "malformed" }; }
        if (!out || typeof out.ok !== "boolean") return { ok: false, reason: "malformed" };
        return out.ok ? { ok: true, reason: reasonOf(out.reason) } : { ok: false, reason: reasonOf(out.reason) };
      },
      (e) => {
        let out;
        try { out = JSON.parse(String(e?.stdout ?? "")); } catch { /* real failure below */ }
        if (out && typeof out.ok === "boolean") return { ok: false, reason: reasonOf(out.reason) };
        return { ok: false, reason: "go-check failed" };
      },
    );
};

// Read-only: never consumes, never writes.
export const verifyGoRef = ({ session, ref, storeDir }) => runCheck({ session, ref, storeDir, consume: false });
// Single use: ok only for the first valid call.
export const consumeGoRef = ({ session, ref, storeDir }) => runCheck({ session, ref, storeDir, consume: true });
