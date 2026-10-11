'use strict';
// WP1 routes kept in one module per the file list: /api/shutdown,
// /api/plans (plan-canvas on 127.0.0.1:4519), /api/health and /api/trail
// (live agenttrail map ports). Plan-canvas facts confirmed by reading
// skills/global_config/plan-canvas/scripts/lib/plan-canvas/server.js:
//   GET /health (plain ok) and GET /api/sessions -> { sessions: [...] }
//   (server.js L373; session fields key/file/status/pending/updatedAt,
//   sessions.js L248-257).
import { readFileSync } from 'node:fs';
import { request as httpRequest, Agent } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// The hub service runs from ~/.agents, which has no package.json (crashed the service on a fresh install).
let version = 'unknown';
try { version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version; } catch { /* installed layout */ }

const PC_PORT = 4519;
const PC_TIMEOUT_MS = 2000;
const TRAIL_TIMEOUT_MS = 500;

// One shared outbound agent, keep-alive off: a pooled idle socket would keep
// the test process alive and turn the fixture teardown into a 15 s hang.
const noKeepAliveAgent = new Agent({ keepAlive: false });

export const planCanvasPort = () =>
  Number(process.env.AOS_PLAN_CANVAS_PORT) || PC_PORT;

// One HTTP GET, hard timeout, response never cached, socket not pooled.
const httpOnce = (url, timeoutMs) => new Promise((ok, bad) => {
  const req = httpRequest(url, { agent: noKeepAliveAgent, timeout: timeoutMs }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => ok({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    res.on('error', bad);
  });
  req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs} ms`)));
  req.on('error', bad);
  req.end();
});

async function pcFetch(port, path, timeoutMs = PC_TIMEOUT_MS) {
  const res = await httpOnce(`http://127.0.0.1:${port}${path}`, timeoutMs);
  if (res.status >= 400) throw new Error(`plan-canvas ${res.status}`);
  try { return JSON.parse(res.body); }
  catch { throw new Error('plan-canvas returned invalid JSON'); }
}

export const normalizeSessions = (payload) =>
  (payload?.sessions || []).map((s) => ({
    key: String(s.key || ''),
    file: String(s.file || ''),
    status: String(s.status || ''),
    pending: Number(s.pending || 0),
    updatedAt: String(s.updatedAt || ''),
  }));

// agenttrail live maps: one daemon per repo on the first free port in
// 5330-5344 (v5), plus 5350 for the agenttrail v2 hub when it answers. A port
// counts only if it answers HTTP within the probe timeout.
export const TRAIL_PORTS = [...Array.from({ length: 15 }, (_, i) => 5330 + i), 5350];

async function probeHttp(port, timeoutMs) {
  const res = await httpOnce(`http://127.0.0.1:${port}/`, timeoutMs).catch(() => null);
  return !!res && res.status > 0 && res.status < 500;
}

export const probeTrailPorts = async (ports = TRAIL_PORTS, timeoutMs = TRAIL_TIMEOUT_MS) => {
  const results = await Promise.all(ports.map(async (p) => [p, await probeHttp(p, timeoutMs)]));
  return results.filter(([, ok]) => ok).map(([p]) => p);
};

// Module-level 2 s cache for /api/trail so rapid polling does not re-probe
// 16 ports each time. Cleared whenever the cached entry is older than 2 s on
// the injectable clock (ctx.now) or real Date.now().
let trailCache = null;

export const routes = [
  {
    method: 'GET',
    path: '/api/health',
    handler: async () => ({ status: 200, json: { ok: true, service: 'aos-hub', version } }),
  },
  {
    method: 'GET',
    path: '/api/trail',
    handler: async ({ ctx }) => {
      // Probe results are good for 2 s; the clock is injectable via ctx.now
      // so tests can wind time forward without waiting.
      const now = (typeof ctx.now === 'function') ? Number(ctx.now()) : Date.now();
      if (trailCache && Number.isFinite(now) && now - trailCache.at < 2000) return trailCache.response;
      const live = await probeTrailPorts();
      const response = { status: 200, json: { live, links: live.map((p) => ({ port: p, url: `http://127.0.0.1:${p}/` })) } };
      trailCache = Number.isFinite(now) ? { at: now, response } : null;
      return response;
    },
  },
  {
    method: 'POST',
    path: '/api/shutdown',
    mutates: true,
    confirm: 'hub',
    handler: async ({ ctx }) => {
      // Never process.exit() before the reply is flushed: the flag is read by
      // the server, which triggers ctx.shutdownHub after res 'finish'. That
      // hook (wired in bin/aos-hub.mjs) removes hub.json and closes the
      // server; a hard-exit timer backstops it.
      ctx.requestShutdown = true;
      return { status: 200, json: { ok: true, stopping: true } };
    },
  },
  {
    method: 'GET',
    path: '/api/plans',
    handler: async ({ ctx }) => {
      // Configurable: ctx.planCanvasPort wins, then AOS_PLAN_CANVAS_PORT,
      // then the default 4519. The route always answers: a plan-canvas that
      // is down, slow (2 s hard timeout) or malformed yields the idle note,
      // never a hanging response.
      const pcPort = Number(ctx && ctx.planCanvasPort) || planCanvasPort();
      const base = `http://127.0.0.1:${pcPort}`;
      try {
        await pcFetch(pcPort, '/health');
        const payload = await pcFetch(pcPort, '/api/sessions');
        const sessions = normalizeSessions(payload);
        return { status: 200, json: { ok: true, base, sessions } };
      } catch (e) {
        return {
          status: 200,
          json: {
            ok: false,
            down: true,
            base,
            reason: e && e.message ? e.message : 'unreachable',
            note: 'plan-canvas idle out after 30 minutes by design; agents start it with aos-plan-canvas open',
          },
        };
      }
    },
  },
];
