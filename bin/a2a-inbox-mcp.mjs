// Stdio MCP server that gives agy PULL access to the A2A inbox:
// a2a_inbox_pull claims pending messages and returns their formatted injections,
// a2a_reply writes a reply file via the same path as aos-a2a reply.
// Hand-written JSON-RPC 2.0 (newline-delimited) over stdio; no new dependency.
import { createInterface } from "node:readline";
import { reply } from "../lib/a2a-client.mjs";
import { claim, formatInjection, pending, replyCommand } from "../lib/a2a-inbox.mjs";

const REPLY_HINT = (taskId) => `Answer with the a2a_reply tool (taskId ${taskId}), or run: ${replyCommand(taskId, "<answer>")}`;

const sessionName = () => {
  const name = process.env.AOS_A2A_NAME;
  return name ? { ok: true, name } : { ok: false, error: "AOS_A2A_NAME is not set; the a2a inbox tools need the session name (%AOS_A2A_NAME env var in agy mcp config)" };
};

const tools = [
  {
    name: "a2a_inbox_pull",
    description: "Pull pending A2A messages from other agent sessions. Claims each message and returns its formatted text for this session.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "a2a_reply",
    description: "Reply to a pulled A2A message by taskId. Writes the reply so the sending agent can read it.",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" }, text: { type: "string" } },
      required: ["taskId", "text"],
      additionalProperties: false,
    },
  },
];

const handleCall = async (name, args) => {
  const who = sessionName();
  if (!who.ok) return { isError: true, text: who.error };
  if (name === "a2a_inbox_pull") {
    const msgs = pending(who.name);
    const parts = [];
    for (const m of msgs) {
      const got = claim(m.file);
      if (!got) continue; // claimed meanwhile or corrupt
      parts.push(`${formatInjection(got)}\n${REPLY_HINT(got.taskId)}`);
    }
    return { isError: false, text: parts.length ? parts.join("\n---\n") : "(no pending messages)" };
  }
  if (name === "a2a_reply") {
    try {
      const { path } = reply({ taskId: args?.taskId, text: args?.text, name: who.name });
      return { isError: false, text: `reply written to ${path}` };
    } catch (e) {
      return { isError: true, text: e.message };
    }
  }
  return { isError: true, text: `unknown tool: ${name}` };
};

const result = (id, r) => JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: r.text }], isError: r.isError } });

const consume = async (msg, out) => {
  if (msg.method === "notifications/initialized") return; // no response
  if (msg.method === "tools/list") {
    out(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools } }));
    return;
  }
  if (msg.method === "tools/call") {
    const r = await handleCall(msg.params?.name, msg.params?.arguments);
    out(result(msg.id, r));
    return;
  }
  if (msg.id != null) {
    out(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } }));
  }
};

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0", id: msg.id,
      result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "a2a-inbox", version: "1.0.0" } },
    }) + "\n");
    return;
  }
  await consume(msg, (s) => process.stdout.write(s + "\n"));
});
rl.on("close", () => process.exit(0));

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
