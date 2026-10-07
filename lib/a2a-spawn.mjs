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
import { authRequiredFrom, authRequiredMessage, actionHash, isGoText, consumeGoRef } from "./a2a-go.mjs";
import { depthMax, inboundDepth } from "./a2a-live.mjs";
import { createJobWorktree } from "./a2a-worktree.mjs";

const PROXY_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];
const LAST_LINES = 40;
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
  agy: (o) => ({ file: "agy", args: ["--print", o.prompt] }),
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
  const pending = new Map();
  const killGroup = (pid, sig) => { try { process.kill(-pid, sig); } catch { /* already gone */ } };
  return {
    async execute(ctx, bus) {
      const { TaskState, Role } = await import("@a2a-js/sdk");
      const { AgentEvent } = await import("@a2a-js/sdk/server");
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
      const follow = pending.get(String(ctx.taskId));
      let refTold = null;
      if (follow) {
        const ref = String(ctx.userMessage.metadata?.aos?.goRef ?? "");
        if (!ref && isGoText(inText(ctx.userMessage))) {
          // exactly one stderr line, never the message text itself
          console.warn(`ignored GO text task=${ctx.taskId}`);
          stayPending("A plain-text GO is ignored here (it never counts). Send the reference printed by the master window with metadata.aos.goRef.");
          bus.finished();
          return;
        }
        if (!ref) { stayPending("Follow-up without a GO reference; the task stays pending a human GO reference."); bus.finished(); return; }
        const v = await consumeGoRef({ session, ref, storeDir: goRefStore });
        if (!v.ok) { stayPending(`The GO reference was rejected (${v.reason}). A fresh reference can be issued by the human in the master window.`); bus.finished(); return; }
        pending.delete(String(ctx.taskId));
        refTold = ref.slice(0, 6); // the short reference in the resume note; never the token itself
      }
      let wasCancelled = false;
      let scratch = null, worktree = null;
      try {
        const depth = inboundDepth(ctx.userMessage);
        if (depth > depthMax()) { fail("A2A depth limit reached"); return; }
        const from = ctx.userMessage.metadata?.aos?.caller ?? "unknown";
        if (!follow) {
          writeMessage(session, {
            taskId: ctx.taskId, contextId: ctx.contextId, from, text: inText(ctx.userMessage), depth,
          });
        }
        status(TaskState.TASK_STATE_WORKING);

        const prompt = follow
          ? `Continue the previously blocked task. It was approved by human reference ${refTold}. Approved action: ${follow.action} (action hash ${actionHash(follow.action)}).\nOriginal task:\n${formatInjection({ from, text: inText(ctx.userMessage), depth })}`
          : formatInjection({ from, text: inText(ctx.userMessage), depth });
        worktree = write ? await createJobWorktree(repo, ctx.taskId) : null;
        scratch = mkdtempSync(join(tmpdir(), "a2a-spawn-"));
        const cwd = worktree ?? scratch;
        const promptFile = () => {
          const f = join(scratch, "prompt.txt");
          writeFileSync(f, prompt, { mode: 0o600 });
          chmodSync(f, 0o600);
          return f;
        };

        const spec = backendMap[harness]({ name: taskName(session, ctx.taskId), cwd, prompt, promptFile, repo });
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
        // A worker reporting a guarded action that needs approval: keep the task open in
        // auth-required until a valid human reference arrives. Approval never mints anything.
        const action = authRequiredFrom(`${out}\n${err}`);
        if (action) {
          pending.set(String(ctx.taskId), { action, prompt });
          stayPending(authRequiredMessage({ taskId: ctx.taskId, session, action }));
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
