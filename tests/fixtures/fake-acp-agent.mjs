#!/usr/bin/env node
// Tiny stdio ACP agent for tests. Answers initialize and session/new, then on
// session/prompt streams two text chunks, asks permission for FAKE_CMD (if set)
// and reports the client's decision as text before ending the turn.
import { createInterface } from "node:readline";

const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
let reqId = 100;
const waiting = new Map();

createInterface({ input: process.stdin }).on("line", async (line) => {
  const msg = JSON.parse(line);
  if (msg.id !== undefined && !msg.method) { waiting.get(msg.id)?.(msg); return; }
  const { id, method, params } = msg;
  if (method === "initialize") return send({ jsonrpc: "2.0", id, result: { protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: "fake-acp", version: "0" } } });
  if (method === "session/new") return send({ jsonrpc: "2.0", id, result: { sessionId: "sess-1" } });
  if (method === "session/cancel") return send({ jsonrpc: "2.0", id: 1e9, result: null });
  if (method !== "session/prompt") return send({ jsonrpc: "2.0", id, error: { code: -32601, message: "nope" } });

  const sessionId = params.sessionId;
  const chunk = (text) => send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } });
  chunk("hello ");
  chunk("world");
  if (process.env.FAKE_CMD) {
    const rid = reqId++;
    const reply = await new Promise((res) => { waiting.set(rid, res); send({ jsonrpc: "2.0", id: rid, method: "session/request_permission", params: {
      sessionId, toolCall: { toolCallId: "tc-1", title: "Run " + process.env.FAKE_CMD, kind: "execute", rawInput: { command: process.env.FAKE_CMD } },
      options: [{ optionId: "yes-once", name: "Allow", kind: "allow_once" }, { optionId: "no-once", name: "Reject", kind: "reject_once" }],
    } }); });
    chunk(` decision=${reply.result?.outcome?.optionId ?? reply.result?.outcome?.outcome}`);
  }
  send({ jsonrpc: "2.0", id, result: { stopReason: "end_turn" } });
});
