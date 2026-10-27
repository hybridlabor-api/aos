#!/usr/bin/env node
// A2A inbox hook for Claude Code. `drain` = UserPromptSubmit, `stop` = Stop.
// Messages from other agents are injected as context only; they never count as a GO.
import { existsSync, readFileSync, fstatSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const mode = process.argv[2];

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

async function readInput() {
  try {
    return JSON.parse((await readStdinBounded(1500)) ?? "");
  } catch {
    return {};
  }
}

// Checkout layout (../../lib), else the machine-wide copy the installer keeps under ~/.agents/lib.
function libPath() {
  const here = fileURLToPath(new URL("../../lib/a2a-inbox.mjs", import.meta.url));
  return [here, join(homedir(), ".agents", "lib", "a2a-inbox.mjs")].find((p) => existsSync(p)) ?? null;
}

async function main() {
  const lib = libPath();
  if (!lib) {
    process.stderr.write("a2a-inbox: lib/a2a-inbox.mjs not found (checkout ../../lib or ~/.agents/lib); hook skipped.\n");
    return 0;
  }
  const input = await readInput();
  const session =
    process.env.AOS_A2A_NAME || `claude-${String(input.session_id || "").slice(0, 8)}`;
  const { pending, claim, formatInjection, replyCommand, safeField } = await import(pathToFileURL(lib).href);
  if (mode === "stop" && input.stop_hook_active === true) return 0; // already nudged once: claim nothing
  const waiting = pending(session);
  if (!waiting.length) return 0;

  // claim every pending message and render it with its reply command (absolute path when aos-a2a is not on PATH,
  // always with --name <session>: a harness shell often has no AOS_A2A_NAME and a model would invent one)
  const texts = [];
  for (const m of waiting) {
    const msg = claim(m.file);
    if (!msg) continue;
    const taskId = safeField(msg.taskId);
    if (!taskId) continue;
    texts.push(`${formatInjection({ ...msg, from: safeField(msg.from) || "unknown" })}\nAnswer by running: ${replyCommand(taskId, undefined, undefined, session)}`);
  }
  if (!texts.length) return 0;

  if (mode === "drain") {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: texts.join("\n\n") },
      }) + "\n",
    );
    return 0;
  }

  // Stop: a message arrived while the turn was running. Hand it over once (it is claimed now) so the
  // turn continues and answers it; stop_hook_active prevents a second block for the same stop.
  if (mode === "stop" && input.stop_hook_active !== true) {
    process.stderr.write(`A2A message(s) arrived during this turn. Answer each one:\n\n${texts.join("\n\n")}\n`);
    return 2;
  }
  return 0;
}

// Hard wall-clock budget: ~70 % of this hook's 5 s timeout; past it, exit 0 with nothing claimed or printed (claim and
// print run synchronously together, so the timer never fires between them).
setTimeout(() => process.exit(0), 3500 - process.uptime() * 1000).unref();
main().then(
  (code) => process.exit(code),
  () => process.exit(0),
);
