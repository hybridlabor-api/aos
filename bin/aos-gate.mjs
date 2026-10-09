#!/usr/bin/env node
import { openSync, writeSync, closeSync, renameSync, mkdirSync, constants as K } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { readProfile, LIMITS, PROFILES } from "../lib/gate-profile.mjs";

export const HARNESS_ENV = ["CLAUDE_SESSION_ID", "CLAUDECODE", "OPENCODE", "CODEX_SANDBOX", "CODEX_SESSION_ID", "AGY_SESSION_ID", "ANTIGRAVITY_SESSION_ID"];
const WORDS = ["amber", "birch", "cobalt", "delta", "ember", "falcon", "garnet", "harbor", "indigo", "juniper", "kestrel", "lantern", "marble", "nectar", "onyx", "pebble"];

// ~/.aos/gate unless AOS_GATE_DIR is honoured (container sandbox or explicit test flag only)
export function gateDir(env = process.env, testFlag = false) {
  if (env.AOS_GATE_DIR && (env.AOS_TEST_SANDBOX === "container" || testFlag)) return env.AOS_GATE_DIR;
  return join(homedir(), ".aos/gate");
}

export function parseDuration(s) {
  const m = /^(\d+)(m|h)$/.exec(s ?? "");
  if (!m || +m[1] <= 0) return null;
  return +m[1] * (m[2] === "h" ? 3600000 : 60000);
}

// STUB: Touch ID via the WP-9 credential. Not wired into setProfile.
export function touchId() { throw new Error("Touch ID confirmation not enabled until WP-9"); }

export function writeConfig(dir, cfg) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `.config.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  const fd = openSync(tmp, K.O_WRONLY | K.O_CREAT | K.O_EXCL, 0o600);
  try { writeSync(fd, JSON.stringify(cfg, null, 2) + "\n"); } finally { closeSync(fd); }
  renameSync(tmp, join(dir, "config.json"));
}

export function status({ dir, now = Date.now(), out }) {
  const r = readProfile({ file: join(dir, "config.json"), now });
  const left = r.remaining_ms != null ? `${Math.ceil(r.remaining_ms / 60000)} min left` : "no expiry";
  out(`profile: ${r.profile} (${left})`);
  if (r.reason) out(`note: ${r.reason}`);
  if (r.set_at) out(`last change: ${r.set_at}${r.set_by ? ` by ${r.set_by.method}` : ""}`);
  return 0;
}

export async function setProfile({ dir, profile, forArg, env = process.env, stdin = process.stdin, stdout = process.stdout, now = Date.now(), ask, err }) {
  if (!PROFILES.includes(profile)) { err("usage: aos-gate profile strict|work|off [--for 4h]"); return 2; }
  if (!stdin.isTTY || !stdout.isTTY) { err("refused: needs a terminal on stdin and stdout"); return 1; }
  const h = HARNESS_ENV.find((k) => env[k]);
  if (h) { err(`refused: harness session detected (${h})`); return 1; }
  let ms = null;
  if (profile !== "strict") {
    const L = LIMITS[profile];
    ms = forArg === undefined ? L.defaultMs : parseDuration(forArg);
    if (ms === null) { err("refused: bad --for value (use e.g. 90m or 4h)"); return 2; }
    if (ms > L.maxMs) { err(`refused: ${profile} max is ${L.maxMs / 3600000}h`); return 1; }
    const word = WORDS[randomBytes(1)[0] % WORDS.length] + "-" + randomBytes(2).toString("hex");
    stdout.write(`Loosening gate to '${profile}'. Type this to confirm: ${word}\n`);
    const typed = String(await ask(word)).trim();
    if (typed !== word) { err("refused: confirmation does not match"); return 1; }
  }
  writeConfig(dir, {
    version: 1, profile, set_at: new Date(now).toISOString(),
    expires_at: ms === null ? null : new Date(now + ms).toISOString(),
    set_by: { uid: process.getuid(), method: "typed" },
  });
  stdout.write(`profile set: ${profile}\n`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, a, ...rest] = process.argv.slice(2);
  const dir = gateDir();
  const err = (m) => console.error(m);
  if (cmd === "status") process.exit(status({ dir, out: console.log }));
  else if (cmd === "profile") {
    const i = rest.indexOf("--for");
    const rl = createInterface({ input: process.stdin });
    const lines = rl[Symbol.asyncIterator]();
    const code = await setProfile({ dir, profile: a, forArg: i >= 0 ? rest[i + 1] : undefined, ask: async () => (await lines.next()).value ?? "", err });
    rl.close();
    process.exit(code);
  } else { err("usage: aos-gate status | profile strict|work|off [--for 4h]"); process.exit(2); }
}
