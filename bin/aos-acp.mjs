#!/usr/bin/env node
// aos-acp — minimal ACP (Agent Client Protocol) client for the master-session
// skill. Spawns one ACP agent over stdio JSON-RPC, runs one prompt, streams the
// agent's text to stdout and a JSONL run log, and maps session/request_permission
// onto the AOS GO gate: guarded commands (same list as go-gate.mjs) are approved
// only with a valid GO token (~/.aos/go/<name>.token), everything else follows
// --allow-default (deny unless told otherwise). No AO daemon, no dependencies.
//
//   aos-acp <claude|codex|opencode|agy> --name <worker> [--cwd <dir>]
//           (--prompt "<text>" | --prompt-file <f>) [--allow-default deny|allow]
//           [--go-wait <sec>] [--consume|--no-consume] [--log <file>]
//           [--model <id>] [--timeout <sec>] [--cmd "<custom agent command>"]

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createInterface } from "node:readline";

// Repo layout first, then the installed layout: the installer puts go-gate.mjs and
// trail.mjs in ~/.aos/bin (bin/ is copied to ~/.agents/bin, where ../.claude does not exist).
const here = dirname(fileURLToPath(import.meta.url));
const loadFrom = async (candidates) => {
  const f = candidates.find((c) => existsSync(c));
  return f ? import(pathToFileURL(f).href) : null;
};
const gateMod = await loadFrom([
  join(here, "..", ".claude", "hooks", "go-gate.mjs"),
  join(homedir(), ".aos", "bin", "go-gate.mjs"),
  join(homedir(), ".claude", "hooks", "go-gate.mjs"),
]);
if (!gateMod) throw new Error("go-gate.mjs not found (run the AOS installer): refusing to run without the GO gate");
const { isGuardedCommand, hardBlockReason, slug, tokenGrantsGo, setGateContext, readBlockTs, markBlock, nameKey } = gateMod;
const emitTrail = (await loadFrom([
  join(here, "..", "mcps", "mcsc", "packages", "core", "src", "trail.js"),
  join(homedir(), ".aos", "bin", "trail.mjs"),
]))?.emitTrail ?? (async () => {});

export const ADAPTERS = {
  claude: { cmd: ["npx", "-y", "@agentclientprotocol/claude-agent-acp"], consume: false },
  codex: { cmd: ["npx", "-y", "@agentclientprotocol/codex-acp"], consume: true },
  opencode: { cmd: ["opencode", "acp"], consume: false, cwdFlag: "--cwd" },
  // antigravity-acp (MIT) is third-party; its README states that driving agy
  // through it breaches Google's Antigravity terms. Not shipped: use mcsc.
  agy: null,
};

export function commandOf(toolCall = {}) {
  const r = toolCall.rawInput || {};
  const c = r.command ?? r.cmd ?? r.script ?? r.CommandLine ?? "";
  return Array.isArray(c) ? c.join(" ") : typeof c === "string" ? c : "";
}

export function isGuarded(cmd) {
  return isGuardedCommand(cmd);
}

function pickOption(options, kinds) {
  for (const k of kinds) {
    const o = options.find((x) => x.kind === k);
    if (o) return o.optionId;
  }
  return null;
}

// Returns the JSON-RPC result for a session/request_permission.
export async function decidePermission(params, opts, log = () => {}) {
  const options = params.options || [];
  const cmd = commandOf(params.toolCall);
  // Same block cooldown as the hook, keyed by the worker name (the ACP session id is per run).
  const key = opts.name && nameKey ? nameKey(opts.name) : "";
  setGateContext?.({ cwd: opts.cwd || "", blockTs: key ? readBlockTs(key) : 0 });
  const guarded = !!cmd && isGuarded(cmd);
  const hard = cmd ? hardBlockReason(cmd) : null;
  let allow = opts.allowDefault === "allow" && !hard;
  let reason = `default ${opts.allowDefault}`;
  if (hard) {
    allow = false;
    reason = hard;
  } else if (guarded) {
    const deadline = Date.now() + (opts.goWait || 0) * 1000;
    let r = tokenGrantsGo(opts.name, { consume: opts.consume });
    if (!r.ok && opts.goWait) log("permission_pending", { command: cmd, waiting_s: opts.goWait });
    while (!r.ok && Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 1000));
      r = tokenGrantsGo(opts.name, { consume: opts.consume });
    }
    allow = r.ok;
    reason = r.ok ? "GO token" : r.reason;
  }
  if (!allow && (hard || guarded)) markBlock?.(key);
  const optionId = allow
    ? pickOption(options, ["allow_once", "allow_always"])
    : pickOption(options, ["reject_once", "reject_always"]);
  log("permission", { command: cmd || null, title: params.toolCall?.title, guarded, allow, reason, optionId });
  return optionId ? { outcome: { outcome: "selected", optionId } } : { outcome: { outcome: "cancelled" } };
}

