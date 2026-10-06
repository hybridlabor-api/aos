// A2A sidecar for a LIVE OpenCode session (plan §3a). Inbound task -> aos-bus inbox file (wake:true) ->
// bus-spike plugin injects it as a synthetic prompt -> session answers -> reply read via OpenCode HTTP API -> Artifact.
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const SPIKE = '/private/tmp/claude-501/-Users-timrennings/2f3aed09-052a-4360-86c5-4b1856c50064/scratchpad/a2a/spike0/node_modules';
const imp = (p) => import(pathToFileURL(path.join(SPIKE, p)).href);
const { default: express } = await imp('express/index.js');
const { AGENT_CARD_PATH, TaskState, Role } = await imp('@a2a-js/sdk/dist/index.js');
const { DefaultRequestHandler, InMemoryTaskStore, AgentEvent } = await imp('@a2a-js/sdk/dist/server/index.js');
const { jsonRpcHandler, agentCardHandler, UserBuilder } = await imp('@a2a-js/sdk/dist/server/express/index.js');
const { register, unregister } = await import('/Users/timrennings/dev/bdb-dev/aos-wt-zielc/lib/a2a-registry.mjs');

// Loopback only, never via a proxy.
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = process.env.no_proxy = '127.0.0.1,localhost,::1';

const { values: o } = parseArgs({ options: {
  name: { type: 'string' }, 'oc-url': { type: 'string' }, 'oc-dir': { type: 'string' }, 'bus-session': { type: 'string' },
  bus: { type: 'string' }, timeout: { type: 'string', default: '300' },
} });
for (const k of ['name', 'oc-url', 'oc-dir', 'bus-session', 'bus']) if (!o[k]) throw new Error(`--${k} required`);
if (!/^[\w.-]+$/.test(o.name)) throw new Error('bad --name');
if (!new URL(o['oc-url']).hostname.match(/^(127\.0\.0\.1|localhost|::1|\[::1\])$/)) throw new Error('oc-url must be loopback');
if (!process.env.AOS_BUS_ROOT) throw new Error('AOS_BUS_ROOT required (patched bus copy)');
const bus = await import(pathToFileURL(o.bus).href);
const TIMEOUT_MS = Number(o.timeout) * 1000;

const token = crypto.randomBytes(32).toString('hex');
const tokBuf = Buffer.from(token);
const text = (t) => ({ content: { $case: 'text', value: t }, metadata: undefined, filename: '', mediaType: 'text/plain' });
const inText = (m) => m.parts.map((p) => (p.content?.$case === 'text' ? p.content.value : '')).join('');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

const ocMessages = async (sid) => {
  const r = await fetch(`${o['oc-url']}/session/${sid}/message?directory=${encodeURIComponent(o['oc-dir'])}`);
  if (!r.ok) throw new Error(`opencode GET message ${r.status}`);
  return r.json();
};
const partText = (m) => (m.parts ?? []).filter((p) => p.type === 'text').map((p) => p.text).join('');

// Resolves { ok, text } | { ok:false, error }.
async function awaitReply(sid, marker) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const msgs = await ocMessages(sid);
      const u = msgs.find((m) => m.info?.role === 'user' && partText(m).includes(marker));
      const a = u && msgs.find((m) => m.info?.role === 'assistant' && m.info.parentID === u.info.id && m.info.time?.completed);
      if (a) {
        if (a.info.error) return { ok: false, error: `${a.info.error.name}: ${JSON.stringify(a.info.error.data ?? {}).slice(0, 300)}` };
        return { ok: true, text: partText(a).trim() };
      }
    } catch (e) { /* transient, retry until deadline */ }
    await sleep(1000);
  }
  return { ok: false, error: `no reply within ${o.timeout}s` };
}

const agentMsg = (ctx, t) => ({
  messageId: crypto.randomUUID(), contextId: ctx.contextId, taskId: ctx.taskId, role: Role.ROLE_AGENT,
  parts: [text(t)], metadata: undefined, extensions: [], referenceTaskIds: [],
});

const executor = {
  async execute(ctx, eb) {
    const base = { taskId: ctx.taskId, contextId: ctx.contextId, metadata: undefined };
    const status = (state, message) => eb.publish(AgentEvent.statusUpdate({ ...base, status: { state, message, timestamp: now() } }));
    eb.publish(AgentEvent.task({
      id: ctx.taskId, contextId: ctx.contextId, artifacts: [], history: [ctx.userMessage], metadata: undefined,
      status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: now() },
    }));
    try {
      const reg = bus.listSessions().find((s) => s.name === o['bus-session']);
      if (!reg?.sessionID) throw new Error(`bus session ${o['bus-session']} not registered`);
      const caller = String(ctx.userMessage.metadata?.aos?.caller ?? 'a2a-unknown');
      const marker = `[a2a task ${ctx.taskId}]`;
      bus.sendMessage(o['bus-session'], `${marker} ${inText(ctx.userMessage)}`, { from: caller, wake: true });
      status(TaskState.TASK_STATE_WORKING, agentMsg(ctx, 'working: injected into live OpenCode session'));
      const r = await awaitReply(reg.sessionID, marker);
      if (!r.ok) { status(TaskState.TASK_STATE_FAILED, agentMsg(ctx, r.error)); return; }
      eb.publish(AgentEvent.artifactUpdate({
        ...base, append: false, lastChunk: true,
        artifact: { artifactId: crypto.randomUUID(), name: 'reply', description: 'assistant reply of the live session', parts: [text(r.text)], metadata: undefined, extensions: [] },
      }));
      status(TaskState.TASK_STATE_COMPLETED, agentMsg(ctx, 'completed'));
    } catch (e) {
      status(TaskState.TASK_STATE_FAILED, agentMsg(ctx, String(e?.message ?? e)));
    } finally { eb.finished(); }
  },
  async cancelTask(_id, eb) { eb.finished(); },
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

const server = app.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/a2a`;
  card = {
    name: o.name, description: `AOS live OpenCode session ${o['bus-session']}`, version: '0.0.1',
    supportedInterfaces: [{ url, protocolBinding: 'JSONRPC', tenant: '', protocolVersion: '1.0' }],
    provider: undefined,
    capabilities: { streaming: true, pushNotifications: false, extensions: [], extendedAgentCard: false },
    securitySchemes: { bearer: { scheme: { $case: 'httpAuthSecurityScheme', value: { description: 'per-session bearer token', scheme: 'bearer', bearerFormat: 'opaque' } } } },
    securityRequirements: [{ schemes: { bearer: { list: [] } } }],
    defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'],
    skills: [{ id: 'live-peer', name: 'live-peer', description: 'answered by the running OpenCode session', tags: ['live', 'harness:opencode'], examples: [], inputModes: [], outputModes: [], securityRequirements: [] }],
    signatures: [],
  };
  const handler = new DefaultRequestHandler(card, new InMemoryTaskStore(), executor);
  app.use('/a2a', jsonRpcHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication }));
  register({ name: o.name, harness: 'opencode', pid: process.pid, url, cardUrl: `http://127.0.0.1:${port}/${AGENT_CARD_PATH}`, cwd: o['oc-dir'], token });
  console.log(`sidecar-live-oc ${o.name} listening ${url}`);
});

const bye = () => { try { unregister(o.name); } catch {} server.closeAllConnections?.(); process.exit(0); };
process.on('SIGTERM', bye);
process.on('SIGINT', bye);
