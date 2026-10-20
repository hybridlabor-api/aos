#!/usr/bin/env node
// aos-acp — minimal ACP (Agent Client Protocol) client for the master-session
// skill. Spawns one ACP agent over stdio JSON-RPC, runs one prompt, streams the
// agent's text to stdout and a JSONL run log, and maps session/request_permission
// onto the AOS GO gate: guarded commands (same list as go-gate.mjs) are approved
// only with a valid GO token (~/.aos/go/<name>.token), everything else follows
// --allow-default (deny unless told otherwise). With --allow-default scoped,
// deny turns into path-scoped decisions from lib/a2a-permissions.mjs: writes
// must target the job worktree, unguarded shell commands must run in it, and
// everything else is refused (guarded commands still take the GO path). No AO daemon, no dependencies.
//
//   aos-acp <claude|codex|opencode|agy> --name <worker> [--cwd <dir>]
//           (--prompt "<text>" | --prompt-file <f>) [--allow-default deny|allow|scoped]
//           [--go-wait <sec>] [--consume|--no-consume] [--log <file>]
//           [--sandbox coop|wsl2] [--model <id>] [--timeout <sec>] [--print-timeout <sec>] [--cmd "<custom agent command>"]
//           [--with-mcp]
//   Workers start without MCP servers unless --with-mcp is given; see the MCP note above ADAPTERS.
//   agy runs `agy --print` (no ACP server, no per-tool permission requests): see agyArgs.

import "../lib/cli-help-guard.mjs";
import { spawn, spawnSync } from "node:child_process";
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
const { isGuardedCommand, hardBlockReason, slug, tokenGrantsGo, setGateContext, readBlockTs, markBlock, nameKey, commandTooLong, TOO_LONG_MESSAGE } = gateMod;
const permMod = await loadFrom([
  join(here, "..", "lib", "a2a-permissions.mjs"),
  join(homedir(), ".aos", "bin", "a2a-permissions.mjs"),
]);
const scopedDecide = permMod?.decide ?? (() => ({ allow: false, reason: "a2a-permissions.mjs not found; refusing to allow anything" }));
// Loaded only for --sandbox, so the installed layout (no ../lib) keeps working without the flag.
const loadSandbox = async () => {
  const m = await loadFrom([join(here, "..", "lib", "sandbox.mjs"), join(homedir(), ".aos", "bin", "sandbox.mjs")]);
  if (!m) throw new Error("sandbox.mjs not found (run the AOS installer): cannot honour --sandbox");
  return m;
};
const emitTrail = (await loadFrom([
  join(here, "..", "mcps", "mcsc", "packages", "core", "src", "trail.js"),
  join(homedir(), ".aos", "bin", "trail.mjs"),
]))?.emitTrail ?? (async () => {});
const opencodeNoMcpEnv = (await loadFrom([
  join(here, "..", "mcps", "mcsc", "packages", "core", "src", "no-mcp.js"),
  join(homedir(), ".aos", "bin", "no-mcp.mjs"),
]))?.opencodeNoMcpEnv ?? ((env) => env);
const codexNoMcpEnv = (await loadFrom([
  join(here, "..", "mcps", "mcsc", "packages", "core", "src", "no-mcp.js"),
  join(homedir(), ".aos", "bin", "no-mcp.mjs"),
]))?.codexNoMcpEnv ?? ((env) => env);
const agyChildEnv = (await loadFrom([
  join(here, "..", "mcps", "mcsc", "packages", "core", "src", "no-mcp.js"),
  join(homedir(), ".aos", "bin", "no-mcp.mjs"),
]))?.agyChildEnv ?? ((env) => env);

// Windows only: npx/opencode are .cmd shims that Node cannot spawn directly (ENOENT).
const cliSpawnMod = process.platform === "win32"
  ? await loadFrom([join(here, "..", "lib", "cli-spawn.js"), join(homedir(), ".aos", "bin", "cli-spawn.js")])
  : null;

// Routes cmd through lib/cli-spawn.js (PATH/PATHEXT resolve + cmd.exe wrapper for shims) on win32; identity elsewhere.
export function resolveWinCmd(cmd, { platform = process.platform, cli = cliSpawnMod?.default ?? cliSpawnMod, env = process.env, fs } = {}) {
  if (platform !== "win32" || !cli) return cmd;
  const o = { platform, env, ...(fs && { fs }) };
  const file = cli.resolveCommand(cmd[0], o);
  if (!file) return cmd;
  const inv = cli.buildInvocation(file, cmd.slice(1), o);
  return [inv.file, ...inv.args];
}

