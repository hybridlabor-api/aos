// A2A client library: send/status/cancel against registry targets, live-reply files via reply().
// Lazy-imports the SDK inside each function so the CLI never loads it for list/card/--help.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import { join } from "node:path";
import { list, readToken, validName } from "./a2a-registry.mjs";
import { replyDir } from "./a2a-inbox.mjs";
// lib/a2a-sdk-resolve.mjs keeps send working from an installed copy: the bare import, else
// require() from the installer-recorded package root (~/.agents/{lib,bin} have no node_modules).
import { a2aImport, SDK_MISSING } from "./a2a-sdk-resolve.mjs";
import { sendRemote } from "./a2a-remote.mjs";

const validPeerIdFromRemote = (to) => {
  const id = String(to).slice(7);
  if (!/^[a-z0-9._-]{1,64}$/.test(id)) throw new Error(`invalid remote peer id (use [a-z0-9._-], max 64): ${id.slice(0, 64)}`);
  return id;
};

const stripProxyEnv = () => {
  for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete process.env[k];
  process.env.NO_PROXY = "127.0.0.1,localhost,::1";
  process.env.no_proxy = "127.0.0.1,localhost,::1";
};

const sdk = async () => {
  try {
    return {
      sdk: await a2aImport("@a2a-js/sdk"),
      clientMod: await a2aImport("@a2a-js/sdk/client"),
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

export async function resolveTarget({ to, role }) {
  const entries = list();
  if (to) {
    const byName = entries.find((x) => x.name === to);
    if (byName) return byName;
    const byLabel = entries.filter((x) => x.label && String(x.label).toLowerCase() === String(to).toLowerCase());
    if (byLabel.length > 1) {
      const candidates = byLabel.map((x) => `${x.name} (${x.label})`).join(", ");
      throw new Error(`multiple sessions match "${to}": ${candidates}`);
    }
    if (byLabel.length === 1) return byLabel[0];
    throw new Error(`no live registry entry for "${to}"`);
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

export function checkDepth() {
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

const TERMINAL_STATES = ["TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED"];
const RETURN_NOW_STATES = ["TASK_STATE_AUTH_REQUIRED", "TASK_STATE_INPUT_REQUIRED"];
const POLL_INTERVAL_MS = 2000;
const MAX_TRANSIENT_GETTASK = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Sequential-fold for the long-send problem: Node's fetch (undici) aborts a request that gets no
// response headers within 300 s (headersTimeout). A blocking SendMessage for a slow peer dies with
// "fetch failed" after 300 s even though the peer is still working. So for every long call
// (timeout beyond the threshold below, plus every background=true call) we send non-blocking
// (SendMessageConfiguration.returnImmediately, the "return as soon as the task exists" path) and
// then poll GetTask ourselves. AOS_A2A_POLL_THRESHOLD_MS is an override read at call time (tests force 0).
const pollThresholdMs = () => {
  const raw = process.env.AOS_A2A_POLL_THRESHOLD_MS;
  if (raw != null && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 240000;
};

// Retries a fetcher around transient errors for up to maxRetries consecutive failures
// (the counter resets on any success). Exported for tests; send() uses it for GetTask polls.
export async function withTransientRetry(fn, { maxRetries = MAX_TRANSIENT_GETTASK, deadline = Infinity, sleepFn = sleep, now = Date.now } = {}) {
  let failures = 0;
  for (;;) {
    try {
      const value = await fn();
      failures = 0;
      return value;
    } catch (e) {
      failures += 1;
      const left = deadline - now();
      if (failures > maxRetries || left <= 0) throw e;
      await sleepFn(Math.min(50, left)); // short backoff; the poll loop enforces the real cadence
    }
  }
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

export async function send({ to, role, text, from, timeoutMs = 360000, background = false, taskId = "", goRef = "", depth } = {}) {
  // The effective depth is the higher of the environment depth (frozen at spawn time) and an
  // explicitly passed option (bin/aos-a2a-mcp.mjs passes max(env, highest pulled inbound depth)).
  // An effective depth at/above AOS_A2A_MAX_DEPTH is rejected, so a relayed loop never re-grows.
  const effectiveDepth = Math.max(
    checkDepth(),
    depth == null ? 0 : Number(depth) || 0,
  );
  if (effectiveDepth >= Number(process.env.AOS_A2A_MAX_DEPTH || 1)) throw new Error("A2A depth limit reached");
  if (String(to ?? "").startsWith("remote:")) {
    const id = validPeerIdFromRemote(to);
    const r = await sendRemote({ id, text, from, depth: effectiveDepth, timeoutMs });
    return { taskId: r.taskId, contextId: null, state: r.state, artifacts: [{ name: id, text: r.text }], statusMessage: null };
  }
  await sdk(); // fail fast on a missing SDK before target resolution
  const entry = await resolveTarget({ to, role });
  const { client, token } = await clientFor(entry);
  const { sdk: sdkCore } = await sdk();
  const part = { content: { $case: "text", value: String(text ?? "") }, metadata: undefined, filename: "", mediaType: "text/plain" };
  const auth = { serviceParameters: { Authorization: `Bearer ${token}` } };
  const timeout = Number(timeoutMs);
  // background=true must also stop holding one blocking request: use the non-blocking path and poll.
  const poll = background || timeout > pollThresholdMs();
  const message = {
    messageId: crypto.randomUUID(), contextId: "", taskId: String(taskId ?? ""), role: sdkCore.Role.ROLE_USER, parts: [part],
    // Follow-up GO reference: metadata.aos.goRef carries the TRANSPORTED reference only. It
    // never satisfies the gate by itself; the receiver verifies it READ-ONLY (no consume) and
    // only then resumes the task — the session's own go-gate consumes the real single-use
    // token when the guarded command actually runs. A follow-up whose TEXT is "GO ..." is
    // ignored (logged as ignored GO text). The reference is a pointer, not a GO.
    metadata: goRef
      ? { aos: { depth: effectiveDepth + 1, caller: from || process.env.AOS_A2A_NAME || "unknown", goRef: String(goRef).slice(0, 128) } }
      : { aos: { depth: effectiveDepth + 1, caller: from || process.env.AOS_A2A_NAME || "unknown" } },
    extensions: [], referenceTaskIds: [],
  };
  const res = await client.sendMessage(
    {
      tenant: "",
      // returnImmediately: the SDK returns as soon as the task exists instead of blocking until
      // the terminal state (this is the path --background relied on for the early task id).
      configuration: poll ? { returnImmediately: true } : undefined,
      metadata: undefined, message,
    },
    { ...auth, signal: AbortSignal.timeout(timeout) },
  );
  let result = taskResult(res, sdkCore.TaskState);
  // background=true: the echo/live server already answers with a task in "working", so returning the
  // first task result as-is satisfies "return as soon as the server returns a task id".
  if (!poll || !result.taskId) return result;

  const deadline = Date.now() + timeout;
  const timedOut = () => Date.now() >= deadline;
  for (;;) {
    if (TERMINAL_STATES.includes(result.state) || RETURN_NOW_STATES.includes(result.state)) return result;
    if (timedOut()) break;
    let st;
    try {
      st = await withTransientRetry(
        () => client.getTask({ tenant: "", id: result.taskId }, { ...auth, signal: AbortSignal.timeout(Math.min(deadline - Date.now(), 10000)) }),
        { deadline },
      );
    } catch (e) {
      if (timedOut()) break; // poll aborted by the overall deadline: fall through to cancel+TimeoutError
      throw e;
    }
    const next = taskResult(st, sdkCore.TaskState);
    result = next.taskId != null ? next : result; // don't clobber a healthy result with junk
    if (timedOut()) break;
    await sleep(Math.min(POLL_INTERVAL_MS, Math.max(deadline - Date.now(), 0)));
  }
  try {
    await client.cancelTask({ tenant: "", id: result.taskId, metadata: undefined }, { ...auth, signal: AbortSignal.timeout(10000) });
  } catch { /* best effort: the peer may already be gone */ }
  const err = new Error(`aos-a2a send timed out after ${timeout} ms (task ${result.taskId} cancelled)`);
  err.name = "TimeoutError";
  throw err;
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
