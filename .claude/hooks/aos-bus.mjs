#!/usr/bin/env node
// aos-bus spike: master -> running OpenCode session via per-session inbox files.
// Library + CLI. The receiver (OpenCode plugin) injects each message as a synthetic part.

import {
  chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { slug } from "./go-gate.mjs";

const MAX_SEND = 8 * 1024;
const MAX_FILE = 16 * 1024;

export function busPaths(name) {
  const n = slug(String(name ?? ""));
  if (!n || n.startsWith(".")) throw new Error("invalid session name");
  const root = join(homedir(), ".aos", "bus");
  return { name: n, root, sessions: join(root, "sessions"), reg: join(root, "sessions", `${n}.json`), inbox: join(root, "inbox", n) };
}

export function ensurePrivateDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

// Returns null when usable, else the refusal reason.
export function checkPrivateDir(dir) {
  let st;
  try { st = lstatSync(dir); } catch { return `${dir} does not exist`; }
  if (!st.isDirectory()) return `${dir} is not a real directory`;
  if (st.uid !== process.getuid()) return `${dir} is not owned by the current user`;
  if (st.mode & 0o077) return `${dir} is accessible to others (mode ${(st.mode & 0o777).toString(8)})`;
  return null;
}

export function registerSession({ name, sessionID, cwd }) {
  const p = busPaths(name);
  ensurePrivateDir(join(p.root, "inbox"));
  ensurePrivateDir(p.sessions);
  ensurePrivateDir(p.inbox);
  writeFileSync(p.reg, JSON.stringify({ name: p.name, harness: "opencode", pid: process.pid, cwd, sessionID, inbox: p.inbox, ts: Date.now() }), { mode: 0o600 });
  return p.name;
}

export function unregisterSession(name, pid = process.pid) {
  try {
    const p = busPaths(name);
    if (JSON.parse(readFileSync(p.reg, "utf8")).pid === pid) unlinkSync(p.reg);
  } catch { /* already gone */ }
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

export function listSessions() {
  const dir = join(homedir(), ".aos", "bus", "sessions");
  const out = [];
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { /* none */ }
  for (const f of files) {
    try {
      const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (Number.isInteger(r.pid) && alive(r.pid)) out.push(r);
    } catch { /* corrupt entry */ }
  }
  return out;
}

// Throws with the refusal reason; returns the message file path.
export function sendMessage(name, text, { from, wake = false } = {}) {
  const p = busPaths(name);
  if (!listSessions().some((s) => s.name === p.name)) throw new Error(`session "${p.name}" is not registered or not alive`);
  const bad = checkPrivateDir(p.inbox);
  if (bad) throw new Error(bad);
  text = String(text ?? "");
  if (Buffer.byteLength(text) > MAX_SEND) throw new Error(`message exceeds ${MAX_SEND} bytes`);
  from ||= process.env.AOS_SESSION_NAME || `${userInfo().username}:${process.ppid}`;
  const base = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  const tmp = join(p.inbox, `${base}.tmp`);
  const file = join(p.inbox, `${base}.json`);
  writeFileSync(tmp, JSON.stringify({ v: 1, from, text, ts: Date.now(), ...(wake ? { wake: true } : {}) }), { mode: 0o600 });
  renameSync(tmp, file);
  return file;
}

export function readInbox(name) {
  const p = busPaths(name);
  if (checkPrivateDir(p.inbox)) return [];
  const out = [];
  for (const f of readdirSync(p.inbox).filter((x) => x.endsWith(".json")).sort()) {
    const file = join(p.inbox, f);
    try {
      const st = lstatSync(file);
      if (!st.isFile() || st.uid !== process.getuid() || st.size > MAX_FILE) throw new Error("rejected");
      const m = JSON.parse(readFileSync(file, "utf8"));
      if (typeof m?.text !== "string") throw new Error("rejected");
      const from = String(m.from ?? "").replace(/[\x00-\x1f\x7f\]]/g, "").slice(0, 64) || "unknown";
      out.push({ file, from, text: m.text, wake: m.wake === true, uid: st.uid, ts: Number.isFinite(m.ts) ? m.ts : undefined, mtimeMs: st.mtimeMs });
    } catch {
      try { renameSync(file, `${file}.rejected`); } catch { /* gone */ }
    }
  }
  return out;
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };

if (isMain()) {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = {}; const words = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--from") opts.from = rest[++i];
    else if (rest[i] === "--wake") opts.wake = true;
    else words.push(rest[i]);
  }
  try {
    if (cmd === "send" && words.length >= 2) {
      console.log(sendMessage(words[0], words.slice(1).join(" "), opts));
    } else if (cmd === "list") {
      for (const s of listSessions()) console.log(`${s.name}\tpid ${s.pid}\t${s.cwd}`);
    } else {
      console.error("usage: aos-bus send <name> <text...> [--from x] [--wake] | aos-bus list");
      process.exit(2);
    }
  } catch (e) {
    console.error(`aos-bus: ${e.message}`);
    process.exit(2);
  }
}
