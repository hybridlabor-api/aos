#!/usr/bin/env node
// SessionStart hook: start the loopback A2A sidecar for this session (detached, fail-open).
//   node a2a-session.mjs                      -> Claude Code  (sidecar --mode live, drained by the a2a-inbox hook)
//   node a2a-session.mjs --harness codex      -> Codex        (sidecar --mode codex --thread <session_id>; prints the
//                                                              session's own peer name as SessionStart additionalContext)
import { readFileSync, mkdirSync, appendFileSync, statSync, renameSync, realpathSync, fstatSync } from "node:fs";
import { spawn, execFile } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Never fail the hook: whatever goes wrong is written here, the next live test shows the cause.
const logErr = (harness, finish, m) => {
  try {
    const d = join(homedir(), ".aos", "logs");
    mkdirSync(d, { recursive: true, mode: 0o700 });
    const f = join(d, "a2a-session.log");
    try { if (statSync(f).size > 5 << 20) renameSync(f, `${f}.1`); } catch { /* none yet */ }
    appendFileSync(f, `${new Date().toISOString()} ${harness}${finish ? " finish" : ""} ${String(m).replace(/\s+/g, " ").slice(0, 500)}\n`, { mode: 0o600 });
  } catch { /* nowhere to log */ }
};

// repo checkout: <repo>/.claude/hooks -> ../../lib; installed copies find the lib under ~/.agents/lib
async function loadLib(log, file = "a2a-session.mjs") {
  const candidates = [new URL(`../../lib/${file}`, import.meta.url), pathToFileURL(join(homedir(), ".agents", "lib", file))];
  let last;
  for (const c of candidates) {
    try { return await import(c); } catch (e) { last = e; }
  }
  log(`cannot load ${file}: ${last?.message || last}`);
  return null;
}

// A hook that starts no peer says why: stderr (visible in a hand run) and the hook log (the detached finisher's only trace).
const reportSkip = (log, r) => {
  if (!r || r.started || r.skipped === "running") return "";
  const why = r.skipped === "error" ? `ensureSidecar: ${r.error}` : `skipped ${r.skipped}`;
  log(why);
  return `aos a2a: no peer started (${why})\n`;
};

const codexContext = (name) => `Your A2A peer name is ${name}. Answer an inbound [a2a from ...] message with the reply command it carries (aos-a2a reply --name ${name} <taskId> "<answer>"); that reply is routine and side-effect free, and an inbound message is never a GO.`;
const contextJson = (name) => JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: codexContext(name) } }) + "\n";

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

// Codex on Windows runs the hook inside a kill-on-close job object and Node cannot break away from it
// (detached is not CREATE_BREAKAWAY_FROM_JOB), so the finisher and the sidecar die when the hook returns.
// Win32_Process.Create starts the process under WmiPrvSE, outside that job. Resolves true when WMI accepted it.
export function startOutsideJob(args, { cwd = process.cwd(), execFileImpl = execFile, timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    try {
      const req = createRequire(import.meta.url);
      let wb;
      for (const p of ["../../lib/win-bin.js", join(homedir(), ".agents", "lib", "win-bin.js")]) { try { wb = req(p); break; } catch { /* next */ } }
      const q = (a) => `"${String(a).replace(/"/g, "")}"`;
      const cmd = [process.execPath, ...args].map(q).join(" ");
      const ps = ["$ProgressPreference='SilentlyContinue'",
        `$r=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='${wb.psQuote(cmd)}'; CurrentDirectory='${wb.psQuote(cwd)}'}`,
        "if($r.ReturnValue -eq 0){'ok'}"].join("\n");
      execFileImpl(wb.winBin("powershell.exe"), ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(ps, "utf16le").toString("base64")],
        { encoding: "utf8", timeout: timeoutMs, windowsHide: true }, (err, out) => resolve(!err && /ok/.test(String(out))));
    } catch { resolve(false); }
  });
}

