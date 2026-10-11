// A2A remote peers: outbound-only HTTPS JSON-RPC client with a strict allow-list.
// No SDK, no new dependency: node:https + node:dns only. Secrets never leave this module and are
// never logged, printed or embedded in an error message; they are only sent to the pinned host.
import https from "node:https";
import crypto from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promises as dnsPromises } from "node:dns";
import { checkDepth } from "./a2a-client.mjs";
import { formatInjection } from "./a2a-inbox.mjs";

const CARD_MAX_BYTES = 256 * 1024;
const DEFAULT_MAX_CHARS = 8192;
const A2A_VERSION = "1.0";
const TASK_STATE_NAMES = [
  "TASK_STATE_UNSPECIFIED",
  "TASK_STATE_SUBMITTED",
  "TASK_STATE_WORKING",
  "TASK_STATE_INPUT_REQUIRED",
  "TASK_STATE_COMPLETED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_FAILED",
  "TASK_STATE_REJECTED",
];

const remoteFile = () => process.env.AOS_A2A_REMOTE_FILE || join(homedir(), ".aos", "a2a-remote.json");
const secretsFile = () => process.env.AOS_SECRETS_ENV || join(homedir(), ".aos", "secrets.env");
const allowLoopback = () => process.env.AOS_A2A_REMOTE_ALLOW_LOOPBACK === "1";

// The one TLS backdoor that must never be inherited from the caller's env.
function refuseDisabledTls() {
  if (String(process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? "") === "0") {
    throw new Error("refusing to run with NODE_TLS_REJECT_UNAUTHORIZED=0: remote peers require verified TLS");
  }
}

const scrub = (secret, s) => (secret ? String(s).split(secret).join("[redacted]") : String(s));

// Errors (including tls/dns transport errors) leave the secret out of their message; objects pass through.
const scrubError = (e, secret) => {
  if (e instanceof Error && secret) e.message = scrub(secret, e.message);
  return e;
};

const validPeerId = (id) => {
  const n = String(id ?? "");
  if (!n || n.length > 64 || !/^[a-z0-9._-]+$/.test(n)) {
    throw new Error(`invalid remote peer id: ${JSON.stringify(n.slice(0, 64))} (use [a-z0-9._-], max 64)`);
  }
  return n;
};

// Read at most maxBytes (refuse anything larger, never partial-read into a JSON parse).
function requestBody(res, maxBytes, secret) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    res.on("data", (c) => {
      n += c.length;
      if (n > maxBytes) {
        res.destroy();
        reject(new Error(scrub(secret, `remote response too large (${maxBytes} byte limit)`)));
        return;
      }
      chunks.push(c);
    });
    res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    res.on("error", (e) => reject(new Error(scrub(secret, e?.message ?? "response error"))));
  });
}

function request(url, { method, headers, ca, maxBytes, timeoutMs, body, secret = "" } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(String(url));
    } catch {
      return reject(new Error(`invalid URL (redacted)`));
    }
    if (u.protocol !== "https:") {
      return reject(new Error("https required: plain http is refused for remote peers"));
    }
    refuseDisabledTls();
    let done = false;
    // Only scrub Strings and error Messages: the resolved status/body object must never be
    // coerced through String(), which would turn it into "[object Object]" (HTTP undefined).
    const settle = (fn, v) => {
      if (!done) {
        done = true;
        if (typeof v === "string") return fn(scrub(secret, v));
        if (v instanceof Error) return fn(scrubError(v, secret));
        fn(v);
      }
    };
    const req = https.request(
      u,
      { method, headers, ca: ca || undefined, rejectUnauthorized: true }, // default TLS verification; CA only via AOS_A2A_REMOTE_CA
      (res) => {
        res.on("aborted", () => settle(reject, new Error("remote response aborted")));
        const t = Number(timeoutMs);
        if (Number.isFinite(t) && t > 0) {
          const timer = setTimeout(() => {
            req.destroy();
            settle(reject, new Error(`remote request timed out after ${(t / 1000).toFixed(0)}s`));
          }, t);
          res.on("end", () => clearTimeout(timer));
        }
        requestBody(res, maxBytes, secret).then(
          (b) => settle(resolve, { status: res.statusCode, headers: res.headers, body: b }),
          (e) => settle(reject, e),
        );
      },
    );
    req.on("error", (e) => settle(reject, new Error(scrub(secret, `remote request failed: ${e?.code ?? "ERR"} ${e?.message ?? "request error"}`))));
    if (body != null) req.write(body);
    req.end();
  });
}

const secureFileMode = (file) => {
  let st;
  try { st = statSync(file); } catch {
    throw new Error(`cannot stat ${file}`);
  }
  if ((st.mode & 0o777) !== 0o600) throw new Error(`${file} must have file mode 0600`);
};

