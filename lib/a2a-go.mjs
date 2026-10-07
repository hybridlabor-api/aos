// Headless GO over A2A: the executor publishes TASK_STATE_AUTH_REQUIRED for a guarded action
// and a follow-up message with metadata.aos.goRef can resume the task. A GO counts only with
// a reference that was minted OUTSIDE any agent (today: the go-token.mjs hook after the human
// typed `GO <session>` in the master window; later: a Touch ID/WebAuthn receipt). The plain
// text "GO" in any A2A message never counts.
//
// This module only TRANSPORTS and VERIFIES references: verification shells out (execFile with
// an ARGS ARRAY, no shell) to `node bin/go-check.mjs --ref <id> --session <name>` in VERIFY-ONLY
// mode; never any consume. The reference is a POINTER to the session's token file — not a
// secret, and not proof of approval of any particular task or action. Authority stays with the
// target session's OWN go-gate: it consumes the real single-use token when the guarded command
// actually runs, and only with that consumed token the same reference stops verifying (replay
// denied naturally). The sidecar therefore never consumes a GO and never tells a model that
// anything here is a GO.
import { promisify } from "node:util";
import crypto from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { validName } from "./a2a-registry.mjs";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const goCheckPath = () => join(here, "..", "bin", "go-check.mjs");

// Short, opaque id of the pending action, shown to the human so they can see what is blocked.
export const actionHash = (action) => crypto.createHash("sha256").update(String(action ?? "")).digest("hex").slice(0, 12);

export const AUTH_REQUIRED_MARKER = "AOS-AUTH-REQUIRED:";

// The marker a worker's STDOUT may carry: `AOS-AUTH-REQUIRED: <action text>` accepted ONLY as
// the last non-empty line of the passed text (a worker echoing message text must not be able to
// open auth-required with chosen action text). The caller decides what is passed in: the spawn
// executor passes stdout only, never stderr. The action text is stripped of control characters
// and capped at 200 chars. Never contains any token or reference.
export const authRequiredFrom = (text) => {
  const lines = String(text ?? "").split(/\r?\n/);
  let last = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t) { last = t; break; }
  }
  const m = /^[ \t]*AOS-AUTH-REQUIRED:[ \t]*(\S(?:.*\S)?)[ \t]*$/.exec(last);
  if (!m) return null;
  return m[1].replace(/[\x00-\x1f\x7f]/g, "").slice(0, 200);
};

// Status text for TASK_STATE_AUTH_REQUIRED: names the session, shows the action hash and the
// instruction. NO token value, NO reference ever appears here.
export function authRequiredMessage({ taskId, session, action }) {
  const act = String(action ?? "").trim().slice(0, 200);
  return [
    `This task is blocked pending a human GO for the headless session "${session}".`,
    `Pending action: ${act}`,
    `Action hash: ${actionHash(act)} (task ${taskId})`,
    `The text "GO" in any message here never counts. To approve: type \`GO ${session}\` in the master window, then send the printed reference with \`aos-a2a send --task ${taskId} --go-ref <ref>\`. The reference is forwarded by the master session that printed it.`,
  ].join("\n");
}

// ONLY for logging and dropping: such text never leads to approval by itself.
export const isGoText = (t) => /^\s*GO\b/i.test(typeof t === "string" ? t : "");

// A1: an A2A caller's name is unvalidated by the SDK, so any peer could forge a
// trusted-looking caller. A caller whose name starts with `human` or `aos-`, or that does not
// pass validName, is treated as `unknown` — never as a human or an AOS component.
export const sanitiseCaller = (name) => {
  let n = "";
  try { n = validName(String(name ?? "").trim().toLowerCase()); } catch { return "unknown"; }
  return /^human|^aos-/.test(n) ? "unknown" : n;
};

const reasonOf = (raw) => {
  const r = String(raw ?? "");
  if (/expired/i.test(r)) return "expired";
  if (/already used/i.test(r)) return "replayed";
  if (/another session/i.test(r)) return "wrong-target";
  if (/forged/i.test(r)) return "forged";
  if (/malformed/i.test(r)) return "malformed";
  return r || "go-check failed";
};

const runCheck = ({ session, ref, storeDir = "" }) => {
  const env = { ...process.env };
  if (storeDir) {
    env.HOME = storeDir; // test seam: point the store at a temp directory
    env.USERPROFILE = storeDir;
    env.XDG_DATA_HOME = join(storeDir, ".xdg");
  }
  const args = [goCheckPath(), "--ref", String(ref ?? ""), "--session", String(session ?? "")];
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

// Read-only: never consumes, never writes. Verification succeeds again and again until the
// session's own gate consumed the token behind the reference.
export const verifyGoRef = ({ session, ref, storeDir }) => runCheck({ session, ref, storeDir });
// No consume function is exported here on purpose: the executors must not consume a GO, and the
// real token's single use is enforced by the target session's own gate (go-gate.mjs).