export class AcpClient {
  constructor(cmd, { cwd, env, onNotify, onRequest, log }) {
    this.pending = new Map();
    this.nextId = 1;
    this.log = log;
    this.child = spawn(cmd[0], cmd.slice(1), { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stderr.on("data", (d) => log("agent_stderr", { text: String(d).trimEnd() }));
    this.exited = new Promise((res) => this.child.on("exit", (code, sig) => {
      for (const p of this.pending.values()) p.reject(new Error(`agent exited (${code ?? sig})`));
      res(code);
    }));
    createInterface({ input: this.child.stdout }).on("line", async (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return log("agent_stdout", { text: line }); }
      if (msg.method && msg.id !== undefined) {
        try {
          const result = await onRequest(msg.method, msg.params || {});
          this.write({ jsonrpc: "2.0", id: msg.id, result });
        } catch (e) {
          this.write({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: e.message } });
        }
      } else if (msg.method) {
        onNotify(msg.method, msg.params || {});
      } else if (this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(`${msg.error.code}: ${msg.error.message}`)) : p.resolve(msg.result);
      }
    });
  }
  write(obj) { this.child.stdin.write(JSON.stringify(obj) + "\n"); }
  request(method, params) {
    const id = this.nextId++;
    this.log("send", { method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }
  notify(method, params) { this.write({ jsonrpc: "2.0", method, params }); }
}

// Same agenttrail protocol as mcsc's adapters (SessionStart/SessionEnd, PreToolUse/PostToolUse),
// so the GO board reads ACP workers and mcsc runs from one source.
const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : "Tool");

export function trailToolEvent(u, seen, cwd) {
  const prev = seen.get(u.toolCallId) || {};
  const info = { title: u.title ?? prev.title, kind: u.kind ?? prev.kind };
  seen.set(u.toolCallId, info);
  const done = u.status === "completed" || u.status === "failed";
  if (u.sessionUpdate === "tool_call_update" && !done) return null;
  const tool_input = {};
  const file = u.locations?.[0]?.path ?? prev.file;
  if (typeof file === "string" && file) tool_input.file_path = isAbsolute(file) ? file : resolve(cwd, file);
  info.file = tool_input.file_path;
  const command = commandOf(u);
  if (command) tool_input.command = command;
  return { hook_event_name: done ? "PostToolUse" : "PreToolUse", tool_name: cap(info.kind || info.title), tool_input };
}

function textOf(block) {
  return block && block.type === "text" ? block.text : "";
}

