// A2A client library: send/status/cancel against registry targets, live-reply files via reply().
// Lazy-imports the SDK inside each function so the CLI never loads it for list/card/--help.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import { join } from "node:path";
import { list, readToken, validName } from "./a2a-registry.mjs";
import { replyDir } from "./a2a-inbox.mjs";

const SDK_MISSING = "A2A SDK missing: install @hybridlabor-api/aos dependencies";

const stripProxyEnv = () => {
  for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete process.env[k];
  process.env.NO_PROXY = "127.0.0.1,localhost,::1";
  process.env.no_proxy = "127.0.0.1,localhost,::1";
};

const sdk = async () => {
  try {
    return {
      sdk: await import("@a2a-js/sdk"),
      clientMod: await import("@a2a-js/sdk/client"),
    };
  } catch {
    throw new Error(SDK_MISSING);
  }
};

const textOf = (parts) => (parts ?? []).map((p) => (p.content?.$case === "text" ? p.content.value : "")).join("");

async function cardSkills(cardUrl) {
  const res = await fetch(cardUrl);
  if (!res.ok) throw new Error(`card fetch failed for ${cardUrl}: ${res.status}`);
  const card = await res.json();
  return card.skills ?? [];
}

async function resolveTarget({ to, role }) {
  const entries = list();
  if (to) {
    const e = entries.find((x) => x.name === to);
    if (!e) throw new Error(`no live registry entry for "${to}"`);
    return e;
  }
  if (role) {
    for (const e of entries) {
      try {
        const skills = await cardSkills(e.cardUrl);
        if (skills.some((s) => s.id === role)) return e;
      } catch { /* entry vanished or card down: skip */ }
    }
    throw new Error(`no live registry entry with skill id "${role}"`);
  }
  throw new Error("send needs --to <name> or --role <role>");
}

function checkDepth() {
  const current = Math.max(Number(process.env.AOS_DELEGATE_DEPTH || 0), Number(process.env.MCSC_DEPTH || 0));
  const max = Number(process.env.AOS_A2A_MAX_DEPTH || 1);
  if (current >= max) throw new Error("A2A depth limit reached");
  return current;
}

async function clientFor(entry) {
  stripProxyEnv();
  const token = readToken(entry.name);
  if (!token) throw new Error(`no token for ${entry.name}`);
  const { clientMod } = await sdk(); // throws first so a missing SDK is reported before target errors
  const u = new URL(entry.cardUrl);
  const client = await new clientMod.ClientFactory().createFromUrl(u.origin, u.pathname);
  return { client, token };
}

const taskResult = (res, TaskState) => {
  if (!res || res.status === undefined) {
    return { taskId: res?.taskId ?? null, contextId: res?.contextId ?? null, state: "MESSAGE", artifacts: [], statusMessage: textOf(res?.parts) || null };
  }
  const state = typeof res.status.state === "number" && TaskState ? TaskState[res.status.state] : res.status.state;
  return {
    taskId: res.id,
    contextId: res.contextId,
    state,
    artifacts: (res.artifacts ?? []).map((a) => ({ name: a.name, text: textOf(a.parts) })),
    statusMessage: res.status.message ? textOf(res.status.message.parts) : null,
  };
};

export async function send({ to, role, text, from, timeoutMs = 360000, background = false } = {}) {
  const depth = checkDepth();
  await sdk(); // fail fast on a missing SDK before target resolution
  const entry = await resolveTarget({ to, role });
  const { client, token } = await clientFor(entry);
  const { sdk: sdkCore } = await sdk();
  const part = { content: { $case: "text", value: String(text ?? "") }, metadata: undefined, filename: "", mediaType: "text/plain" };
  const res = await client.sendMessage(
    {
      tenant: "",
      configuration: undefined,
      metadata: undefined,
      message: {
        messageId: crypto.randomUUID(), contextId: "", taskId: "", role: sdkCore.Role.ROLE_USER, parts: [part],
        metadata: { aos: { depth: depth + 1, caller: from || process.env.AOS_A2A_NAME || "unknown" } },
        extensions: [], referenceTaskIds: [],
      },
    },
    { serviceParameters: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(Number(timeoutMs)) },
  );
  // background=true: the echo/live server already answers with a task in "working", so returning the
  // first task result as-is satisfies "return as soon as the server returns a task id".
  return taskResult(res, sdkCore.TaskState);
}

export async function status({ to, taskId } = {}) {
  await sdk();
  const entry = await resolveTarget({ to });
  const { client, token } = await clientFor(entry);
  const { sdk: sdkCore } = await sdk();
  const res = await client.getTask(
    { tenant: "", id: String(taskId) },
    { serviceParameters: { Authorization: `Bearer ${token}` } },
  );
  return taskResult(res, sdkCore.TaskState);
}

export async function cancel({ to, taskId } = {}) {
  await sdk();
  const entry = await resolveTarget({ to });
  const { client, token } = await clientFor(entry);
  const { sdk: sdkCore } = await sdk();
  const res = await client.cancelTask(
    { tenant: "", id: String(taskId), metadata: undefined },
    { serviceParameters: { Authorization: `Bearer ${token}` } },
  );
  return taskResult(res, sdkCore.TaskState);
}

// Matches production_artifacts/ziel-c/spikes/p2b/reply.mjs: the live sidecar reads
// $AOS_A2A_INBOX/<name>/<taskId>.reply (default <sessionsDir()>/../a2a-inbox). WP-LIVE-core may move
// this into lib/a2a-inbox.mjs later.
export function reply({ taskId, text, name } = {}) {
  const who = name || process.env.AOS_A2A_NAME;
  if (!who) throw new Error("reply needs a name (--name or AOS_A2A_NAME)");
  if (!taskId || text == null) throw new Error("reply needs taskId and text");
  const id = validName(taskId); // L1: no path traversal in taskId
  const body = String(text);
  if (Buffer.byteLength(body, "utf8") > 8192) throw new Error("reply too large (max 8 KiB)");
  const dir = replyDir(who); // validName(who) inside; same root as the sidecar reader
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const file = join(dir, `${id}.reply`);
  writeFileSync(file, body, { mode: 0o600 });
  chmodSync(file, 0o600);
  return { path: file };
}