function parseEnvFile(file) {
  secureFileMode(file);
  const out = new Map();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    const eq = l.indexOf("=");
    if (eq <= 0) continue;
    out.set(l.slice(0, eq).trim(), l.slice(eq + 1).replace(/^["']|["']$/g, ""));
  }
  return out;
}

function secretValue(envName) {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(String(envName ?? ""))) {
    throw new Error(`invalid secret env name in remote allow-list (use [A-Z_][A-Z0-9_])`);
  }
  let v = process.env[envName];
  if (v == null || v === "") {
    // The file-mode check (0600) must surface BEFORE any DNS or network access; an absent file is
    // tolerated here, a wrong mode is not.
    const file = secretsFile();
    let st = null;
    try { st = statSync(file); } catch { /* no secrets file at all */ }
    if (st && (st.mode & 0o777) !== 0o600) throw new Error(`${file} must have file mode 0600`);
    if (st) v = parseEnvFile(file).get(envName);
  }
  if (v == null || v === "") throw new Error(`no secret found for ${envName} (env or ${secretsFile()})`);
  return v;
}

// Validate + load the allow-list. Refuses: wrong file mode, bad peer ids, non-https cardUrls,
// unsupported auth schemes. Never returns a secret.
export function loadPeers(file = remoteFile()) {
  secureFileMode(file);
  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`remote allow-list is not valid JSON: ${file}`);
  }
  const peers = data?.peers;
  if (!peers || typeof peers !== "object" || Array.isArray(peers)) {
    throw new Error(`remote allow-list must be {"peers":{…}}: ${file}`);
  }
  const out = new Map();
  for (const [id, p] of Object.entries(peers)) {
    validPeerId(id);
    let cu;
    try { cu = new URL(String(p?.cardUrl ?? "")); } catch {
      throw new Error(`remote peer "${id}": cardUrl is not a URL`);
    }
    if (cu.protocol !== "https:") throw new Error(`remote peer "${id}": cardUrl must be https`);
    const auth = p?.auth;
    const scheme = auth?.scheme;
    if (scheme !== "bearer" && scheme !== "apiKey") {
      throw new Error(`remote peer "${id}": auth.scheme must be "bearer" or "apiKey"`);
    }
    if (scheme === "apiKey") {
      const h = String(auth?.header ?? "X-Api-Key");
      if (!/^[A-Za-z0-9-]{1,64}$/.test(h)) throw new Error(`remote peer "${id}": auth.header is not a valid header name`);
    }
    if (Number.isFinite(Number(p?.maxChars)) && Number(p.maxChars) <= 0) {
      throw new Error(`remote peer "${id}": maxChars must be a positive number`);
    }
    out.set(id, { id, cardUrl: cu, auth: { scheme, env: auth?.env, header: auth?.header }, maxChars: Number(p?.maxChars) > 0 ? Number(p.maxChars) : DEFAULT_MAX_CHARS });
  }
  return out;
}