export async function run(opts) {
  const logFile = opts.log || join(homedir(), ".aos", "acp", `${slug(opts.name)}.jsonl`);
  mkdirSync(dirname(logFile), { recursive: true });
  const log = (event, data = {}) => {
    try { appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), name: opts.name, event, ...data }) + "\n"); } catch { /* best effort */ }
  };

  const adapter = ADAPTERS[opts.adapter];
  const cmd = opts.cmd ? ["sh", "-c", opts.cmd] : adapter?.cmd;
  if (!cmd) throw new Error(opts.adapter === "agy"
    ? "agy has no sanctioned ACP adapter (antigravity-acp breaches Google's Antigravity terms); delegate via the mcsc skill instead"
    : `unknown adapter "${opts.adapter}" (claude|codex|opencode)`);
  if (adapter?.cwdFlag && !opts.cmd) cmd.push(adapter.cwdFlag, opts.cwd);
  if (/fable/i.test(opts.model || "")) throw new Error(`model "${opts.model}" rejected: workers run on opus, sonnet or haiku only`);
  const consume = opts.consume ?? adapter?.consume ?? true;
  log("start", { adapter: opts.adapter, cmd: cmd.join(" "), cwd: opts.cwd, allow_default: opts.allowDefault, consume, model: opts.model || "adapter default" });

  const trail = { session_id: `aos-acp-${process.pid}-${Date.now()}`, cwd: opts.cwd, agent: `${opts.adapter}:${opts.name}` };
  const seenTools = new Map();
  emitTrail({ ...trail, hook_event_name: "SessionStart" });
  let sessionId;
  const out = opts.stdout || process.stdout;
  const client = new AcpClient(cmd, {
    cwd: opts.cwd,
    env: { ...process.env, AOS_SESSION_NAME: opts.name, AOS_ACP_CLIENT: "1" },
    log,
    onNotify: (method, p) => {
      if (method !== "session/update") return log("notify", { method, params: p });
      const u = p.update || {};
      if (u.sessionUpdate === "agent_message_chunk") {
        const t = textOf(u.content);
        if (t) { out.write(t); log("text", { text: t }); }
      } else if (u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update") {
        log(u.sessionUpdate, { id: u.toolCallId, title: u.title, kind: u.kind, status: u.status, command: commandOf(u) || undefined });
        const ev = trailToolEvent(u, seenTools, opts.cwd);
        if (ev) emitTrail({ ...trail, ...ev });
      } else log("update", { kind: u.sessionUpdate });
    },
    onRequest: (method, p) => {
      if (method === "session/request_permission") return decidePermission(p, { ...opts, consume }, log);
      throw new Error(`client does not implement ${method}`);
    },
  });

  const cancel = () => { if (sessionId) client.notify("session/cancel", { sessionId }); setTimeout(() => client.child.kill("SIGKILL"), 5000).unref(); };
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const timer = opts.timeout ? setTimeout(() => { log("timeout", {}); cancel(); }, opts.timeout * 1000) : null;

  try {
    const init = await client.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "aos-acp", version: "0.1.0" },
    });
    log("initialized", { agent: init?.agentInfo, auth: init?.authMethods });
    ({ sessionId } = await client.request("session/new", { cwd: opts.cwd, mcpServers: [] }));
    log("session", { sessionId });
    // ACP session config option "model": claude-agent-acp, codex-acp and opencode all implement it.
    if (opts.model) await client.request("session/set_config_option", { sessionId, configId: "model", value: opts.model });
    const res = await client.request("session/prompt", { sessionId, prompt: [{ type: "text", text: opts.prompt }] });
    out.write("\n");
    log("done", { stopReason: res?.stopReason });
    return res?.stopReason === "end_turn" ? 0 : 1;
  } catch (e) {
    log("error", { message: e.message });
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
    client.child.kill();
    await emitTrail({ ...trail, hook_event_name: "SessionEnd" });
  }
}

export function parseArgs(argv) {
  const o = { adapter: argv[0], cwd: process.cwd(), allowDefault: "deny", goWait: 0 };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === "--name") o.name = v, i++;
    else if (a === "--cwd") o.cwd = v, i++;
    else if (a === "--prompt") o.prompt = v, i++;
    else if (a === "--prompt-file") o.prompt = readFileSync(v, "utf8"), i++;
    else if (a === "--allow-default") o.allowDefault = v, i++;
    else if (a === "--go-wait") o.goWait = Number(v), i++;
    else if (a === "--timeout") o.timeout = Number(v), i++;
    else if (a === "--log") o.log = v, i++;
    else if (a === "--model") o.model = v, i++;
    else if (a === "--cmd") o.cmd = v, i++;
    else if (a === "--consume") o.consume = true;
    else if (a === "--no-consume") o.consume = false;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.adapter || !o.name || !o.prompt) throw new Error(USAGE);
  if (!["deny", "allow"].includes(o.allowDefault)) throw new Error("--allow-default must be deny or allow");
  return o;
}

const USAGE = "usage: aos-acp <claude|codex|opencode> --name <worker> --prompt <text> [--cwd <dir>] [--allow-default deny|allow] [--go-wait <sec>] [--no-consume] [--model <id>] [--log <file>] [--timeout <sec>]";
const invokedAs = (() => { try { return realpathSync(process.argv[1] || ""); } catch { return ""; } })();
if (invokedAs === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some((a) => a === "--help" || a === "-h")) { console.log(`aos-acp: ${USAGE}`); process.exit(0); }
  Promise.resolve().then(() => run(parseArgs(process.argv.slice(2))))
    .then((code) => process.exit(code), (e) => { console.error(`aos-acp: ${e.message}`); process.exit(2); });
}
