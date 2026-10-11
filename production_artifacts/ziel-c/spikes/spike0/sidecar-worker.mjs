import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { AGENT_CARD_PATH, TaskState, Role } from '@a2a-js/sdk';
import { DefaultRequestHandler, InMemoryTaskStore, AgentEvent } from '@a2a-js/sdk/server';
import { jsonRpcHandler, agentCardHandler, UserBuilder } from '@a2a-js/sdk/server/express';
import { register, unregister, readToken } from '<home>/dev/bdb-dev/aos-wt-zielc/lib/a2a-registry.mjs';

const { values: o } = parseArgs({ options: {
  name: { type: 'string' }, harness: { type: 'string' }, host: { type: 'string', default: '127.0.0.1' },
} });
if (!o.name || !/^[\w.-]+$/.test(o.name)) throw new Error('--name required ([\\w.-]+)');
if (!['claude', 'opencode'].includes(o.harness)) throw new Error('--harness claude|opencode');
if (!['127.0.0.1', '::1'].includes(o.host)) { console.error(`refusing non-loopback bind: ${o.host}`); process.exit(2); }

const sessions = process.env.AOS_SESSIONS_DIR;
if (!sessions) throw new Error('AOS_SESSIONS_DIR required');
fs.mkdirSync(sessions, { recursive: true, mode: 0o700 });

const TESTDIR = process.env.A2A_TESTDIR;
if (!TESTDIR || !path.resolve(TESTDIR).startsWith('/private/tmp/claude-501/')) {
  console.error('A2A_TESTDIR required and must be under /private/tmp/claude-501/'); process.exit(2);
}
const RUN = path.join(path.dirname(new URL(import.meta.url).pathname), 'run');
fs.mkdirSync(RUN, { recursive: true });

const token = crypto.randomBytes(32).toString('hex');
const tokBuf = Buffer.from(token);

const text = (t) => ({ content: { $case: 'text', value: t }, metadata: undefined, filename: '', mediaType: 'text/plain' });
const inText = (m) => m.parts.map((p) => (p.content?.$case === 'text' ? p.content.value : '')).join('');

const executor = {
  async execute(ctx, bus) {
    const userText = inText(ctx.userMessage);
    const base = { taskId: ctx.taskId, contextId: ctx.contextId, metadata: undefined };
    const stamp = Date.now();
    const promptFile = path.join(RUN, `prompt-${ctx.taskId}-${stamp}.txt`);
    fs.writeFileSync(promptFile, userText);

    bus.publish(AgentEvent.task({
      id: ctx.taskId, contextId: ctx.contextId, artifacts: [], history: [ctx.userMessage], metadata: undefined,
      status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: new Date().toISOString() },
    }));
    const working = {
      messageId: crypto.randomUUID(), contextId: ctx.contextId, taskId: ctx.taskId, role: Role.ROLE_AGENT,
      parts: [text('working: aos-acp opencode running')], metadata: undefined, extensions: [], referenceTaskIds: [],
    };
    bus.publish(AgentEvent.statusUpdate({ ...base, status: { state: TaskState.TASK_STATE_WORKING, message: working, timestamp: new Date().toISOString() } }));

    const logFile = path.join(RUN, 'acp.jsonl');
    const child = spawn('node', [
      '<home>/dev/bdb-dev/aos-wt-zielc/bin/aos-acp.mjs', 'opencode',
      '--name', 'a2a-p1b-worker', '--cwd', TESTDIR, '--prompt-file', promptFile,
      ...(process.env.A2A_WORKER_MODEL ? ['--model', process.env.A2A_WORKER_MODEL] : []),
      '--allow-default', 'allow',
      '--timeout', '300', '--log', logFile,
    ], {
      env: {
        ...process.env,
        AOS_DELEGATE_DEPTH: '1', AOS_A2A_SIDECAR: 'off',
        ...(process.env.A2A_WORKER_PROXY ? {
          HTTPS_PROXY: process.env.A2A_WORKER_PROXY, HTTP_PROXY: process.env.A2A_WORKER_PROXY, ALL_PROXY: process.env.A2A_WORKER_PROXY,
        } : {}),
        NO_PROXY: '127.0.0.1,localhost,::1', no_proxy: '127.0.0.1,localhost,::1',
      },
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const code = await new Promise((res) => child.on('close', res));

    const tail = out.split('\n').slice(-40).join('\n');
    bus.publish(AgentEvent.artifactUpdate({
      ...base, append: false, lastChunk: true,
      artifact: { artifactId: crypto.randomUUID(), name: 'worker-output', description: 'last 40 lines of worker stdout', parts: [text(tail)], metadata: undefined, extensions: [] },
    }));
    const done = {
      messageId: crypto.randomUUID(), contextId: ctx.contextId, taskId: ctx.taskId, role: Role.ROLE_AGENT,
      parts: [text(code === 0 ? 'completed' : `failed (exit ${code})`)], metadata: undefined, extensions: [], referenceTaskIds: [],
    };
    bus.publish(AgentEvent.statusUpdate({
      ...base, status: { state: code === 0 ? TaskState.TASK_STATE_COMPLETED : TaskState.TASK_STATE_FAILED, message: done, timestamp: new Date().toISOString() },
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
      { id: 'build', name: 'build', description: 'runs aos-acp opencode on the prompt', tags: ['build', `harness:${o.harness}`], examples: [], inputModes: [], outputModes: [], securityRequirements: [] },
    ],
    signatures: [],
  };
  const handler = new DefaultRequestHandler(card, new InMemoryTaskStore(), executor);
  app.use('/a2a', jsonRpcHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication }));
  register({ name: o.name, harness: o.harness, pid: process.pid, url, cardUrl: `http://127.0.0.1:${port}/${AGENT_CARD_PATH}`, cwd: TESTDIR, token });
  console.log(`sidecar-worker ${o.name} listening ${url}`);
});

const bye = () => { try { unregister(o.name); } catch {} server.closeAllConnections?.(); process.exit(0); };
process.on('SIGTERM', bye);
process.on('SIGINT', bye);
