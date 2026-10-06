import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { Role, TaskState } from '@a2a-js/sdk';
import { ClientFactory } from '@a2a-js/sdk/client';
import { readToken } from '/Users/timrennings/dev/bdb-dev/aos-wt-zielc/lib/a2a-registry.mjs';

// A2A clients must never route loopback through a proxy.
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[k];
process.env.NO_PROXY = '127.0.0.1,localhost,::1';
process.env.no_proxy = '127.0.0.1,localhost,::1';

const fail = (msg) => { console.log(JSON.stringify({ error: msg })); process.exit(1); };
const { values: o, positionals } = parseArgs({ options: { to: { type: 'string' }, from: { type: 'string', default: 'cli' } }, allowPositionals: true });
if (!o.to || !positionals.length) fail('usage: send.mjs --to <name> "<text>"');
const dir = process.env.AOS_SESSIONS_DIR;
if (!dir) fail('AOS_SESSIONS_DIR required');

let reg;
try { reg = JSON.parse(fs.readFileSync(path.join(dir, `${o.to}.json`), 'utf8')); } catch { fail(`no registry entry for ${o.to}`); }
try { process.kill(reg.pid, 0); } catch { fail(`${o.to} pid ${reg.pid} is dead`); }
const token = reg.token ?? readToken(o.to);
if (!token) fail(`no token for ${o.to}`);

const text = (t) => ({ content: { $case: 'text', value: t }, metadata: undefined, filename: '', mediaType: 'text/plain' });
const stateName = (s) => TaskState[s];
const textOf = (parts) => parts.map((p) => p.content?.$case === 'text' ? p.content.value : '').join('');

try {
  const u = new URL(reg.cardUrl);
  const client = await new ClientFactory().createFromUrl(u.origin, u.pathname);
  const res = await client.sendMessage({
    tenant: '', configuration: undefined, metadata: undefined,
    message: {
      messageId: crypto.randomUUID(), contextId: '', taskId: '', role: Role.ROLE_USER, parts: [text(positionals.join(' '))],
      metadata: { aos: { caller: o.from, depth: 0 } }, extensions: [], referenceTaskIds: [],
    },
  }, { serviceParameters: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(Number(process.env.SEND_TIMEOUT_MS ?? 360000)) });
  if (res.status) {
    console.log(JSON.stringify({
      taskId: res.id, contextId: res.contextId, state: stateName(res.status.state),
      artifacts: res.artifacts.map((a) => ({ name: a.name, text: textOf(a.parts) })),
      statusMessage: res.status.message ? textOf(res.status.message.parts) : null,
    }, null, 2));
  } else console.log(JSON.stringify({ message: textOf(res.parts) }));
} catch (e) { fail(String(e?.message ?? e)); }
