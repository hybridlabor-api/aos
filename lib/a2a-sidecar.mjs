// A2A sidecar library: loopback-only JSON-RPC server with bearer auth, profile card, registry entry.
import crypto from "node:crypto";
import { cardFromProfile } from "./a2a-card.mjs";
import { register, unregister, heartbeat, book, bookPath, list, sessionsDir } from "./a2a-registry.mjs";
import { usableOwnerPid, ownerGone, idleExpired, idleLimitMs, usesIdleReaper, seenAt } from "./a2a-liveness.mjs";
// lib/a2a-sdk-resolve.mjs: bare import (checkout) or require from the recorded package root
// (installed ~/.agents copy, whose node_modules belongs to the npm package, not to this copy).
import { a2aImport, SDK_MISSING } from "./a2a-sdk-resolve.mjs";

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

const inText = (m) => (m.parts ?? []).map((p) => (p.content?.$case === "text" ? p.content.value : "")).join("");

export function echoExecutor({ name = "a2a", harness = "unknown" } = {}) {
  return {
    async execute(ctx, bus) {
      const { TaskState, Role } = await a2aImport("@a2a-js/sdk");
      const { AgentEvent } = await a2aImport("@a2a-js/sdk/server");
      const echo = `[a2a echo from ${name}/${harness}] ${inText(ctx.userMessage)}`;
      const base = { taskId: ctx.taskId, contextId: ctx.contextId, metadata: undefined };
      const text = (t) => ({ content: { $case: "text", value: t }, metadata: undefined, filename: "", mediaType: "text/plain" });
      const msg = {
        messageId: crypto.randomUUID(), contextId: ctx.contextId, taskId: ctx.taskId, role: Role.ROLE_AGENT,
        parts: [text(echo)], metadata: undefined, extensions: [], referenceTaskIds: [],
      };
      bus.publish(AgentEvent.task({
        id: ctx.taskId, contextId: ctx.contextId, artifacts: [], history: [ctx.userMessage], metadata: undefined,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: new Date().toISOString() },
      }));
      bus.publish(AgentEvent.artifactUpdate({
        ...base, append: false, lastChunk: true,
        artifact: { artifactId: crypto.randomUUID(), name: "echo", description: "echoed input", parts: [text(echo)], metadata: undefined, extensions: [] },
      }));
      bus.publish(AgentEvent.statusUpdate({
        ...base, status: { state: TaskState.TASK_STATE_COMPLETED, message: msg, timestamp: new Date().toISOString() },
      }));
      bus.finished();
    },
    async cancelTask(_id, bus) { bus.finished(); },
  };
}