// MCP servers per adapter (default off, --with-mcp keeps them):
//   claude   session/new sends mcpServers: [] (unchanged); whether claude-agent-acp then also skips the
//            user's own configured servers is unverified.
//   codex    CODEX_CONFIG env sets mcp_servers.<name>.enabled=false per configured server (no-mcp.js). codex-acp
//            takes no -c flags, so the env is the only lever; the codex-acp path itself is not yet verified live.
//   opencode OPENCODE_CONFIG_CONTENT disables every server in the OpenCode config files (no-mcp.js).
//   agy      no per-run flag exists, so HOME points at a worker home (~/.aos/agy-worker-home) that mirrors the real
//            home but generates empty mcp_config.json files (no-mcp.js agyNoMcpEnv). Logins and dotfiles still
//            resolve; if the worker home cannot be built, agy runs with its MCP servers and one line says so.
export const ADAPTERS = {
  claude: { cmd: ["npx", "-y", "@agentclientprotocol/claude-agent-acp@0.86.0"], consume: false },
  codex: { cmd: ["npx", "-y", "@agentclientprotocol/codex-acp@2.1.1"], consume: true },
  opencode: { cmd: ["opencode", "acp"], consume: false, cwdFlag: "--cwd" },
  // agy has no ACP server. This target drives the vendor's own `agy --print` (the same call mcsc and
  // aos-a2a spawn make), not the third-party antigravity-acp shim. Print mode answers no per-tool
  // permission requests, so --allow-default maps onto agy's own flags (see agyArgs).
  agy: { print: true },
};

// --allow-default for agy, where aos-acp cannot see single tool calls:
//   deny   -> --mode plan                      (read-only planning)
//   scoped -> --mode accept-edits --sandbox    (edits accepted; paths are NOT narrowed to the worktree
//                                               by aos-acp, only by agy's sandbox and the aos-go-gate hook)
//   allow  -> --dangerously-skip-permissions
export function agyArgs(opts) {
  const args = [];
  if (opts.model) args.push("--model", opts.model);
  if (opts.allowDefault === "allow") args.push("--dangerously-skip-permissions");
  else if (opts.allowDefault === "scoped") args.push("--mode", "accept-edits", "--sandbox");
  else args.push("--mode", "plan");
  args.push("--print-timeout", `${opts.printTimeout ?? 900}s`, "--output-format", "json", "--print", opts.prompt);
  return args;
}

// The plan node a worker is for: --trail-node/--trail-plan, else the dispatcher's AOS_TRAIL_* env.
export function trailLink(opts, env = process.env) {
  return { id: opts.trailNode || env.AOS_TRAIL_NODE || "", plan: opts.trailPlan || env.AOS_TRAIL_PLAN || "" };
}
export function trailEnv(opts, env = process.env) {
  const { id, plan } = trailLink(opts, env);
  return { ...(id && { AOS_TRAIL_NODE: id }), ...(plan && { AOS_TRAIL_PLAN: plan }) };
}
export function trailTask(opts, env = process.env) {
  const { id, plan } = trailLink(opts, env);
  return id ? { task: { id, status: "doing", ...(plan && { plan }) } } : {};
}

