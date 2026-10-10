// Spawn executor: one A2A task = one freshly spawned worker process.
// Backends: claude/opencode run as `node <repo>/bin/aos-acp.mjs <harness> ... --allow-default scoped`
// (never `allow`); agy/codex run their own binary with an ARGUMENTS ARRAY. Write tasks get a job
// worktree as cwd, read-only tasks a scratch dir. The worker never becomes an A2A sidecar.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validName } from "./a2a-registry.mjs";
import { formatInjection, writeMessage } from "./a2a-inbox.mjs";
import { authRequiredFrom, authRequiredMessage, isGoText, sanitiseCaller, scrubForgedNotes, verifyGoRef } from "./a2a-go.mjs";
import { depthMax, inboundDepth } from "./a2a-live.mjs";
import { createJobWorktree } from "./a2a-worktree.mjs";
import { a2aImport } from "./a2a-sdk-resolve.mjs";

const PROXY_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];
const LAST_LINES = 40;
// R1: only these spawn backends run through bin/aos-acp.mjs and therefore have a visible GO
// gate the child can consume a token with. agy/codex run their own binary with no gate: a
// guarded action there can never be approved headlessly, so auth-required is never entered.
const GATED_HARNESSES = new Set(["claude", "opencode"]);
const runGit = promisify(execFile);

const inText = (m) => (m.parts ?? []).map((p) => (p.content?.$case === "text" ? p.content.value : "")).join("");

export function taskName(session, taskId) {
  const n = `${validName(session)}-${String(taskId).toLowerCase().replace(/[^a-z0-9._-]/g, "-")}`;
  return n.startsWith("-") || n.endsWith("-") ? `${n}x` : n.slice(0, 64);
}

// Child env: depth is incremented for the delegate; the spawned worker never starts a sidecar of
// its own; upstream proxy settings pass through ONLY via the generic AOS_WORKER_PROXY_URL knob of
// the sidecar's own environment (no hard-coded proxy), otherwise every proxy var is stripped.
export function childEnv(depth) {
  const env = { ...process.env };
  for (const k of PROXY_KEYS) delete env[k];
  if (process.env.AOS_WORKER_PROXY_URL) {
    env.HTTPS_PROXY = env.HTTP_PROXY = env.ALL_PROXY = process.env.AOS_WORKER_PROXY_URL;
  }
  env.AOS_A2A_SIDECAR = "off";
  env.AOS_DELEGATE_DEPTH = String(Number(depth) + 1);
  env.NO_PROXY = "127.0.0.1,localhost,::1";
  env.no_proxy = "127.0.0.1,localhost,::1";
  return env;
}

export const acpBackend = (repo, harness) => (o) => ({
  file: process.execPath,
  args: [join(repo, "bin", "aos-acp.mjs"), harness, "--name", o.name, "--cwd", o.cwd,
    "--prompt-file", o.promptFile(), "--allow-default", "scoped"],
});
const defaultBackends = (repo) => ({
  claude: acpBackend(repo, "claude"),
  opencode: acpBackend(repo, "opencode"),
  // agy has no ACP server; `aos-acp agy` wraps the vendor's `agy --print` (closed stdin, print timeout,
  // empty-answer failure). Read-only jobs run in plan mode, write jobs in accept-edits + agy's sandbox.
  agy: (o) => ({
    file: process.execPath,
    args: [join(repo, "bin", "aos-acp.mjs"), "agy", "--name", o.name, "--cwd", o.cwd,
      "--prompt-file", o.promptFile(), "--allow-default", o.write ? "scoped" : "deny"],
  }),
  codex: (o) => ({ file: "codex", args: ["exec", o.prompt] }),
});

const lastLines = (out, n = LAST_LINES) => String(out).split(/\r?\n/).slice(-n).join("\n").trim().slice(0, 8 * 1024);