export async function startSidecar({ name, harness, profile, executor, parentPid, host = "127.0.0.1", maxTasks = 4, asCli = false } = {}) {
  if (process.env.AOS_A2A_SIDECAR === "off") throw new Error("A2A sidecar disabled (AOS_A2A_SIDECAR=off)");
  if (!LOOPBACK.has(host)) throw new Error(`refusing non-loopback bind: ${host}`);
  if (!name || !harness) throw new Error("name and harness required");

  for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete process.env[k];
  process.env.NO_PROXY = "127.0.0.1,localhost,::1";
  process.env.no_proxy = "127.0.0.1,localhost,::1";

  let sdk, serverMod, expressMod;
  try {
    sdk = await a2aImport("@a2a-js/sdk");
    serverMod = await a2aImport("@a2a-js/sdk/server");
    expressMod = await a2aImport("@a2a-js/sdk/server/express");
    const expressModRaw = await a2aImport("express");
    expressMod = { ...expressMod, express: expressModRaw.default ?? expressModRaw };
  } catch {
    throw new Error(SDK_MISSING);
  }
  const { AGENT_CARD_PATH } = sdk;
  const { DefaultRequestHandler, InMemoryTaskStore } = serverMod;
  const { jsonRpcHandler, agentCardHandler, UserBuilder } = expressMod;
  const express = expressMod.express;

  const token = crypto.randomBytes(32).toString("hex");
  const tokBuf = Buffer.from(token);
  const inner = executor ?? echoExecutor({ name, harness });
  let running = 0;
  let lastTaskAt = Date.now();
  const capped = {
    async execute(ctx, bus) {
      if (running >= maxTasks) {
        throw new Error(`A2A json-rpc error -32000: too many concurrent tasks (maxTasks=${maxTasks})`);
      }
      running += 1;
      try { await inner.execute(ctx, bus); } finally { running -= 1; lastTaskAt = Date.now(); }
    },
    async cancelTask(id, bus) { return inner.cancelTask(id, bus); },
  };

  const app = express();
  app.disable("x-powered-by");
  let card;
  // DNS-rebinding guard: a browser page on a rebound name still sends its own Host header.
  app.use((req, res, next) => {
    const hostName = /^(\[[^\]]+\]|[^:]*)(?::\d+)?$/.exec(req.headers.host ?? "")?.[1]?.replace(/^\[|\]$/g, "").toLowerCase();
    if (!hostName || !LOOPBACK.has(hostName)) {
      res.status(403).json({ error: "forbidden host" });
      return;
    }
    next();
  });
  app.use(AGENT_CARD_PATH.startsWith("/") ? AGENT_CARD_PATH : `/${AGENT_CARD_PATH}`,
    agentCardHandler({ agentCardProvider: async () => card, cache: { maxAge: 0 } }));
  app.use("/a2a", (req, res, next) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
    const got = Buffer.from(m?.[1] ?? "");
    if (!m || got.length !== tokBuf.length || !crypto.timingSafeEqual(got, tokBuf)) {
      res.status(401).set("WWW-Authenticate", "Bearer").json({ error: "unauthorized" });
      return;
    }
    next();
  });
  app.use("/a2a", express.json({ limit: "8kb" }));
  app.use((err, req, res, next) => {
    if (err && err.status === 413) { res.status(413).json({ error: "payload too large" }); return; }
    next(err);
  });

  return await new Promise((resolve, reject) => {
    const server = app.listen(0, host, () => {
      const port = server.address().port;
      const bound = server.address().address;
      const origin = `http://${bound.includes(":") ? `[${bound}]` : bound}:${port}`;
      const url = `${origin}/a2a`;
      const cardUrl = `${origin}/${AGENT_CARD_PATH.replace(/^\//, "")}`;
      card = cardFromProfile(profile, { name, harness, url });
      const handler = new DefaultRequestHandler(card, new InMemoryTaskStore(), capped);
      app.use("/a2a", jsonRpcHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication }));
      const owner = usableOwnerPid(parentPid);
      const hasParent = owner !== null;
      register({ name, harness, pid: process.pid, parentPid: hasParent ? owner : undefined, url, cardUrl, token });
      // /clear, resume and compact give the same harness process a new session id and so a new sidecar: the newest one
      // wins. Only a sibling with a fresh heartbeat is signalled, so a stale entry whose pid was reused is left alone.
      if (hasParent) {
        for (const e of list()) {
          if (e.name !== name && e.parentPid === owner && e.pid !== process.pid && Date.now() - e.ts < 15000) {
            try { process.kill(e.pid, "SIGTERM"); } catch { /* already gone */ }
          }
        }
      }

      let lastBookWrite = 0;
      const refreshBookThrottled = () => {
        if (Date.now() - lastBookWrite < 2000) return;
        lastBookWrite = Date.now();
        try { book(); } catch { /* book refresh is best-effort */ }
      };

      let stopped = false;
      let parentTimer = null;
      let idleTimer = null;
      let heartbeatTimer = null;
      const stop = () => {
        if (stopped) return;
        stopped = true;
        if (parentTimer) clearInterval(parentTimer);
        if (idleTimer) clearInterval(idleTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        try { server.closeAllConnections?.(); server.close(); } catch { /* already closed */ }
        try { unregister(name); } catch { /* already gone */ }
      };

      heartbeatTimer = setInterval(() => {
        try { heartbeat(name, { status: running > 0 ? "working" : "idle" }); } catch { /* best effort */ }
        refreshBookThrottled();
      }, 5000);
      heartbeatTimer.unref?.();

      // Owner watch: exit once the owner pid is gone (ESRCH).
      const exitNow = () => { stop(); if (asCli) process.exit(0); };
      if (hasParent) {
        parentTimer = setInterval(() => { if (ownerGone(owner)) exitNow(); }, 5000);
        parentTimer.unref?.();
      }
      // Idle reaper: no owner pid, or a shared-host owner (agy, codex) whose pid outlives the session.
      // Activity = the last task finishing or a session hook touching <name>.seen. Quiet for AOS_A2A_IDLE_MIN -> exit.
      if (usesIdleReaper(harness, hasParent)) {
        const idleMs = idleLimitMs();
        idleTimer = setInterval(() => {
          const last = Math.max(lastTaskAt, seenAt(sessionsDir(), name));
          if (idleExpired({ now: Date.now(), lastActivity: last, inFlight: running, idleMs })) exitNow();
        }, 30_000);
        idleTimer.unref?.();
      }

      if (asCli) {
        const bye = () => { stop(); process.exit(0); };
        process.once("SIGTERM", bye);
        process.once("SIGINT", bye);
      }

      resolve({ url, cardUrl, port, token, stop });
    });
    server.once("error", reject);
  });
}
