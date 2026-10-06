// Codex live executor: injects A2A messages into a Codex session and waits for a file reply.
// GO/approvals are never granted through this path; prompts carry the never-GO line.
// No dangerous flags (e.g. --dangerously-bypass-hook-trust) are ever added by this code.
import { spawn } from "node:child_process";
import { validName } from "./a2a-registry.mjs";
import { formatInjection, readReply } from "./a2a-inbox.mjs";
import { liveExecutor } from "./a2a-live.mjs";

const inText = (m) => (m.parts ?? []).map((p) => (p.content?.$case === "text" ? p.content.value : "")).join("");

const REPLY_LINE = (taskId) => `Answer by running: aos-a2a reply ${taskId} "<your answer>"`;

export function codexQueueArgs(thread, prompt) {
  if (!String(thread ?? "").trim()) throw new Error("thread required");
  return ["queue", "--thread", String(thread), "--message", String(prompt)];
}

export function codexResumeArgs(thread, prompt) {
  if (!String(thread ?? "").trim()) throw new Error("thread required");
  return ["exec", "resume", String(thread), String(prompt)];
}

const envWithoutProxy = () => {
  const env = { ...process.env };
  for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete env[k];
  env.NO_PROXY = "127.0.0.1,localhost,::1";
  env.no_proxy = "127.0.0.1,localhost,::1";
  return env;
};

export function codexLiveExecutor({ session, thread, mode = "queue", timeoutMs = 300000, spawnImpl, replySource } = {}) {
  validName(session);
  if (!String(thread ?? "").trim()) throw new Error("thread required");
  const threadName = String(thread);

  const baseReplySource = replySource ?? (async ({ session: s, taskId }) => readReply(s, taskId));
  let prompt = null;
  let runPromise = null;

  const buildArgs = () => (mode === "resume" ? codexResumeArgs : codexQueueArgs)(threadName, prompt);

  const spawnOnce = () => {
    if (runPromise) return runPromise;
    const run = spawnImpl ?? spawn;
    runPromise = new Promise((resolve) => {
      try {
        const child = run("codex", buildArgs(), { env: envWithoutProxy(), stdio: ["ignore", "ignore", "pipe"] });
        let err = "";
        child.stderr?.on("data", (d) => { err += String(d); });
        child.on("error", (e) => resolve({ ok: false, error: e.message }));
        child.on("close", (code) => {
          if (code === 0) resolve({ ok: true });
          else resolve({ ok: false, error: (err.trim() || `codex exited with code ${code}`) });
        });
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });
    return runPromise;
  };

  const inner = liveExecutor({
    session,
    timeoutMs,
    replySource: async (q) => {
      const r = await spawnOnce();
      if (!r.ok) throw new Error(r.error);
      return await baseReplySource(q);
    },
  });

  return {
    async execute(ctx, bus) {
      const from = ctx.userMessage?.metadata?.aos?.caller ?? "unknown";
      const text = inText(ctx.userMessage);
      prompt = `${formatInjection({ from, text })}\n${REPLY_LINE(ctx.taskId)}`;
      return inner.execute(ctx, bus);
    },
    async cancelTask(id, bus) { return inner.cancelTask(id, bus); },
  };
}