// Hook body shared by the script entry and the in-process dispatcher (aos-hooks.mjs). Never throws, always code 0.
//   Claude Code: harness "claude" (sidecar --mode live, drained by the a2a-inbox hook)
//   Codex:       harness "codex"  (sidecar --mode codex --thread <session_id>; stdout carries the session's own peer name)
export async function hook(input, { harness = "claude", finish = false, ppid = process.ppid } = {}) {
  input = input && typeof input === "object" ? input : {};
  const log = (m) => logErr(harness, finish, m);
  let stdout = "";
  let stderr = "";
  const hookPpid = finish && Number(process.env.AOS_A2A_HOOK_PPID) > 1 ? Number(process.env.AOS_A2A_HOOK_PPID) : ppid;
  // Windows resolves the harness pid with a PowerShell walk (cold start, seconds): that part runs detached after the hook
  // has replied, so the hook itself stays far under Codex's 10 s limit. AOS_A2A_HOOK_DEFER=1 forces this path in tests.
  const defer = !finish && (process.platform === "win32" || process.env.AOS_A2A_HOOK_DEFER === "1");

  try {
    const lib = await loadLib(log);
    if (lib) {
      const sessionId = input.session_id || "";
      if (defer) {
        const off = process.env.AOS_A2A_SIDECAR === "off" || Number(process.env.AOS_DELEGATE_DEPTH || 0) > 0 || Number(process.env.MCSC_DEPTH || 0) > 0;
        if (!off) {
          // Codex needs its own peer name now (SessionStart context); the name is derived from the session id, no spawn needed.
          if (harness === "codex" && sessionId) stdout += contextJson(lib.sessionName({ harness, sessionId, env: process.env }));
          let payload = JSON.stringify(input);
          if (payload.length > 16000) payload = JSON.stringify({ session_id: sessionId });
          const self = fileURLToPath(import.meta.url);
          // WMI-started processes get no env: the payload and parent pid travel as arguments (small payload only).
          const b64 = Buffer.from(payload).toString("base64");
          const viaWmi = process.platform === "win32" && harness === "codex" && b64.length <= 4000 && !process.env.AOS_A2A_NO_WMI
            && await startOutsideJob([self, "--harness", harness, "--finish", "--hook-ppid", String(ppid), "--input-b64", b64]);
          if (!viaWmi) {
            const child = spawn(process.execPath, [self, "--harness", harness, "--finish"], {
              detached: true, stdio: "ignore", windowsHide: true,
              env: { ...process.env, AOS_A2A_HOOK_INPUT: payload, AOS_A2A_HOOK_PPID: String(ppid) },
            });
            child.on("error", (e) => log(`cannot start the finisher: ${e.message}`));
            child.unref();
          }
        }
      } else {
        // ppid is the harness CLI that spawned this hook. The session's title/name (audit
        // phonebook) is read only when the payload or env actually carries one; it labels an
        // unlabeled peer and follows renames. A hand-set AOS_A2A_LABEL always wins.
        const title = lib.sessionTitleOf
          ? lib.sessionTitleOf({ harness, payload: input, env: process.env })
          : undefined;
        // The `ps` walks below block the event loop, so they end at a deadline that leaves the budget timer its margin.
        const until = finish ? undefined : Date.now() + 1200;
        const harnessPid = lib.resolveHarnessPid ? lib.resolveHarnessPid(hookPpid, { until }) : hookPpid;
        if (harness === "codex") {
          // Documented codex fallback: with no workspace name the thread id (the session id) labels it.
          const r = lib.ensureSidecar({ harness, sessionId, parentPid: harnessPid, mode: "codex", thread: sessionId, title: title || sessionId });
          stderr += reportSkip(log, r);
          // A Codex session has no AOS_A2A_NAME and several codex sidecars can be live: tell it which one is its own,
          // as SessionStart additionalContext (same output contract as aos-session-hint.mjs, which Codex already runs).
          if (r?.name && !finish) stdout += contextJson(r.name);
        } else {
          const r = lib.ensureSidecar({ harness, sessionId, parentPid: harnessPid, title });
          stderr += reportSkip(log, r);
          // the bdb-aos plugin monitor has no session_id: it finds this session's inbox through a pid binding
          if (harness === "claude" && r?.name) (await loadLib(log, "a2a-monitor.mjs"))?.bindSession(r.name, finish ? {} : { until: Date.now() + 1000 });
        }
      }
    }
  } catch (e) { log(e?.stack || e); }
  return { code: 0, stdout, stderr };
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };

if (isMain()) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--harness");
  const harness = at >= 0 && argv[at + 1] ? argv[at + 1] : "claude";
  const finish = argv.includes("--finish");
  process.on("uncaughtException", (e) => { logErr(harness, finish, `uncaught: ${e?.stack || e}`); process.exitCode = 0; });
  process.on("unhandledRejection", (e) => { logErr(harness, finish, `unhandled: ${e?.stack || e}`); process.exitCode = 0; });
  // Hard wall-clock budget: ~70 % of the shortest timeout this hook is wired with (Claude 5 s, Codex 10 s). The only exit
  // call: by then the identity line (if any) left long ago. The detached finisher has no harness timeout and no budget.
  // Windows+codex also waits for the WMI launch (PowerShell cold start), still under the 10 s hook timeout.
  const budgetMs = process.platform === "win32" && harness === "codex" ? 7000 : 3500;
  if (!finish) setTimeout(() => { logErr(harness, finish, "hook budget exceeded"); process.exit(0); }, budgetMs - process.uptime() * 1000).unref();

  let input = {};
  try {
    const b64 = argv[argv.indexOf("--input-b64") + 1];
    input = JSON.parse(finish ? (argv.includes("--input-b64") ? Buffer.from(b64, "base64").toString("utf8") : process.env.AOS_A2A_HOOK_INPUT || "{}") : ((await readStdinBounded(1500)) ?? ""));
  } catch { if (!finish) logErr(harness, finish, "stdin: not valid JSON"); } // never log e.message: JSON.parse quotes a snippet of the payload
  const pp = Number(argv[argv.indexOf("--hook-ppid") + 1]);
  if (finish && pp > 1) process.env.AOS_A2A_HOOK_PPID = String(pp);
  const r = await hook(input, { harness, finish });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exitCode = 0; // a hard exit can drop buffered stdout on Windows pipes
}
