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

const sessions = process.env.AOS_SESSIONS_DIR;
if (!sessions) throw new Error('AOS_SESSIONS_DIR required');
fs.mkdirSync(sessions, { recursive: true, mode: 0o700 });
const regFile = path.join(sessions, `${o.name}.json`);
const token = crypto.randomBytes(32).toString('hex');
const tokBuf = Buffer.from(token);

const text = (t) => ({ content: { $case: 'text', value: t }, metadata: undefined, filename: '', mediaType: 'text/plain' });
const inText = (m) => m.parts.map((p) => (p.content?.$case === 'text' ? p.content.value : '')).join('');

const executor = {
  async execute(ctx, bus) {
    const echo = `[a2a echo from ${o.name}/${o.harness}] ${inText(ctx.userMessage)}`;
    const base = { taskId: ctx.taskId, contextId: ctx.contextId, metadata: undefined };
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
      artifact: { artifactId: crypto.randomUUID(), name: 'echo', description: 'echoed input', parts: [text(echo)], metadata: undefined, extensions: [] },
    }));
    bus.publish(AgentEvent.statusUpdate({
      ...base, status: { state: TaskState.TASK_STATE_COMPLETED, message: msg, timestamp: new Date().toISOString() },
    }));
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
      { id: 'echo', name: 'echo', description: 'echoes the text back', tags: ['echo', `harness:${o.harness}`], examples: [], inputModes: [], outputModes: [], securityRequirements: [] },
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
  console.log(`sidecar ${o.name} listening ${url}`);
});

const bye = () => { try { fs.unlinkSync(regFile); } catch {} server.closeAllConnections?.(); process.exit(0); };
process.on('SIGTERM', bye);
process.on('SIGINT', bye);
