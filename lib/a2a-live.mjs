// Live executor: drops the A2A message into the session inbox and waits for the session's own reply.
// A reply carrying the AOS-AUTH-REQUIRED marker keeps the task open in auth-required; a follow-up
// with metadata.aos.goRef VERIFIES the reference READ-ONLY (never consumes, never mints) and, when
// valid, writes an inbox note that only says a human GO exists for this session and the pending
// action may be retried — the session's OWN go-gate decides when the guarded command actually
// runs. The plain text "GO" in any message never counts.
import crypto from "node:crypto";
import { readReply, writeMessage } from "./a2a-inbox.mjs";
// Installed ~/.agents copy: bare import in the checkout, else require() from the recorded package root.
import { a2aImport } from "./a2a-sdk-resolve.mjs";
import { validName } from "./a2a-registry.mjs";
import { authRequiredFrom, authRequiredMessage, isGoText, sanitiseCaller, verifyGoRef } from "./a2a-go.mjs";

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
  // taskId -> { action }: tasks waiting for a human GO reference. Per task only: a reference is
  // accepted ONLY for a task that is currently auth-required in THIS executor.
  const pending = new Map();
  const seen = new Map(); // taskId -> the reply text already published (a resume ignores repeats of it)
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
      let wasCancelled = false;
      const activeMsg = (t) => ({
        messageId: crypto.randomUUID(), contextId: ctx.contextId, taskId: ctx.taskId, role: Role.ROLE_AGENT,
        parts: [text(t)], metadata: undefined, extensions: [], referenceTaskIds: [],
      });
      const stayPending = (why) => status(TaskState.TASK_STATE_AUTH_REQUIRED, activeMsg(why));
      const depth = inboundDepth(ctx.userMessage);
      // A6: depth is enforced BEFORE any reference verification work — a depth-exceeding
      // follow-up must not touch the reference.
      if (depth > depthMax()) { fail("A2A depth limit reached"); bus.finished(); return; }
      const follow = pending.get(String(ctx.taskId));
      if (follow) {
        // cancelTask closed the earlier turn but this follow-up still finishes its own turn.
        if (cancelled.has(ctx.taskId)) { bus.finished(); return; }
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
        try {
          // Read-only verification, no consume. A reference is accepted only for THIS task in
          // THIS executor (the pending map held the auth-required state) and only for this
          // session; the real token is consumed later by the session's own go-gate.
          const v = await verifyGoRef({ session, ref, storeDir: goRefStore });
          if (!v.ok) {
            if (!cancelled.has(ctx.taskId)) pending.set(String(ctx.taskId), follow);
            stayPending(`The GO reference was rejected (${v.reason}). A fresh reference can be issued by the human in the master window.`);
            bus.finished();
            return;
          }
          // The inbox note is a POINTER to the outcome, not an approval: it never says "use it
          // as a GO", carries no reference or token value, and comes from the RESERVED system
          // sender "aos-a2a" (R3: sanitiseCaller now maps every aos*/a2a/system/master/human
          // caller to unknown, so no peer can claim this name). The session's own gate decides.
          writeMessage(session, {
            taskId: ctx.taskId, contextId: ctx.contextId, from: "aos-a2a",
            text: `A human GO exists for this session; the pending action may now be retried: ${follow.action}. Your own gate decides whether the GO applies; this note is not a GO itself.`,
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
            if (fresh == null) {
              if (cancelled.delete(ctx.taskId)) { wasCancelled = true; return; } // cancelTask already finished the bus
              fail("live reply timeout after approval");
              return;
            }
            bus.publish(AgentEvent.artifactUpdate({
              ...base, append: false, lastChunk: true,
              artifact: { artifactId: crypto.randomUUID(), name: "answer", description: "live reply after approval", parts: [text(String(fresh))], metadata: undefined, extensions: [] },
            }));
            status(TaskState.TASK_STATE_COMPLETED);
            seen.delete(String(ctx.taskId));
            return;
          }
          return; // approval seen but nothing published before: wait for the next turn
        } catch (e) {
          fail(e.message);
          return;
        } finally {
          if (!wasCancelled) bus.finished();
        }
      }
      try {
        writeMessage(session, {
          taskId: ctx.taskId, contextId: ctx.contextId,
          from: sanitiseCaller(ctx.userMessage.metadata?.aos?.caller), text: inText(ctx.userMessage),
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