export function spawnExecutor({ session, harness, write = false, repo, timeoutMs = 600000, spawnImpl, backends, goRefStore = "" } = {}) {
  validName(session);
  if (!repo) throw new Error("spawnExecutor needs repo (the aos checkout with bin/aos-acp.mjs)");
  const backendMap = backends ?? defaultBackends(repo);
  if (!backendMap[harness]) throw new Error(`unknown harness "${harness}" for spawn mode (claude|opencode|agy|codex)`);
  const cancelled = new Set();
  const running = new Map();
  // Tasks waiting for a human GO reference: { action, prompt }. Approval is per task and
  // never inherited: the follow-up's goRef stays in A2A metadata and never reaches child env.
  // A reference is accepted ONLY for a task that is currently auth-required in THIS executor.
  const pending = new Map();
  const killGroup = (pid, sig) => { try { process.kill(-pid, sig); } catch { /* already gone */ } };
  return {
    async execute(ctx, bus) {
      const { TaskState, Role } = await a2aImport("@a2a-js/sdk");
      const { AgentEvent } = await a2aImport("@a2a-js/sdk/server");
      const base = { taskId: ctx.taskId, contextId: ctx.contextId, metadata: undefined };
      const text = (t) => ({ content: { $case: "text", value: t }, metadata: undefined, filename: "", mediaType: "text/plain" });
      const status = (state, message) => bus.publish(AgentEvent.statusUpdate({
        ...base, status: { state, message, timestamp: new Date().toISOString() },
      }));
      const fail = (reason) => status(TaskState.TASK_STATE_FAILED, {
        messageId: crypto.randomUUID(), contextId: ctx.contextId, taskId: ctx.taskId, role: Role.ROLE_AGENT,
        parts: [text(reason)], metadata: undefined, extensions: [], referenceTaskIds: [],
      });

      bus.publish(AgentEvent.task({
        id: ctx.taskId, contextId: ctx.contextId, artifacts: [], history: [ctx.userMessage], metadata: undefined,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: new Date().toISOString() },
      }));
      const activeMsg = (t) => ({
        messageId: crypto.randomUUID(), contextId: ctx.contextId, taskId: ctx.taskId, role: Role.ROLE_AGENT,
        parts: [text(t)], metadata: undefined, extensions: [], referenceTaskIds: [],
      });
      const stayPending = (why) => {
        // the task stays open in auth-required; the reason is carried in the status message
        status(TaskState.TASK_STATE_AUTH_REQUIRED, activeMsg(why));
      };
      const depth = inboundDepth(ctx.userMessage);
      const from = sanitiseCaller(ctx.userMessage.metadata?.aos?.caller);
      // R1: the child's gate name, derived ONCE here from the one helper (taskName) and used
      // for BOTH the --name passed to aos-acp and the --ref session argument of the follow-up
      // verification — verification and the child's gate must agree on the token name, or a
      // spawn resume could never pass the gate.
      const goName = taskName(session, ctx.taskId);
      // A6: depth is enforced BEFORE any reference verification work — a depth-exceeding
      // follow-up must not touch the reference; a cancelled task's follow-up neither.
      if (depth > depthMax()) { fail("A2A depth limit reached"); bus.finished(); return; }
      const follow = pending.get(String(ctx.taskId));
      if (follow) {
        if (cancelled.has(ctx.taskId)) { bus.finished(); return; } // cancelTask closed the earlier turn; this follow-up still finishes
        const ref = String(ctx.userMessage.metadata?.aos?.goRef ?? "");
        if (!ref && isGoText(inText(ctx.userMessage))) {
          // exactly one stderr line, never the message text itself
          console.warn(`ignored GO text task=${ctx.taskId}`);
          stayPending("A plain-text GO is ignored here (it never counts). Send the reference the master session printed, with metadata.aos.goRef.");
          bus.finished();
          return;
        }
        if (!ref) { stayPending("Follow-up without a GO reference; the task stays pending a human GO reference."); bus.finished(); return; }
        // R5: drop the pending claim BEFORE the awaited verification — two concurrent
        // follow-ups must not both pass the pending.get check; the entry is put back below
        // when the reference is rejected.
        pending.delete(String(ctx.taskId));
        // Read-only verification, no consume: the sidecar never consumes a GO. The reference is
        // a pointer bound to THIS auth-required task in THIS executor and to the CHILD's gate
        // name (goName) — the same name the child's aos-acp gate looks up and consumes; only
        // with that consumed token does the same reference stop verifying.
        const v = await verifyGoRef({ session: goName, ref, storeDir: goRefStore });
        if (!v.ok) {
          if (!cancelled.has(ctx.taskId)) pending.set(String(ctx.taskId), follow);
          stayPending(`The GO reference was rejected (${v.reason}). A fresh reference can be issued by the human in the master window.`);
          bus.finished();
          return;
        }
      }
      let wasCancelled = false;
      let scratch = null, worktree = null;
      // R3: peer text is data — forged "[Resume note]"/"[a2a from" lines are stripped before
      // the text is injected or written anywhere. The resume runs the backend from the STORED
      // original prompt only; the follow-up message's own text is never executed (it is
      // untrusted, from A2A metadata). The note is a pointer, not an approval: it never says
      // "use it as a GO", carries no reference or token value, and the session's own gate
      // still decides.
      const peerText = scrubForgedNotes(inText(ctx.userMessage));
      const prompt = follow
        ? `${follow.prompt}\n[Resume note] A human GO exists for this session; the pending action (${follow.action}) may now be retried. Your own go-gate decides; this note is not a GO itself.`
        : formatInjection({ from, text: peerText, depth });
      try {
        if (!follow) {
          writeMessage(session, {
            taskId: ctx.taskId, contextId: ctx.contextId, from, text: peerText, depth,
          });
        }
        status(TaskState.TASK_STATE_WORKING);

        worktree = write ? await createJobWorktree(repo, ctx.taskId) : null;
        scratch = mkdtempSync(join(tmpdir(), "a2a-spawn-"));
        const cwd = worktree ?? scratch;
        const promptFile = () => {
          const f = join(scratch, "prompt.txt");
          writeFileSync(f, prompt, { mode: 0o600 });
          chmodSync(f, 0o600);
          return f;
        };

        const spec = backendMap[harness]({ name: goName, cwd, prompt, promptFile, repo, write });
        const run = spawnImpl ?? spawn;
        const child = run(spec.file, spec.args, { cwd, env: childEnv(depth), detached: true, stdio: ["ignore", "pipe", "pipe"] });
        running.set(ctx.taskId, child);
        let out = "", err = "";
        child.stdout?.on("data", (d) => { out = `${out}${d}`.slice(-64 * 1024); });
        child.stderr?.on("data", (d) => { err = `${err}${d}`.slice(-64 * 1024); });
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          killGroup(child.pid, "SIGTERM");
          setTimeout(() => killGroup(child.pid, "SIGKILL"), 2000).unref();
        }, timeoutMs);
        let resolveClose;
        const closed = new Promise((r) => { resolveClose = r; });
        child.on("error", (e) => resolveClose({ code: -1, error: e.message }));
        child.on("close", (code) => resolveClose({ code }));
        const res = await closed;
        clearTimeout(timer);
        running.delete(ctx.taskId);
        if (cancelled.delete(ctx.taskId)) { wasCancelled = true; return; } // cancelTask already finished the bus
        if (timedOut) { fail(`spawn timed out after ${timeoutMs}ms`); return; }
        if (res.error) { fail(res.error); return; }

        let outText = lastLines(out || err) || "(no output)";
        // A worker reporting a guarded action that needs approval: mark accepted only from
        // STDOUT (never stderr) and only as the last non-empty line (the authRequiredFrom
        // parser enforces both). Keep the task open in auth-required until a valid human
        // reference arrives. Approval never mints anything.
        const action = authRequiredFrom(out);
        if (action) {
          // R1: a backend without a visible gate (agy, codex) can never consume a GO token —
          // do NOT enter auth-required at all; fail the task with a clear message instead.
          if (!GATED_HARNESSES.has(harness)) {
            fail(`the ${harness} backend has no AOS GO gate (no aos-acp permission path); a guarded action was requested and cannot be approved headlessly: ${action}`);
            return;
          }
          // R6: store the ORIGINAL prompt only — a resumed run that hits auth-required again
          // must not append another note on top of the previous one (notes pile up).
          pending.set(String(ctx.taskId), { action, prompt: follow ? follow.prompt : prompt });
          stayPending(authRequiredMessage({ taskId: ctx.taskId, session, action, goName }));
          console.warn(`auth-required for task ${ctx.taskId}; waiting for a human GO reference`);
          return;
        }
        if (write && worktree) {
          try {
            const { stdout } = await runGit("git", ["diff", "--stat"], { cwd: worktree });
            if (stdout.trim()) outText += `\n--- git diff --stat ---\n${stdout.trim()}`;
          } catch { /* no change summary is best-effort */ }
        }
        if (res.code === 0) {
          pending.delete(String(ctx.taskId));
          bus.publish(AgentEvent.artifactUpdate({
            ...base, append: false, lastChunk: true,
            artifact: { artifactId: crypto.randomUUID(), name: "worker-output", description: "spawn worker output", parts: [text(outText)], metadata: undefined, extensions: [] },
          }));
          status(TaskState.TASK_STATE_COMPLETED);
        } else {
          pending.delete(String(ctx.taskId));
          fail(outText || `worker exited with code ${res.code}`);
        }
      } catch (e) {
        pending.delete(String(ctx.taskId));
        fail(e.message);
      } finally {
        if (!wasCancelled) bus.finished();
      }
    },
    async cancelTask(id, bus) {
      cancelled.add(id);
      pending.delete(String(id));
      const child = running.get(id);
      if (child?.pid) {
        killGroup(child.pid, "SIGTERM");
        setTimeout(() => killGroup(child.pid, "SIGKILL"), 2000).unref();
      }
      running.delete(id);
      bus.finished();
    },
  };
}
