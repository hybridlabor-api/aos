#!/usr/bin/env node
// agy PreInvocation hook: delivers pending A2A messages into an INTERACTIVE agy session, never mid-turn.
// Verified on agy 1.3.0: PreInvocation fires before EVERY model call; payload.invocationNum is 0 for the first
// call after a user prompt and counts up within the turn (resets to 0 on the next prompt of the same conversation).
// Only invocationNum 0 drains, so a message never lands in the middle of a running turn. Output contract:
// {"injectSteps":[{"ephemeralMessage":"<text>"}]}, {"injectSteps":[]} means no-op. Inbound text is context only
// and never counts as a GO. Fail-open: any problem prints the no-op and exits 0. This hook never spawns agy.
import { execFileSync } from "node:child_process";
import { readFileSync, fstatSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NOOP = JSON.stringify({ injectSteps: [] });
const done = (out = NOOP) => { process.stdout.write(out + "\n"); process.exit(0); };

// Bounded stdin read, same as rules-inject.mjs readStdinBounded: an open stdin pipe (Codex on Windows) must not hang
// the hook. Stops on end, first complete JSON, byte cap or timeout; null = nothing read before a timeout or an error.
function readStdinBounded(maxMs, maxBytes = 64 << 20) {
  // A regular file or directory never blocks: read it at once. A read error (EISDIR, closed fd) is null, which go-gate denies.
  let st;
  try { st = fstatSync(0); } catch { return Promise.resolve(null); }
  if (st.isFile() || st.isDirectory()) { try { return Promise.resolve(readFileSync(0, "utf8")); } catch { return Promise.resolve(null); } }
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let buf = "";
    let settled = false;
    const finish = (incomplete) => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      // pause() alone keeps an open pipe ref'd: a hook that ends without process.exit (a2a-session) would hang.
      try { process.stdin.pause(); process.stdin.unref?.(); } catch {}
      resolve(incomplete === true && !buf ? null : buf);
    };
    const to = setTimeout(finish, maxMs, true);
    if (to.unref) to.unref();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
      if (buf.length >= maxBytes) return finish();
      if (buf.trimEnd().endsWith("}")) try { JSON.parse(buf); finish(); } catch {}
    });
    process.stdin.on("end", finish);
    process.stdin.on("error", () => finish(true));
    process.stdin.resume();
  });
}

let input = {};
try { input = JSON.parse((await readStdinBounded(1500)) ?? ""); } catch { done(); }

async function lib(file) {
  const candidates = [new URL(`../lib/${file}`, import.meta.url), pathToFileURL(join(homedir(), ".agents", "lib", file))];
  for (const c of candidates) { try { return await import(c); } catch { /* try the next location */ } }
  return null;
}

// agy runs hooks through `sh -c`, so process.ppid is a short-lived shell: walk up to the agy process itself,
// otherwise the sidecar (which exits when its parent pid is gone) would stop seconds after it started.
function agyPid() {
  let pid = process.ppid;
  for (let i = 0; i < 6 && pid > 1; i++) {
    try {
      const [ppid, ...comm] = execFileSync("ps", ["-o", "ppid=,comm=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\s+/);
      if (/agy/i.test(comm.join(" "))) return pid;
      pid = Number(ppid);
    } catch { break; }
  }
  return process.ppid;
}

try {
  const inbox = await lib("a2a-inbox.mjs");
  const sess = await lib("a2a-session.mjs");
  if (!inbox || !sess) done();
  const conv = String(input.conversationId || "");
  // the peer name the human chose (AOS_A2A_NAME, e.g. agy-researcher) or agy-<first 8 chars of the conversation id>
  const name = sess.sessionName({ harness: "agy", sessionId: conv, env: process.env });
  // Everything this hook loads or starts resolves the same identity (the sidecar also gets it in its env).
  process.env.AOS_A2A_NAME = name;
  // Audit phonebook: agy labels are automatic from the workspace name (payload all opaque); a
  // hand-set AOS_A2A_LABEL wins, and a rename (cwd change) updates the auto label here.
  const title = sess.sessionTitleOf ? sess.sessionTitleOf({ harness: "agy", payload: input, env: process.env, cwd: process.cwd() }) : undefined;
  // Register this session as a peer once per name (idempotent; skipped under AOS_A2A_SIDECAR=off). No explicit mode:
  // agy defaults to the resume executor (`--mode agy`), which answers while this chat sits idle and claims the inbox
  // note itself; AOS_A2A_AGY_MODE=live switches back to the inbox drained below at the next typed prompt.
  sess.ensureSidecar({ harness: "agy", sessionId: conv, parentPid: agyPid(), env: process.env, title });
  if (input.invocationNum !== 0) done(); // mid-turn model call: queue, never inject
  const texts = [];
  // the bus inbox <AOS_BUS_ROOT or ~/.aos/bus>/a2a/<name>; the reply dir (~/.aos/a2a-inbox) never holds inbound messages
  for (const m of inbox.pending(name)) {
    const msg = inbox.claim(m.file);
    if (!msg) continue;
    texts.push(`${inbox.formatInjection(msg)}\nAnswer by running: ${inbox.replyCommand(msg.taskId, undefined, "", name)}`);
  }
  if (!texts.length) done();
  // The session has no other way to learn its own peer name: spell it and the inbox once per delivery.
  // (messages are already claimed here, so nothing below may throw: an older installed lib may lack inboxDir)
  const dir = typeof inbox.inboxDir === "function" ? `; your inbox is ${inbox.inboxDir(name)}` : "";
  const who = `Your A2A peer name is ${name}${dir}. Answer each message with its own "Answer by running" command (it already carries --name ${name}).`;
  done(JSON.stringify({ injectSteps: [{ ephemeralMessage: `${texts.join("\n\n")}\n${who}` }] }));
} catch {
  done();
}