// agy reports status SUCCESS with an empty response when its own print timeout fires, and waits
// forever on an open stdin, so: stdin is closed and success needs a non-empty response.
async function runPrint(opts, log, emitTrail, sandbox) {
  const args = agyArgs(opts);
  log("start", { adapter: "agy", cmd: `agy ${args.slice(0, -1).join(" ")} <prompt>`, cwd: opts.cwd, allow_default: opts.allowDefault, model: opts.model || "adapter default", ...(opts.sandbox && { sandbox: opts.sandbox }) });
  const trail = { session_id: `aos-acp-${process.pid}-${Date.now()}`, cwd: opts.cwd, agent: `agy:${opts.name}`, ...trailTask(opts) };
  emitTrail({ ...trail, hook_event_name: "SessionStart" });
  const out = opts.stdout || process.stdout;
  const [bin, ...binArgs] = sandbox ? sandbox.wrap(["agy", ...args], { cwd: opts.cwd }) : ["agy", ...args];
  const env = agyChildEnv({ ...process.env, AOS_SESSION_NAME: opts.name, AOS_ACP_CLIENT: "1", ...trailEnv(opts) }, { withMcp: opts.withMcp, warn: (m) => process.stderr.write(`aos-acp: ${m}\n`) });
  const child = spawn(bin, binArgs, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"], env, windowsHide: true });
  let stdout = "", stderr = "", timedOut = false;
  child.stdout.on("data", (d) => { stdout += d; });
  child.stderr.on("data", (d) => { stderr += d; });
  const stop = () => { child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 5000).unref(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const hardLimit = opts.timeout ? opts.timeout : (opts.printTimeout ?? 900) + 60;
  const timer = setTimeout(() => { timedOut = true; log("timeout", {}); stop(); }, hardLimit * 1000);
  try {
    const code = await new Promise((resolveExit, reject) => {
      child.on("error", reject);
      child.on("close", resolveExit);
    });
    let parsed = null;
    try { parsed = JSON.parse(stdout.trim()); } catch { /* not JSON: reported below */ }
    const response = typeof parsed?.response === "string" ? parsed.response : "";
    const printTimedOut = /print timeout/i.test(stderr);
    const ok = code === 0 && !timedOut && !printTimedOut && parsed?.status === "SUCCESS" && response.trim() !== "";
    if (response) { out.write(response); log("text", { text: response }); }
    out.write("\n");
    if (!ok && (printTimedOut || (parsed?.status === "SUCCESS" && response.trim() === ""))) {
      process.stderr.write("aos-acp: agy returned no answer (empty response; status SUCCESS is not trusted). Likely causes, not narrowed down: cold start (raise --print-timeout; 180s was not enough on the dev Mac on 2026-10-08), the agy project (mcsc passes --project mcsc-delegate), the login/auth state (run `agy` once interactively), or the model id (`agy models`).\n");
    }
    log("done", {
      stopReason: ok ? "end_turn" : timedOut || printTimedOut ? "timeout" : "error",
      exit: code, status: parsed?.status, conversation_id: parsed?.conversation_id,
      num_turns: parsed?.num_turns, duration_seconds: parsed?.duration_seconds, usage: parsed?.usage,
      stderr: ok ? undefined : stderr.slice(-400),
    });
    return ok ? 0 : 1;
  } catch (e) {
    log("error", { message: e.message });
    throw new Error(e.code === "ENOENT" ? "agy is not installed or not on PATH" : e.message);
  } finally {
    clearTimeout(timer);
    await emitTrail({ ...trail, hook_event_name: "SessionEnd" });
  }
}

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
  // A command the gate cannot read as text (an object, a number) is refused outright.
  const rawIn = params.toolCall?.rawInput || {};
  const odd = [rawIn.command, rawIn.cmd, rawIn.script, rawIn.CommandLine].some((v) => v != null && v !== "" && typeof v !== "string" && !Array.isArray(v));
  let allow = opts.allowDefault === "allow" && !hard && !odd;
  let reason = `default ${opts.allowDefault}`;
  if (hard || odd) {
    allow = false;
    reason = hard || "command in the permission request is not a string; the gate cannot read it";
  } else if (guarded) {
    const deadline = Date.now() + (opts.goWait || 0) * 1000;
    let r = tokenGrantsGo(opts.name, { consume: opts.consume });
    if (!r.ok && opts.goWait) log("permission_pending", { command: cmd, waiting_s: opts.goWait });
    while (!r.ok && Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 1000));
      r = tokenGrantsGo(opts.name, { consume: opts.consume });
    }
    allow = r.ok;
    reason = r.ok ? "GO token" : `${commandTooLong?.(cmd) ? `${TOO_LONG_MESSAGE}; ` : ""}${r.reason}`;
  } else if (opts.allowDefault === "scoped") {
    const d = scopedDecide(params.toolCall, { cwd: opts.cwd });
    allow = !!d.allow;
    reason = d.reason;
  }
  if (!allow && (hard || odd || guarded)) markBlock?.(key);
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
    const verbatim = process.platform === "win32" && /(^|[\\/])cmd(\.exe)?$/i.test(cmd[0]);
    this.child = spawn(cmd[0], cmd.slice(1), { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsVerbatimArguments: verbatim, windowsHide: true });
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

