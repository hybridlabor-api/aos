// Live executor: drops the A2A message into the session inbox and waits for the session's own reply.
import crypto from "node:crypto";
import { validName } from "./a2a-registry.mjs";
import { readReply, writeMessage } from "./a2a-inbox.mjs";

const inText = (m) => (m.parts ?? []).map((p) => (p.content?.$case === "text" ? p.content.value : "")).join("");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function liveExecutor({ session, replySource = async ({ session: s, taskId }) => readReply(s, taskId), timeoutMs = 300000, pollMs = 250 } = {}) {
  validName(session);
  const cancelled = new Set();
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
      let wasCancelled = false;
      try {
        writeMessage(session, {
          taskId: ctx.taskId, contextId: ctx.contextId,
          from: ctx.userMessage.metadata?.aos?.caller ?? "unknown", text: inText(ctx.userMessage),
        });
        status(TaskState.TASK_STATE_WORKING);
        const deadline = Date.now() + timeoutMs;
        let reply = null;
        while (reply == null && !cancelled.has(ctx.taskId) && Date.now() < deadline) {
          reply = await replySource({ session, taskId: ctx.taskId });
          if (reply == null) await sleep(pollMs);
        }
        if (cancelled.delete(ctx.taskId)) { wasCancelled = true; return; } // cancelTask already finished the bus
        if (reply == null) { fail("live reply timeout"); return; }
        bus.publish(AgentEvent.artifactUpdate({
          ...base, append: false, lastChunk: true,
          artifact: { artifactId: crypto.randomUUID(), name: "answer", description: "live reply", parts: [text(String(reply))], metadata: undefined, extensions: [] },
        }));
        status(TaskState.TASK_STATE_COMPLETED);
      } catch (e) {
        fail(e.message);
      } finally {
        if (!wasCancelled) bus.finished();
      }
    },
    async cancelTask(id, bus) { cancelled.add(id); bus.finished(); },
  };
}
