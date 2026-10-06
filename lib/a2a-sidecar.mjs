// A2A sidecar library: loopback-only JSON-RPC server with bearer auth, profile card, registry entry.
import crypto from "node:crypto";
import { cardFromProfile } from "./a2a-card.mjs";
import { register, unregister } from "./a2a-registry.mjs";

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

const inText = (m) => (m.parts ?? []).map((p) => (p.content?.$case === "text" ? p.content.value : "")).join("");

export function echoExecutor({ name = "a2a", harness = "unknown" } = {}) {
  return {
    async execute(ctx, bus) {
      const { TaskState, Role } = await import("@a2a-js/sdk");
      const { AgentEvent } = await import("@a2a-js/sdk/server");
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
    sdk = await import("@a2a-js/sdk");
    serverMod = await import("@a2a-js/sdk/server");
    expressMod = await import("@a2a-js/sdk/server/express");
    expressMod = { ...expressMod, express: (await import("express")).default };
  } catch {
    throw new Error("A2A SDK missing: install @hybridlabor-api/aos dependencies");
  }
  const { AGENT_CARD_PATH } = sdk;
  const { DefaultRequestHandler, InMemoryTaskStore } = serverMod;
  const { jsonRpcHandler, agentCardHandler, UserBuilder } = expressMod;
  const express = expressMod.express;

  const token = crypto.randomBytes(32).toString("hex");
  const tokBuf = Buffer.from(token);
  const inner = executor ?? echoExecutor({ name, harness });
  let running = 0;
  const capped = {
    async execute(ctx, bus) {
      if (running >= maxTasks) {
        throw new Error(`A2A json-rpc error -32000: too many concurrent tasks (maxTasks=${maxTasks})`);
      }
      running += 1;
      try { await inner.execute(ctx, bus); } finally { running -= 1; }
    },
    async cancelTask(id, bus) { return inner.cancelTask(id, bus); },
  };

  const app = express();
  app.disable("x-powered-by");
  let card;
  app.use(AGENT_CARD_PATH.startsWith("/") ? AGENT_CARD_PATH : `/${AGENT_CARD_PATH}`,
    agentCardHandler({ agentCardProvider: async () => card, cache: { maxAge: 0 } }));
  app.use("/a2a", express.json({ limit: "8kb" }));
  app.use("/a2a", (req, res, next) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
    const got = Buffer.from(m?.[1] ?? "");
    if (!m || got.length !== tokBuf.length || !crypto.timingSafeEqual(got, tokBuf)) {
      res.status(401).set("WWW-Authenticate", "Bearer").json({ error: "unauthorized" });
      return;
    }
    next();
  });
  app.use((err, req, res, next) => {
    if (err && err.status === 413) { res.status(413).json({ error: "payload too large" }); return; }
    next(err);
  });

  return await new Promise((resolve, reject) => {
    const server = app.listen(0, host, () => {
      const port = server.address().port;
      const url = `http://127.0.0.1:${port}/a2a`;
      const cardUrl = `http://127.0.0.1:${port}/${AGENT_CARD_PATH.replace(/^\//, "")}`;
      card = cardFromProfile(profile, { name, harness, url });
      const handler = new DefaultRequestHandler(card, new InMemoryTaskStore(), capped);
      app.use("/a2a", jsonRpcHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication }));
      register({ name, harness, pid: process.pid, url, cardUrl, token });

      let stopped = false;
      let parentTimer = null;
      const stop = () => {
        if (stopped) return;
        stopped = true;
        if (parentTimer) clearInterval(parentTimer);
        try { server.closeAllConnections?.(); server.close(); } catch { /* already closed */ }
        try { unregister(name); } catch { /* already gone */ }
      };

      if (Number.isInteger(parentPid) && parentPid > 0) {
        parentTimer = setInterval(() => {
          try { process.kill(parentPid, 0); } catch (e) {
            if (e.code === "ESRCH") {
              stop();
              if (asCli) process.exit(0);
            }
          }
        }, 5000);
        parentTimer.unref?.();
      }

      if (asCli) {
        process.once("SIGTERM", stop);
        process.once("SIGINT", stop);
      }

      resolve({ url, cardUrl, port, token, stop });
    });
    server.once("error", reject);
  });
}
