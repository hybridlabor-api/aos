// agy (Antigravity) A2A integration: resume-based executor + MCP registration args.
// Inbound to agy is PULL via bin/a2a-inbox-mcp.mjs; this module is the fallback
// that resumes the most recent conversation per incoming message.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { validName } from "./a2a-registry.mjs";
import { claim, formatInjection, writeMessage } from "./a2a-inbox.mjs";
import { depthMax, inboundDepth } from "./a2a-live.mjs";
// Installed ~/.agents copy: bare import in the checkout, else require() from the recorded package root.
import { a2aImport } from "./a2a-sdk-resolve.mjs";

const MAX_OUT = 64 * 1024;
const PROXY_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];

// Never `--continue`: that resumes the user's most recent conversation and would hijack an open interactive agy chat.
// Without a conversation id every A2A message runs in its own fresh conversation (documented limit: no peer context).
export function buildAgyArgs(prompt, conversationId) {
  const id = String(conversationId ?? "").trim();
  return id ? ["--conversation", id, "--print", prompt] : ["--print", prompt];
}

export function agyMcpAddArgs(name, scriptPath) {
  return ["mcp", "add", name, "node", scriptPath];
}

export const stripProxyEnv = (env, session) => {
  const out = { ...env, NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" };
  for (const k of PROXY_KEYS) delete out[k];
  // the headless agy turn knows whose peer it is (a reply or onward send from there must not borrow another name)
  if (session) out.AOS_A2A_NAME = validName(session);
  return out;
};

// `--output-format json` prints {conversation_id, status, response, ...} (verified on agy 1.3.0): the id lets the
// next message of the same A2A thread resume ITS OWN conversation instead of a new one.
export function parseAgyJson(out) {
  let j;
  try { j = JSON.parse(String(out).trim()); } catch { return { text: String(out), conversationId: undefined }; }
  if (j && typeof j === "object" && j.status && j.status !== "SUCCESS") throw new Error(`agy status ${j.status}`);
  return { text: typeof j?.response === "string" ? j.response : String(out), conversationId: j?.conversation_id };
}

const defaultRun = ({ prompt, timeoutMs, conversationId, session }) => new Promise((resolve, reject) => {
  const child = spawn("agy", [...buildAgyArgs(prompt, conversationId), "--output-format", "json"], { stdio: ["ignore", "pipe", "pipe"], env: stripProxyEnv(process.env, session) });
  let out = Buffer.alloc(0);
  let err = "";
  let done = false;
  const timer = setTimeout(() => {
    if (done) return;
    done = true;
    try { child.kill("SIGTERM"); } catch { /* already dead */ }
    reject(new Error("agy timed out"));
  }, timeoutMs);
  child.stdout.on("data", (d) => { if (out.length <= MAX_OUT) out = Buffer.concat([out, d]); });
  child.stderr.on("data", (d) => { err += d; });
  child.on("error", (e) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    reject(e);
  });
  child.on("close", (code) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (out.length > MAX_OUT) out = out.subarray(0, MAX_OUT);
    if (code !== 0) reject(new Error(`agy exited ${code}${err.trim() ? `: ${err.trim().slice(0, 500)}` : ""}`));
    else { try { resolve(parseAgyJson(out.toString("utf8"))); } catch (e) { reject(e); } }
  });
});

// The headless turn's stdout IS the reply: the session must not also try `aos-a2a reply` (no reply file is awaited).
export const RESUME_LINE = "Answer in plain text: your printed answer is returned to the sender as the reply. Do not run aos-a2a reply for this message.";

const inText = (m) => (m.parts ?? []).map((p) => (p.content?.$case === "text" ? p.content.value : "")).join("");

// Same executor contract as liveExecutor/echoExecutor: execute(ctx, bus), cancelTask(id, bus).
// A headless agy turn took about 5 minutes on a loaded machine: the default deadline is 10 minutes.
export function agyResumeExecutor({ session, run, timeoutMs = 600000 } = {}) {
  validName(session);
  const doRun = run ?? ((a) => defaultRun({ prompt: a.prompt, timeoutMs, conversationId: a.conversationId, session }));
  const conversations = new Map(); // A2A contextId -> agy conversation id (this sidecar's own conversations only)
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
      try {
        const depth = inboundDepth(ctx.userMessage);
        if (depth > depthMax()) { fail("A2A depth limit reached"); return; }
        const msg = {
          taskId: ctx.taskId, contextId: ctx.contextId,
          from: ctx.userMessage.metadata?.aos?.caller ?? "unknown", text: inText(ctx.userMessage),
          depth,
        };
        // The inbox note is the record of the message; this executor answers it itself, so it is claimed at once.
        // Otherwise the agy PreInvocation hook would hand the same, already answered task to the open chat at the
        // user's next prompt and ask it to reply a second time.
        claim(writeMessage(session, msg));
        status(TaskState.TASK_STATE_WORKING);
        // one line per turn on the sidecar's stderr (the sidecar log): this is how a human follows what the agy peer does
        const known = conversations.get(ctx.contextId);
        const t0 = Date.now();
        process.stderr.write(`[agy ${session}] task=${ctx.taskId} from=${msg.from} context=${ctx.contextId} conversation=${known ?? "(new)"} start\n`);
        const res = await doRun({ prompt: `${formatInjection(msg)}\n${RESUME_LINE}`, session, conversationId: known });
        const out = typeof res === "string" ? res : res.text;
        if (res && typeof res === "object" && res.conversationId) conversations.set(ctx.contextId, res.conversationId);
        process.stderr.write(`[agy ${session}] task=${ctx.taskId} conversation=${conversations.get(ctx.contextId) ?? "-"} done in ${Math.round((Date.now() - t0) / 1000)}s\n`);
        bus.publish(AgentEvent.artifactUpdate({
          ...base, append: false, lastChunk: true,
          artifact: { artifactId: crypto.randomUUID(), name: "answer", description: "agy resume reply", parts: [text(String(out))], metadata: undefined, extensions: [] },
        }));
        status(TaskState.TASK_STATE_COMPLETED);
      } catch (e) {
        fail(e.message);
      } finally {
        bus.finished();
      }
    },
    async cancelTask(_id, bus) { bus.finished(); },
  };
}