// Windows: kill() ends only the cmd.exe/npx wrapper; the agent below it keeps its pipes and its cwd.
function killTree(child) {
  if (process.platform === "win32" && child.pid) {
    try { spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch { /* already gone */ }
    return;
  }
  child.kill();
}

export async function run(opts) {
  const sandbox = opts.sandbox ? (opts.resolveSandbox || (await loadSandbox()).resolveSandbox)(opts.sandbox) : null;
  const logFile = opts.log || join(homedir(), ".aos", "acp", `${slug(opts.name)}.jsonl`);
  mkdirSync(dirname(logFile), { recursive: true });
  const log = (event, data = {}) => {
    try { appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), name: opts.name, event, ...data }) + "\n"); } catch { /* best effort */ }
  };

  const adapter = ADAPTERS[opts.adapter];
  if (adapter?.print && !opts.cmd) return runPrint(opts, log, emitTrail, sandbox);
  // No `sh` on a stock Windows PATH: run --cmd through cmd.exe, whose /s strips the outer quotes.
  let cmd = opts.cmd ? (process.platform === "win32" ? [process.env.ComSpec || "cmd.exe", "/d", "/s", "/c", `"${opts.cmd}"`] : ["sh", "-c", opts.cmd]) : adapter?.cmd;
  if (!cmd) throw new Error(`unknown adapter "${opts.adapter}" (claude|codex|opencode|agy)`);
  if (adapter?.cwdFlag && !opts.cmd) cmd.push(adapter.cwdFlag, opts.cwd);
  if (sandbox) cmd = sandbox.wrap(cmd, { cwd: opts.cwd });
  else if (!opts.cmd) cmd = resolveWinCmd(cmd);
  const consume = opts.consume ?? adapter?.consume ?? true;
  log("start", { adapter: opts.adapter, cmd: cmd.join(" "), cwd: opts.cwd, allow_default: opts.allowDefault, consume, mcp: !!opts.withMcp, model: opts.model || "adapter default", ...(opts.sandbox && { sandbox: opts.sandbox }) });

  const trail = { session_id: `aos-acp-${process.pid}-${Date.now()}`, cwd: opts.cwd, agent: `${opts.adapter}:${opts.name}`, ...trailTask(opts) };
  const seenTools = new Map();
  // Windows: killTree() below runs taskkill through spawnSync and blocks the event loop, so posts still in flight (300 ms timeout) would be aborted:
  // wait for them before killing anything.
  const trailPending = new Set();
  const trailSend = (ev) => { const p = emitTrail(ev); trailPending.add(p); p.finally(() => trailPending.delete(p)); return p; };
  trailSend({ ...trail, hook_event_name: "SessionStart" });
  let sessionId;
  const out = opts.stdout || process.stdout;
  const env = { ...process.env, AOS_SESSION_NAME: opts.name, AOS_ACP_CLIENT: "1", ...trailEnv(opts) };
  const client = new AcpClient(cmd, {
    cwd: opts.cwd,
    env: opts.withMcp ? env : opts.adapter === "opencode" ? opencodeNoMcpEnv(env, opts.cwd) : opts.adapter === "codex" ? codexNoMcpEnv(env) : env,
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
        if (ev) trailSend({ ...trail, ...ev });
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
    await Promise.allSettled([...trailPending]);
    killTree(client.child);
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
    else if (a === "--print-timeout") o.printTimeout = Number(v), i++;
    else if (a === "--log") o.log = v, i++;
    else if (a === "--model") o.model = v, i++;
    else if (a === "--cmd") o.cmd = v, i++;
    else if (a === "--sandbox") o.sandbox = v, i++;
    else if (a === "--consume") o.consume = true;
    else if (a === "--no-consume") o.consume = false;
    else if (a === "--with-mcp") o.withMcp = true;
    else if (a === "--trail-node") o.trailNode = v, i++;
    else if (a === "--trail-plan") o.trailPlan = v, i++;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.adapter || !o.name || !o.prompt) throw new Error(USAGE);
  if (!["deny", "allow", "scoped"].includes(o.allowDefault)) throw new Error("--allow-default must be deny, allow or scoped");
  return o;
}

const USAGE = "usage: aos-acp <claude|codex|opencode|agy> --name <worker> (--prompt <text> | --prompt-file <file>) [--cwd <dir>] [--allow-default deny|allow|scoped] [--go-wait <sec>] [--consume|--no-consume] [--cmd <agent command>] [--sandbox coop|wsl2] [--model <id>] [--log <file>] [--timeout <sec>] [--print-timeout <sec>, agy only, default 900] [--with-mcp] [--trail-node <id>] [--trail-plan <file>]";
const invokedAs = (() => { try { return realpathSync(process.argv[1] || ""); } catch { return ""; } })();
if (invokedAs === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some((a) => a === "--help" || a === "-h")) { console.log(`aos-acp: ${USAGE}`); process.exit(0); }
  // Windows: process.exit() right after a completed fetch() can abort node (libuv UV_HANDLE_CLOSING assertion,
  // exit 0xC0000409), so let the loop drain there; the unref'd timer is only a backstop.
  const finish = (code) => {
    if (process.platform !== "win32") process.exit(code);
    process.exitCode = code;
    setTimeout(() => process.exit(code), 3000).unref();
  };
  Promise.resolve().then(() => run(parseArgs(process.argv.slice(2))))
    .then(finish, (e) => { console.error(`aos-acp: ${e.message}`); finish(2); });
}
