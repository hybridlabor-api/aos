import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isInstalled, localAgents, localSkills } from '../store-shared.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(ROOT, 'bin', 'aos-store.mjs');
const NAME_RE = /^[A-Za-z0-9_-]+$/;
const DEFAULT_PORT = 4322;
const readJson = (...p) => JSON.parse(readFileSync(join(ROOT, ...p), 'utf8'));
const frontDescription = (file) => {
  const fm = readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/);
  const d = fm?.[1].match(/^description:\s*(.+)$/m);
  return d ? d[1].trim().replace(/^["']|["']$/g, '') : '';
};

function catalog(scope, cwd) {
  const idx = readJson('lib', 'ecc-store-index.json');
  const project = scope === 'project';
  const items = [];
  const core = { skill: localSkills(ROOT), agent: localAgents(ROOT) };
  for (const kind of ['skill', 'agent']) {
    for (const [name, file] of core[kind]) {
      items.push({ name, kind, description: frontDescription(file), category: 'core', source: 'AOS Core', installed: true, core: true });
    }
  }
  for (const [kind, key, type] of [['skill', 'skills', 'skills'], ['agent', 'subagents', 'agents']]) {
    for (const [name, it] of Object.entries(idx[key] || {})) {
      if (core[kind].has(name)) continue;
      const installed = isInstalled(type, name, it, { project, cwd });
      const files = kind === 'skill' && it.files?.length > 1 ? it.files : null;
      items.push({
        name, kind, description: it.description || '', category: it.category || '', source: 'ECC', installed, upstreamPath: it.upstream_path,
        fileCount: files ? files.length : 1,
        totalSize: files ? files.reduce((n, f) => n + f.size, 0) : null,
        hasHooks: !!files?.some((f) => f.path.split('/').includes('hooks')),
      });
    }
  }
  return { scope, cwd, pinned_commit: idx.pinned_commit, items };
}

const details = new Map();
async function fetchDetail(name, item, commit) {
  if (details.has(name)) return details.get(name);
  const url = `https://raw.githubusercontent.com/affaan-m/ECC/${commit}/${item.upstreamPath}`;
  const res = await fetch(url, { headers: { 'user-agent': 'aos-store' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const fm = (await res.text()).match(/^---\n([\s\S]*?)\n---/);
  const d = fm?.[1].match(/^description:\s*(?:>-?|\|-?)?\s*([\s\S]*?)(?=\n[A-Za-z_-]+:|(?![\s\S]))/m);
  const text = (d?.[1] || '').replace(/\s*\n\s*/g, ' ').trim().replace(/^["']|["']$/g, '');
  details.set(name, text);
  return text;
}

const runCli = (args, cwd, timeout) => new Promise((done) => {
  execFile(process.execPath, [CLI, ...args], { cwd, timeout, maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
    done({ ok: !error, stdout, stderr: stderr || (error && error.message) || '' });
  });
});

const readBody = (req) => new Promise((ok, fail) => {
  let data = '';
  req.on('data', (c) => { data += c; if (data.length > 4096) { fail(new Error('too large')); req.destroy(); } });
  req.on('end', () => ok(data));
  req.on('error', fail);
});

export function createStoreServer({ cwd = process.cwd() } = {}) {
  const token = randomBytes(24).toString('hex');
  const tokenBuf = Buffer.from(token);
  const send = (res, status, body, type = 'application/json') => {
    res.statusCode = status;
    res.setHeader('content-type', type);
    res.setHeader('cache-control', 'no-store');
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };

  const server = createServer(async (req, res) => {
    try {
      const port = server.address().port;
      const allowed = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!allowed.includes(req.headers.host || '')) return send(res, 403, { error: 'bad host' });
      if (req.headers.origin && !allowed.some((h) => req.headers.origin === `http://${h}`)) return send(res, 403, { error: 'bad origin' });
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      const scopeOf = (v) => (v === 'project' ? 'project' : 'global');

      if (req.method === 'GET') {
        if (p === '/api/health') return send(res, 200, { ok: true, service: 'aos-store' });
        if (p === '/api/catalog') return send(res, 200, catalog(scopeOf(url.searchParams.get('scope')), cwd));
        if (p === '/api/detail') {
          const name = url.searchParams.get('name') || '';
          if (!NAME_RE.test(name)) return send(res, 400, { error: 'invalid name' });
          const data = catalog('global', cwd);
          const item = data.items.find((i) => i.name === name && i.source === 'ECC' && i.kind === url.searchParams.get('kind'));
          if (!item) return send(res, 404, { error: 'not found' });
          try { return send(res, 200, { description: await fetchDetail(name, item, data.pinned_commit) }); }
          catch (e) { return send(res, 502, { error: e.message }); }
        }
        if (p === '/' || p === '/index.html') {
          return send(res, 200, readFileSync(join(ROOT, 'lib', 'store-ui', 'index.html'), 'utf8').replace('__TOKEN__', token), 'text/html; charset=utf-8');
        }
        return send(res, 404, { error: 'not found' });
      }

      if (req.method === 'POST' && (p === '/api/preview' || p === '/api/install')) {
        const given = Buffer.from(String(req.headers['x-store-token'] || ''));
        if (given.length !== tokenBuf.length || !timingSafeEqual(given, tokenBuf)) return send(res, 401, { error: 'unauthorized' });
        let body = {};
        try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'invalid body' }); }
        const { name, kind } = body;
        if (typeof name !== 'string' || !NAME_RE.test(name) || !['skill', 'agent'].includes(kind)) return send(res, 400, { error: 'invalid name' });
        const scope = scopeOf(body.scope);
        const item = catalog(scope, cwd).items.find((i) => i.name === name && i.kind === kind);
        if (!item) return send(res, 404, { error: 'not in store index' });
        if (item.core) return send(res, 409, { error: 'provided by AOS Core' });
        const flags = scope === 'project' ? ['--project'] : [];
        if (p === '/api/preview') {
          const r = await runCli(['install', name, '--dry-run', ...flags], cwd, 10000);
          const targets = r.stdout.split('\n').filter((l) => l.startsWith('[dry-run] write ')).map((l) => l.slice(16));
          return send(res, 200, { ...r, scope, targets });
        }
        const r = await runCli(['install', name, '--net', ...flags], cwd, 30000);
        const installed = catalog(scope, cwd).items.find((i) => i.name === name && i.kind === kind).installed;
        return send(res, 200, { ...r, scope, installed });
      }
      return send(res, 405, { error: 'method not allowed' });
    } catch (e) {
      send(res, 500, { error: e.message });
    }
  });
  return server;
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch { /* opening is best effort */ }
}

const isStore = async (port) => {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    return j.ok === true && j.service === 'aos-store';
  } catch { return false; }
};

export async function startUi({ argv = [], cwd = process.cwd() } = {}) {
  const i = argv.findIndex((a) => a === '--port' || a.startsWith('--port='));
  const raw = i < 0 ? process.env.AOS_STORE_PORT : (argv[i].includes('=') ? argv[i].split('=')[1] : argv[i + 1]);
  const port = raw === undefined || raw === '' ? DEFAULT_PORT : Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${raw}`);
  const url = `http://127.0.0.1:${port}/`;
  const noOpen = argv.includes('--no-open');

  if (await isStore(port)) {
    console.log(`AOS Store already running: ${url}`);
    if (!noOpen) openBrowser(url);
    return;
  }
  const server = createStoreServer({ cwd });
  await new Promise((ok, fail) => {
    server.once('error', (e) => fail(e.code === 'EADDRINUSE' ? new Error(`Port ${port} is in use by another service. Use --port or AOS_STORE_PORT.`) : e));
    server.listen(port, '127.0.0.1', ok);
  });
  console.log(`AOS Store: ${url}  (project scope: ${cwd})`);
  if (!noOpen) openBrowser(url);
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
