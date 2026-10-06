import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { AGENT_CARD_PATH, TaskState, Role } from '@a2a-js/sdk';
import { DefaultRequestHandler, InMemoryTaskStore, AgentEvent } from '@a2a-js/sdk/server';
import { jsonRpcHandler, agentCardHandler, UserBuilder } from '@a2a-js/sdk/server/express';

const { values: o } = parseArgs({ options: {
  name: { type: 'string' }, harness: { type: 'string' }, host: { type: 'string', default: '127.0.0.1' },
} });
if (!o.name || !/^[\w.-]+$/.test(o.name)) throw new Error('--name required ([\\w.-]+)');
if (!['claude', 'opencode'].includes(o.harness)) throw new Error('--harness claude|opencode');
if (!['127.0.0.1', '::1'].includes(o.host)) { console.error(`refusing non-loopback bind: ${o.host}`); process.exit(2); }

for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '127.0.0.1,localhost,::1';
process.env.no_proxy = '127.0.0.1,localhost,::1';

const sessions = process.env.AOS_SESSIONS_DIR;
if (!sessions) throw new Error('AOS_SESSIONS_DIR required');
const inboxRoot = process.env.AOS_A2A_INBOX;
if (!inboxRoot) throw new Error('AOS_A2A_INBOX required');
const myInbox = path.join(inboxRoot, o.name);
fs.mkdirSync(myInbox, { recursive: true, mode: 0o700 });
fs.chmodSync(myInbox, 0o700);
fs.mkdirSync(sessions, { recursive: true, mode: 0o700 });
const regFile = path.join(sessions, `${o.name}.json`);
const token = crypto.randomBytes(32).toString('hex');
const tokBuf = Buffer.from(token);

const text = (t) => ({ content: { $case: 'text', value: t }, metadata: undefined, filename: '', mediaType: 'text/plain' });
const inText = (m) => m.parts.map((p) => (p.content?.$case === 'text' ? p.content.value : '')).join('');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReply(taskId) {
  const replyFile = path.join(myInbox, `${taskId}.reply`);
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    try {
      const t = fs.readFileSync(replyFile, 'utf8');
      try { fs.unlinkSync(replyFile); } catch {}
      return { ok: true, text: t };
    } catch {}
    await sleep(200);
  }
  return { ok: false };
}

const executor = {
  async execute(ctx, bus) {
    const base = { taskId: ctx.taskId, contextId: ctx.contextId, metadata: undefined };
    bus.publish(AgentEvent.task({
      id: ctx.taskId, contextId: ctx.contextId, artifacts: [], history: [ctx.userMessage], metadata: undefined,
      status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: new Date().toISOString() },
    }));
    const from = ctx.userMessage.metadata?.aos?.caller ?? 'unknown';
    const payload = JSON.stringify({ taskId: ctx.taskId, contextId: ctx.contextId, from, text: inText(ctx.userMessage), ts: new Date().toISOString() });
    const msgFile = path.join(myInbox, `${ctx.taskId}.json`);
    fs.writeFileSync(msgFile, payload, { mode: 0o600 });
    fs.chmodSync(msgFile, 0o600);
    bus.publish(AgentEvent.statusUpdate({
      ...base, status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: new Date().toISOString() },
    }));
    const r = await waitReply(ctx.taskId);
    if (r.ok) {
      bus.publish(AgentEvent.artifactUpdate({
        ...base, append: false, lastChunk: true,
        artifact: { artifactId: crypto.randomUUID(), name: 'answer', description: 'live reply', parts: [text(r.text)], metadata: undefined, extensions: [] },
      }));
      bus.publish(AgentEvent.statusUpdate({
        ...base, status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: new Date().toISOString() },
      }));
    } else {
      bus.publish(AgentEvent.statusUpdate({
        ...base, status: { state: TaskState.TASK_STATE_FAILED, message: undefined, timestamp: new Date().toISOString() },
      }));
    }
    bus.finished();
  },
  async cancelTask(_id, bus) { bus.finished(); },
};

const app = express();
app.disable('x-powered-by');
let card;
app.use(AGENT_CARD_PATH.startsWith('/') ? AGENT_CARD_PATH : `/${AGENT_CARD_PATH}`,
  agentCardHandler({ agentCardProvider: async () => card, cache: { maxAge: 0 } }));
app.use('/a2a', (req, res, next) => {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  const got = Buffer.from(m?.[1] ?? '');
  if (!m || got.length !== tokBuf.length || !crypto.timingSafeEqual(got, tokBuf)) {
    res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'unauthorized' });
    return;
  }
  next();
});

const server = app.listen(0, o.host, () => {
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/a2a`;
  card = {
    name: o.name,
    description: `AOS session ${o.name}; harness=${o.harness}`,
    version: '0.0.1',
    supportedInterfaces: [{ url, protocolBinding: 'JSONRPC', tenant: '', protocolVersion: '1.0' }],
    provider: undefined,
    capabilities: { streaming: true, pushNotifications: false, extensions: [], extendedAgentCard: false },
    securitySchemes: { bearer: { scheme: { $case: 'httpAuthSecurityScheme', value: { description: 'per-session bearer token', scheme: 'bearer', bearerFormat: 'opaque' } } } },
    securityRequirements: [{ schemes: { bearer: { list: [] } } }],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [
      { id: 'live', name: 'live', description: 'writes inbound to inbox, waits for reply file', tags: ['live', `harness:${o.harness}`], examples: [], inputModes: [], outputModes: [], securityRequirements: [] },
    ],
    signatures: [],
  };
  const handler = new DefaultRequestHandler(card, new InMemoryTaskStore(), executor);
  app.use('/a2a', jsonRpcHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication }));
  fs.writeFileSync(regFile, JSON.stringify({
    name: o.name, harness: o.harness, pid: process.pid, url,
    cardUrl: `http://127.0.0.1:${port}/${AGENT_CARD_PATH}`, token, ts: new Date().toISOString(),
  }, null, 2), { mode: 0o600 });
  fs.chmodSync(regFile, 0o600);
  console.log(`sidecar-live ${o.name} listening ${url}`);
});

const bye = () => { try { fs.unlinkSync(regFile); } catch {} server.closeAllConnections?.(); process.exit(0); };
process.on('SIGTERM', bye);
process.on('SIGINT', bye);