// 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7, fe80::/10 (plus :: and 0/8).
function isPublicAddress(addr) {
  const a = String(addr).split("%")[0].toLowerCase();
  if (a.includes(":")) {
    if (a === "::1" || a === "::" ) return false;
    if (/^f[cd]/.test(a)) return false; // fc00::/7 (fd..) and fe80::/10 lives below too
    if (/^fe[89ab]/.test(a)) return false;
    return true;
  }
  const o = a.split(".").map(Number);
  if (o.length !== 4 || o.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  const [f, s] = o;
  if (f === 127 || f === 10 || f === 0) return false;
  if (f === 172 && s >= 16 && s <= 31) return false;
  if (f === 192 && s === 168) return false;
  if (f === 169 && s === 254) return false;
  return true;
}

async function assertPublicHost(hostname) {
  if (allowLoopback()) return; // tests only
  let addrs;
  try {
    addrs = await dnsPromises.lookup(hostname, { all: true, family: 0 });
  } catch (e) {
    throw new Error(`remote peer host could not be resolved: ${hostname}`);
  }
  if (!addrs?.length) throw new Error(`remote peer host did not resolve: ${hostname}`);
  for (const { address } of addrs) {
    if (!isPublicAddress(address)) {
      throw new Error(`remote peer refused: ${hostname} resolves to non-public address ${address} (SSRF guard)`);
    }
  }
}

// Only endpoint URLs on the cardUrl host/port, https. Refuses when none match (spoofed card).
function endpointOf(card, hostPort) {
  const candidates = [];
  if (typeof card?.url === "string" && card.url) candidates.push(card.url);
  const iface = card?.supportedInterfaces ?? (Array.isArray(card?.additionalInterfaces) ? card.additionalInterfaces : []);
  for (const i of iface) candidates.push(typeof i === "string" ? i : i?.url);
  const usable = [];
  for (const raw of candidates) {
    let u;
    try { u = new URL(String(raw)); } catch { continue; }
    if (u.protocol === "https:" && u.host === hostPort) usable.push(u);
  }
  if (!usable.length) {
    throw new Error(`refused remote peer card: no interface URL on the allow-listed host ${hostPort} (card spoof suspected)`);
  }
  return usable[0];
}

function authHeaderFor(card, peer, secret) {
  const offered = Object.values(card?.securitySchemes ?? {});
  const wants = peer.auth.scheme;
  if (wants === "bearer") {
    if (!offered.some((s) => s?.type === "http" && /^bearer$/i.test(String(s?.scheme ?? "")))) {
      throw new Error(`remote peer "${peer.id}" does not offer bearer auth in its card`);
    }
    return { header: "Authorization", value: `Bearer ${secret}` };
  }
  if (!offered.some((s) => s?.type === "apiKey")) {
    throw new Error(`remote peer "${peer.id}" does not offer apiKey auth in its card`);
  }
  return { header: peer.auth.header || "X-Api-Key", value: secret };
}

const stateName = (s) =>
  typeof s === "number" && s >= 0 && s < TASK_STATE_NAMES.length ? TASK_STATE_NAMES[s]
  : String(s ?? "").startsWith("TASK_STATE_") ? String(s) : null;

const partText = (p) => p?.content?.$case === "text" ? p.content.value : (p?.text ?? "");

function artifactText(task) {
  if (task?.status?.message?.parts?.length) return task.status.message.parts.map(partText).join("");
  return (task?.artifacts ?? []).flatMap((a) => (a?.parts ?? []).map(partText)).join("");
}

export async function sendRemote({ id, text, from, depth, timeoutMs } = {}) {
  refuseDisabledTls();
  const peerId = validPeerId(id);
  const peers = loadPeers(remoteFile());
  const peer = peers.get(peerId);
  if (!peer) throw new Error(`peer id "${peerId}" is not in the allow-list ${remoteFile()}; add it there first`);
  const d = depth != null ? Number(depth) : checkDepth();

  // Check order (each before any DNS or network access): file modes (allow-list above, secrets here)
  // -> allow-list lookup -> https scheme (validated in loadPeers) -> SSRF/DNS guard -> card fetch.
  // The secret is read now but is only ever sent to the pinned host.
  const secret = secretValue(peer.auth.env);

  const cardUrl = peer.cardUrl;
  await assertPublicHost(cardUrl.hostname);
  const caPath = process.env.AOS_A2A_REMOTE_CA;
  const ca = caPath ? readFileSync(caPath, "utf8") : undefined;
  const base = { ca, timeoutMs: Number(timeoutMs) > 0 ? Number(timeoutMs) : 360000, headers: { accept: "application/json", "a2a-version": A2A_VERSION } };

  const cardRes = await request(cardUrl, { ...base, method: "GET", maxBytes: CARD_MAX_BYTES });
  const status = Number(cardRes?.status) || 0;
  if (status >= 300 && status < 400) {
    throw new Error(`remote peer card redirects (HTTP ${status}); redirects are not followed`);
  }
  if (status !== 200) throw new Error(`remote card fetch failed: HTTP ${cardRes?.status ?? status}`);
  let card;
  try { card = JSON.parse(cardRes.body); } catch {
    throw new Error("remote peer card is not valid JSON");
  }
  const endpoint = endpointOf(card, cardUrl.host);
  await assertPublicHost(endpoint.hostname); // host already pinned by endpointOf, but keep the guard symmetric

  const auth = authHeaderFor(card, peer, secret);

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "SendMessage",
    params: {
      message: {
        messageId: crypto.randomUUID(),
        contextId: "",
        taskId: "",
        role: "ROLE_USER",
        parts: [{ text: String(text ?? "") }],
        metadata: { aos: { depth: d + 1, caller: from || process.env.AOS_A2A_NAME || "unknown" } },
      },
      configuration: {},
      metadata: {},
    },
  });
  const sent = await request(endpoint, {
    ...base,
    method: "POST",
    maxBytes: CARD_MAX_BYTES,
    body,
    secret,
    headers: {
      ...base.headers,
      "content-type": "application/json",
      [auth.header]: auth.value,
    },
  });
  const sentSt = Number(sent?.status) || 0;
  if (sentSt >= 300 && sentSt < 400) {
    throw new Error(`remote peer redirects (HTTP ${sentSt}); redirects are not followed`);
  }
  if (sentSt !== 200) throw new Error(scrub(secret, `remote SendMessage failed: HTTP ${sent?.status ?? sentSt}`));
  let rpc;
  try { rpc = JSON.parse(sent.body); } catch {
    throw new Error("remote peer returned invalid JSON-RPC");
  }
  if (rpc?.error) throw new Error(scrub(secret, `remote SendMessage failed: ${rpc.error.message ?? "JSON-RPC error"}`));

  // The remote text is DATA: it is never parsed for tokens, commands or task ids of our own.
  const task = rpc.result?.task ?? rpc.result;
  const raw = String(artifactText(task) ?? "").slice(0, peer.maxChars);
  const injection = formatInjection({ from: "", text: raw, depth: d > 0 ? d : undefined });
  const wrapped = injection.replace("[a2a from unknown]", `[a2a remote:${peerId}]`);
  return {
    taskId: task?.id ?? null,
    state: stateName(task?.status?.state),
    text: wrapped,
  };
}
