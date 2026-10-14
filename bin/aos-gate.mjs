#!/usr/bin/env node
import { openSync, writeSync, closeSync, renameSync, mkdirSync, readFileSync, constants as K } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readProfile, LIMITS, PROFILES } from "../lib/gate-profile.mjs";

export const HARNESS_ENV = ["CLAUDE_SESSION_ID", "CLAUDECODE", "OPENCODE", "CODEX_SANDBOX", "CODEX_SESSION_ID", "AGY_SESSION_ID", "ANTIGRAVITY_SESSION_ID"];

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

// STUB: Touch ID via the WP-9 credential.
export function touchId() { throw new Error("Touch ID confirmation not enabled until WP-9"); }

export function writeConfig(dir, cfg) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `.config.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  const fd = openSync(tmp, K.O_WRONLY | K.O_CREAT | K.O_EXCL, 0o600);
  try { writeSync(fd, JSON.stringify(cfg, null, 2) + "\n"); } finally { closeSync(fd); }
  renameSync(tmp, join(dir, "config.json"));
}

export function status({ dir, now = Date.now(), out = console.log }) {
  const r = readProfile({ file: join(dir, "config.json"), now });
  const left = r.remaining_ms != null ? `${Math.ceil(r.remaining_ms / 60000)} min left` : "no expiry";
  out(`profile: ${r.profile} (${left})`);
  if (r.reason) out(`note: ${r.reason}`);
  if (r.set_at) out(`last change: ${r.set_at}${r.set_by ? ` by ${r.set_by.method}` : ""}`);
  if (r.grants && r.grants.length > 0) {
    out("active global grants:");
    for (const g of r.grants) {
      const gLeft = Math.ceil((g.until - now) / 60000);
      out(`  grant ${g.scope} (${gLeft} min left)`);
    }
  }
  return 0;
}

export async function setProfile({
  dir,
  profile,
  forArg,
  env = process.env,
  stdin = process.stdin,
  stdout = process.stdout,
  now = Date.now(),
  ask,
  err = (m) => console.error(m),
  out,
}) {
  const printOut = out ?? ((s) => (stdout?.write ? stdout.write(s) : console.log(s)));
  if (!PROFILES.includes(profile)) { err("usage: aos-gate profile strict|work [--for 4h]"); return 2; }
  let ms = null;
  if (profile !== "strict") {
    const L = LIMITS[profile];
    ms = forArg === undefined ? L.defaultMs : parseDuration(forArg);
    if (ms === null) { err("refused: bad --for value (use e.g. 90m or 4h)"); return 2; }
    if (ms > L.maxMs) { err(`refused: ${profile} max is ${L.maxMs / 3600000}h`); return 1; }
  }
  let existing = {};
  try {
    const cfgPath = join(dir, "config.json");
    existing = JSON.parse(readFileSync(cfgPath, "utf8"));
  } catch {}
  const grants = Array.isArray(existing.grants)
    ? existing.grants.filter((g) => {
        const exp = typeof g.expires_at === "string" ? Date.parse(g.expires_at) : (typeof g.until === "string" ? Date.parse(g.until) : NaN);
        return Number.isFinite(exp) && exp > now;
      })
    : [];
  writeConfig(dir, {
    version: 1,
    profile,
    set_at: new Date(now).toISOString(),
    expires_at: ms === null ? null : new Date(now + ms).toISOString(),
    set_by: { uid: process.getuid?.() ?? null, method: "cli" },
    grants,
  });
  printOut(`profile set: ${profile}\n`);
  return 0;
}

export function setGrant({
  dir,
  scopes,
  duration,
  now = Date.now(),
  stdout = process.stdout,
  out,
  err = (m) => console.error(m),
}) {
  const printOut = out ?? ((s) => (stdout?.write ? stdout.write(s) : console.log(s)));
  const list = (Array.isArray(scopes) ? scopes : String(scopes || "").split(",")).map((s) => s.trim()).filter(Boolean);
  if (!list.length) { err("usage: aos-gate grant <scope[,scope...]> [duration]"); return 2; }
  const ms = duration !== undefined ? parseDuration(duration) : (2 * 3600 * 1000);
  if (ms === null) { err("refused: bad duration value (use e.g. 30m, 2h, 4h)"); return 2; }
  if (ms > 24 * 3600 * 1000) { err("refused: grant max is 24h"); return 1; }

  let existing = {};
  try {
    const cfgPath = join(dir, "config.json");
    existing = JSON.parse(readFileSync(cfgPath, "utf8"));
  } catch {}

  const prof = existing.profile && PROFILES.includes(existing.profile) ? existing.profile : "work";
  const setAt = existing.set_at || new Date(now).toISOString();
  const expAt = existing.expires_at || (prof === "work" ? new Date(now + LIMITS.work.defaultMs).toISOString() : null);

  const oldGrants = (Array.isArray(existing.grants) ? existing.grants : []).filter((g) => {
    const exp = typeof g.expires_at === "string" ? Date.parse(g.expires_at) : (typeof g.until === "string" ? Date.parse(g.until) : NaN);
    return Number.isFinite(exp) && exp > now && !list.includes(g.scope);
  });

  const expIso = new Date(now + ms).toISOString();
  for (const sc of list) {
    oldGrants.push({ scope: sc, set_at: new Date(now).toISOString(), expires_at: expIso, until: expIso });
  }

  writeConfig(dir, {
    version: 1,
    profile: prof,
    set_at: setAt,
    expires_at: expAt,
    set_by: { uid: process.getuid?.() ?? null, method: "cli" },
    grants: oldGrants,
  });
  printOut(`grant set: ${list.join(", ")} (${Math.ceil(ms / 60000)} min)\n`);
  return 0;
}

export function revokeGrant({
  dir,
  scope = "all",
  now = Date.now(),
  stdout = process.stdout,
  out,
  err = (m) => console.error(m),
}) {
  const printOut = out ?? ((s) => (stdout?.write ? stdout.write(s) : console.log(s)));
  let existing = {};
  try {
    const cfgPath = join(dir, "config.json");
    existing = JSON.parse(readFileSync(cfgPath, "utf8"));
  } catch {}

  const list = String(scope || "").split(",").map((s) => s.trim()).filter(Boolean);
  const grants = (Array.isArray(existing.grants) ? existing.grants : []).filter((g) => {
    if (scope === "all") return false;
    return !list.includes(g.scope);
  });

  writeConfig(dir, {
    ...existing,
    version: 1,
    profile: existing.profile && PROFILES.includes(existing.profile) ? existing.profile : "work",
    set_at: existing.set_at || new Date(now).toISOString(),
    expires_at: existing.expires_at ?? null,
    grants,
  });
  printOut(`grant revoked: ${scope}\n`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, a, ...rest] = process.argv.slice(2);
  const dir = gateDir();
  const err = (m) => console.error(m);
  if (cmd === "status") {
    process.exit(status({ dir, out: console.log }));
  } else if (cmd === "profile") {
    const i = rest.indexOf("--for");
    const forArg = i >= 0 ? rest[i + 1] : undefined;
    const code = await setProfile({ dir, profile: a, forArg, err });
    process.exit(code);
  } else if (cmd === "work" || cmd === "strict") {
    const forArg = a === "--for" ? rest[0] : rest.includes("--for") ? rest[rest.indexOf("--for") + 1] : undefined;
    const code = await setProfile({ dir, profile: cmd, forArg, err });
    process.exit(code);
  } else if (cmd === "grant") {
    const code = setGrant({ dir, scopes: a, duration: rest[0], err });
    process.exit(code);
  } else if (cmd === "revoke") {
    const code = revokeGrant({ dir, scope: a || "all", err });
    process.exit(code);
  } else {
    err("usage: aos-gate status | profile strict|work [--for 4h] | grant <scope> [duration] | revoke <scope>");
    process.exit(2);
  }
}
