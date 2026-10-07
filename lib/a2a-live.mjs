// Live executor: drops the A2A message into the session inbox and waits for the session's own reply.
// A reply carrying the AOS-AUTH-REQUIRED marker keeps the task open in auth-required; a follow-up
// with metadata.aos.goRef verifies+consumes a human reference (never the plain text "GO") and, when
// valid, writes the approval note into the session inbox and keeps waiting for a fresh reply.
import crypto from "node:crypto";
import { validName } from "./a2a-registry.mjs";
import { readReply, writeMessage } from "./a2a-inbox.mjs";
import { authRequiredFrom, authRequiredMessage, isGoText, consumeGoRef } from "./a2a-go.mjs";

const inText = (m) => (m.parts ?? []).map((p) => (p.content?.$case === "text" ? p.content.value : "")).join("");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// L2: the sender writes metadata.aos.depth (send()); the receiver must enforce it too.
export const inboundDepth = (msg) => {
  const d = Number(msg?.metadata?.aos?.depth);
  return Number.isFinite(d) ? d : 0;
};
export const depthMax = () => Number(process.env.AOS_A2A_MAX_DEPTH || 1);

export function liveExecutor({ session, replySource = async ({ session: s, taskId }) => readReply(s, taskId), timeoutMs = 300000, pollMs = 250, goRefStore = "" } = {}) {
  validName(session);
  const cancelled = new Set();
  // taskId -> { action }: tasks waiting for a human GO reference. Per task only.
  const pending = new Map();
  const seen = new Map(); // taskId -> the reply text already published (a resume ignores repeats of it)
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
      const activeMsg = (t) => ({
        messageId: crypto.randomUUID(), contextId: ctx.contextId, taskId: ctx.taskId, role: Role.ROLE_AGENT,
        parts: [text(t)], metadata: undefined, extensions: [], referenceTaskIds: [],
      });
      const stayPending = (why) => status(TaskState.TASK_STATE_AUTH_REQUIRED, activeMsg(why));
      const follow = pending.get(String(ctx.taskId));
      let approvedNote = null;
      if (follow) {
        if (cancelled.has(ctx.taskId)) { bus.finished(); return; } // cancelTask closed the earlier turns; this follow-up still finishes
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
        approvedNote = ref.slice(0, 6); // short reference only, never the token itself
      }
      try {
        const depth = inboundDepth(ctx.userMessage);
        if (depth > depthMax()) { fail("A2A depth limit reached"); return; }
        if (follow) {
          // The human approved: the inbox note says so; the old reply is ignored once, so the
          // poll below waits for the session's fresh answer after the approval note.
          writeMessage(session, {
            taskId: ctx.taskId, contextId: ctx.contextId, from: "human-goref",
            text: `The human approved the pending action for this task (go-ref ${approvedNote}) Use it as a human GO. Approved: ${follow.action}`,
            depth,
          });
          const last = seen.get(String(ctx.taskId));
          if (last != null) {
            const deadline = Date.now() + timeoutMs;
            let fresh = null;
            while (fresh == null && !cancelled.has(ctx.taskId) && Date.now() < deadline) {
              const r = await replySource({ session, taskId: ctx.taskId });
              if (r != null && String(r) !== last) fresh = r;
              else if (fresh == null) await sleep(pollMs);
            }
            if (fresh == null) { fail("live reply timeout after approval"); return; }
            pending.delete(String(ctx.taskId));
            bus.publish(AgentEvent.artifactUpdate({
              ...base, append: false, lastChunk: true,
              artifact: { artifactId: crypto.randomUUID(), name: "answer", description: "live reply after approval", parts: [text(String(fresh))], metadata: undefined, extensions: [] },
            }));
            status(TaskState.TASK_STATE_COMPLETED);
            seen.delete(String(ctx.taskId));
            return;
          }
          return; // approval seen but nothing published before: wait for the next turn
        }
        writeMessage(session, {
          taskId: ctx.taskId, contextId: ctx.contextId,
          from: ctx.userMessage.metadata?.aos?.caller ?? "unknown", text: inText(ctx.userMessage),
          depth,
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
        const action = authRequiredFrom(String(reply));
        seen.set(String(ctx.taskId), String(reply));
        if (action) {
          pending.set(String(ctx.taskId), { action });
          stayPending(authRequiredMessage({ taskId: ctx.taskId, session, action }));
          return;
        }
        seen.delete(String(ctx.taskId));
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
    async cancelTask(id, bus) { cancelled.add(id); pending.delete(String(id)); bus.finished(); },
  };
}
