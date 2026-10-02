#!/usr/bin/env node
'use strict';

/**
 * Plan Canvas CLI — open plan artifacts in a browser review canvas and block
 * on human feedback.
 *
 *   node scripts/plan-canvas.js open .claude/plans/feature.plan.md
 *   node scripts/plan-canvas.js await .claude/plans/feature.plan.md
 *   node scripts/plan-canvas.js await <file> --reply "Updated section 3."
 *   node scripts/plan-canvas.js end <file>
 *   node scripts/plan-canvas.js stop
 *
 * Agents: `open` returns immediately (the server is a detached process);
 * `await` long-polls until the human sends feedback, a verdict, or ends the
 * session, then prints a JSON payload to stdout. Progress notes go to stderr
 * so stdout stays parseable.
 *
 * Source: affaan-m/ECC — MIT, see THIRD_PARTY_NOTICES.md
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const {
  canonicalizeArtifactPath,
  createSessionStore,
  resolveStateDir,
  sessionKeyFor
} = require('./lib/plan-canvas/sessions');
const {
  DEFAULT_HOST,
  createPlanCanvasServer,
  resolveIdleTimeoutMs,
  resolvePort
} = require('./lib/plan-canvas/server');

const VERSION = '1.1.0';   // vendored Plan Canvas protocol version; matches SKILL.md metadata.version.
                           // Bump when the vendored JS changes, to force a stale detached server to restart.

const SAFE_REQUEST_PATHS = new Set([
  '/',
  '/health',
  '/shutdown',
  '/api/await',
  '/api/sessions',
  '/api/end'
]);
const SESSION_REPLY_PATH = /^\/api\/session\/[a-f0-9]{12}\/(reply|typing)$/;
const ANNOTATE_TOKEN_PATH = /^\/api\/annotate\/[a-f0-9]{12}\/token$/;

function usage() {
  return [
    'Plan Canvas - review plans and HTML artifacts in the browser',
    '',
    'Usage:',
    '  aos-plan-canvas                  Show server status and sessions',
    '  aos-plan-canvas modes            List available planning modes as JSON',
    '  aos-plan-canvas templates        List plan templates as JSON ({id,label,description,useWhen,hasBoard})',
    '  aos-plan-canvas new <template-id> <target-dir>  Copy a plan template into a new folder',
    '  aos-plan-canvas open <file>      Open (or resume) a review session',
    '  aos-plan-canvas trail <plan-dir|plan.mdx>  Write an agenttrail plan file from a plan folder',
    '  aos-plan-canvas annotate <app-url>  Print the script tag that lets you annotate a running dev app',
    '  aos-plan-canvas await <file>     Block until the human sends feedback',
    '  aos-plan-canvas pending          Show feedback queued for no listener',
    '  aos-plan-canvas typing <file>    Show a thinking/typing indicator in chat',
    '  aos-plan-canvas end <file>       End a session as the agent',
    '  aos-plan-canvas stop             Shut down the canvas server',
    '  aos-plan-canvas server           Run the server in the foreground',
    '',
    'Options:',
    '  open:  --mode <id>    Select planning mode (default: standard)',
    '                   bdb-plan-builder builds <plan-dir>/plan.builder.html from',
    '                   plan.mdx and opens that file instead',
    '         --no-open      Do not launch a browser window',
    '         --reopen       Reopen a session the user ended from the browser',
    '  new:   --mode <id>    bdb-plan-builder (default: plan.mdx, canvas.mdx) or standard (plan.md);',
    '                   refuses a non-empty target (exit 2)',
    '  trail: --out <file>   Output inside the workspace (default production_artifacts/00_execution_plan.md)',
    '         --force        Overwrite an existing output file',
    '  annotate: --session <file>  Session file (default production_artifacts/canvas-annotations/<host>-<port>.md)',
    '         --ttl-ms <n>   Token lifetime (default 8h, max 24h)',
    '  await: --reply <msg>  Show an agent reply in the canvas chat before waiting',
    '         --timeout-ms <n>  Return {status:"waiting"} after n ms (tests/debug only)',
    '  typing: --state <thinking|typing|idle>  Defaults to typing',
    '  server: --port <n> --host <h>',
    '',
    'Server: 127.0.0.1:4519 (documented port; override only with AOS_PLAN_CANVAS_PORT)',
    'Environment: AOS_PLAN_CANVAS_PORT, AOS_PLAN_CANVAS_STATE_DIR, AOS_PLAN_CANVAS_IDLE_MS, AOS_PLAN_CANVAS_SKILL_DIRS'
  ].join('\n');
}

function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
}

function serverInfoPath(stateDir) {
  return path.join(stateDir, 'server.json');
}

function readServerInfo(stateDir) {
  try {
    return JSON.parse(fs.readFileSync(serverInfoPath(stateDir), 'utf8'));
  } catch {
    return null;
  }
}

function validatePort(port) {
  const value = Number(port);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error(`invalid plan-canvas server port: ${port}`);
  }
  return value;
}

function validateRequestPath(requestPath) {
  if (typeof requestPath !== 'string' || !requestPath.startsWith('/')) {
    throw new Error('plan-canvas request path must be root-relative');
  }
  const url = new URL(requestPath, `http://${DEFAULT_HOST}`);
  if (url.hostname !== DEFAULT_HOST) {
    throw new Error('plan-canvas request path must stay on the loopback server');
  }
  if (!SAFE_REQUEST_PATHS.has(url.pathname) && !SESSION_REPLY_PATH.test(url.pathname) && !ANNOTATE_TOKEN_PATH.test(url.pathname)) {
    throw new Error(`unsupported plan-canvas request path: ${url.pathname}`);
  }
  return `${url.pathname}${url.search}`;
}

function requestOptions(port, method, requestPath, headers) {
  return {
    host: DEFAULT_HOST,
    port: validatePort(port),
    method,
    path: validateRequestPath(requestPath),
    agent: false,
    headers
  };
}

function request(port, method, requestPath, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body);
    const req = http.request(
      requestOptions(
        port,
        method,
        requestPath,
        payload
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
          : {}
      ),
      res => {
        let data = '';
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, body: JSON.parse(data.trim() || '{}') });
          } catch {
            resolve({ statusCode: res.statusCode, body: {} });
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function healthCheck(port) {
  try {
    const res = await request(port, 'GET', '/health');
    return res.body && res.body.app === 'aos-plan-canvas' ? res.body : null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Start (or reuse) the detached canvas server and return its port. A version
// mismatch after this script is updated restarts the server so browser and CLI never
// disagree about the protocol.
async function ensureServer({ stateDir, port }) {
  const health = await healthCheck(port);
  if (health && health.version === VERSION) return port;
  if (health) {
    await request(port, 'POST', '/shutdown').catch(() => {});
    for (let i = 0; i < 20 && (await healthCheck(port)); i++) await sleep(100);
  }
  fs.mkdirSync(stateDir, { recursive: true });
  const logFd = fs.openSync(path.join(stateDir, 'server.log'), 'a');
  const child = spawn(process.execPath, [__filename, 'server', '--port', String(port)], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, AOS_PLAN_CANVAS_STATE_DIR: stateDir },
    shell: false
  });
  child.unref();
  fs.closeSync(logFd);
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    if (await healthCheck(port)) return port;
  }
  throw new Error(`plan-canvas server did not become healthy on port ${port}; check ${path.join(stateDir, 'server.log')}`);
}

function openBrowser(url) {
  const platform = process.platform;
  const [cmd, args] =
    platform === 'darwin' ? ['open', [url]]
      : platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore', shell: false }).unref();
    return true;
  } catch {
    return false;
  }
}

function output(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function cmdStatus({ stateDir, port }) {
  const health = await healthCheck(port);
  if (!health) {
    return { server: 'not running', port, hint: 'open an artifact to start one; the same file always gets the same URL', stateDir };
  }
  const sessions = await request(port, 'GET', '/api/sessions');
  return { server: `http://${DEFAULT_HOST}:${port}`, version: health.version, sessions: sessions.body.sessions };
}

function cmdModes() {
  return resolveModes();
}

function skillDirList() {
  return (process.env.AOS_PLAN_CANVAS_SKILL_DIRS || [
    path.join(process.env.HOME || os.homedir(), '.claude', 'skills'),
    path.join(process.env.HOME || os.homedir(), '.agents', 'skills'),
    path.join(process.env.HOME || os.homedir(), '.codex', 'skills'),
    path.join(process.env.HOME || os.homedir(), '.config', 'opencode', 'skills'),
    path.join(process.env.HOME || os.homedir(), '.gemini', 'config', 'skills')
  ].join(':')).split(':');
}

function findSkillMd(name) {
  for (const dir of skillDirList()) {
    const p = path.join(dir, name, 'SKILL.md');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function resolveModes() {
  const modes = [
    {
      id: 'standard',
      label: 'Standard Plan Canvas',
      available: true,
      reason: null
    }
  ];

  // Check for bdb-plan-builder
  const planBuilderPath = path.resolve(__dirname, 'lib', 'plan-builder', 'index.js');
  modes.push({
    id: 'bdb-plan-builder',
    label: 'BDB Plan Builder',
    available: fs.existsSync(planBuilderPath),
    reason: fs.existsSync(planBuilderPath) ? null : 'bdb-plan-builder not installed'
  });

  return {
    default: 'standard',
    modes
  };
}

async function cmdOpen(file, args, { stateDir, port }) {
  if (!file) throw new Error('open requires a file path');
  if (!fs.existsSync(path.resolve(file))) throw new Error(`artifact not found: ${file}`);

  const mode = valueAfter(args, '--mode') || 'standard';
  const modesInfo = resolveModes();
  const modeConfig = modesInfo.modes.find(m => m.id === mode);

  if (!modeConfig) {
    process.stderr.write(`Unknown mode: ${mode}\n`);
    return { error: `Unknown mode: ${mode}` };
  }

  if (!modeConfig.available) {
    process.stderr.write(`Mode not available: ${mode} (${modeConfig.reason})\n`);
    return { error: `Mode not available: ${mode} (${modeConfig.reason})` };
  }

  // bdb-plan-builder owns the artifact: it renders the plan folder to one
  // self-contained HTML file next to plan.mdx, then that file goes through the
  // normal session path unchanged.
  let artifact = path.resolve(file);
  let built = null;
  if (mode === 'bdb-plan-builder') {
    built = require('./lib/plan-builder').renderPlanFolder(file);
    if (!built.outFile) {
      const message = built.error || 'plan builder produced no output';
      process.stderr.write(`${message}\n`);
      return { error: message, mode };
    }
    artifact = built.outFile;
  }

  await ensureServer({ stateDir, port });
  const res = await request(port, 'POST', '/api/sessions', {
    file: artifact,
    reopen: args.includes('--reopen')
  });
  if (res.statusCode === 409) return res.body;
  if (res.statusCode !== 200) throw new Error(res.body.error || `open failed (HTTP ${res.statusCode})`);
  const url = `http://${DEFAULT_HOST}:${port}${res.body.url}`;
  const viewers = res.body.viewers || 0;
  const attached = viewers > 0;
  const launched = args.includes('--no-open') || attached ? false : openBrowser(url);
  return {
    status: 'open',
    url,
    resumed: Boolean(res.body.resumed),
    viewers,
    browser: attached ? 'already open' : launched ? 'opened' : 'not opened',
    mode,
    ...(built ? { artifact: built.outFile, warnings: built.warnings } : {}),
    next_step: built && built.warnings.length
      ? `Plan built with ${built.warnings.length} unreadable block(s), listed at the top of the artifact. Fix the MDX, then re-run \`open <dir> --mode bdb-plan-builder\` to rebuild. Then run \`aos-plan-canvas await <dir>/plan.builder.html\` and leave it running.`
      : 'Run `aos-plan-canvas await <file>` and leave it running; it returns when the human sends feedback, a verdict, or ends the session.'
  };
}

// Mint a token for a running dev app and print the snippet that loads the
// annotation layer into it. The token is bound to the app's exact origin.
async function cmdAnnotate(appUrl, args, context) {
  const { normalizeOrigin } = require('./lib/plan-canvas/annotation-schema');
  let origin = null;
  try {
    origin = normalizeOrigin(new URL(appUrl).origin);
  } catch {
    origin = null;
  }
  if (!origin) throw new Error('annotate requires a loopback app URL such as http://localhost:5173 (port 1024-65535)');
  const ttlRaw = valueAfter(args, '--ttl-ms');
  const ttlMs = ttlRaw === null ? undefined : Number(ttlRaw);
  if (ttlMs !== undefined && !Number.isFinite(ttlMs)) throw new Error('--ttl-ms must be a number');

  let file = valueAfter(args, '--session');
  if (!file) {
    const { hostname, port } = new URL(origin);
    file = path.resolve('production_artifacts', 'canvas-annotations', `${hostname.replace(/[^\w.-]/g, '_')}-${port}.md`);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `# Annotations for ${origin}\n`);
    }
  }
  const opened = await cmdOpen(file, args, context);
  if (opened.error || opened.status !== 'open') return opened;
  const key = sessionKeyFor(canonicalizeArtifactPath(file));
  const res = await request(context.port, 'POST', `/api/annotate/${key}/token`, {
    origin,
    ...(ttlMs === undefined ? {} : { ttlMs })
  });
  if (res.statusCode !== 200) throw new Error(res.body.error || `token request failed (HTTP ${res.statusCode})`);
  return {
    status: 'ready',
    url: opened.url,
    origin,
    scriptTag: res.body.scriptTag,
    bookmarklet: res.body.bookmarklet,
    expiresAt: res.body.expiresAt,
    next_step: `Add scriptTag to the dev app's index.html (or paste the bookmarklet), reload the app, press Alt+Shift+A to annotate, then run \`aos-plan-canvas await ${file}\`. The token only works from ${origin}; rerun annotate to rotate it.`
  };
}

function awaitRequest(port, key, timeoutMs) {
  if (!/^[a-f0-9]{12}$/.test(key)) throw new Error('invalid plan-canvas session key');
  const params = new URLSearchParams({ key });
  if (timeoutMs !== null) params.set('timeoutMs', String(timeoutMs));
  return new Promise((resolve, reject) => {
    const req = http.request(
      requestOptions(port, 'GET', `/api/await?${params}`, {}),
      res => {
        let data = '';
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data.trim()));
          } catch {
            reject(new Error('await response was not JSON (server restarted?) - re-run await; feedback is never lost'));
          }
        });
      }
    );
    req.setTimeout(0);
    req.on('error', reject);
    req.end();
  });
}

// A bdb-plan-builder session is keyed by the built plan.builder.html, but agents
// know the plan by its folder or plan.mdx; follow either to the built artifact.
function resolveArtifactArg(file) {
  if (!file) return file;
  const abs = path.resolve(file);
  try {
    const dir = fs.statSync(abs).isDirectory() ? abs : path.basename(abs) === 'plan.mdx' ? path.dirname(abs) : null;
    if (dir) {
      const built = path.join(dir, 'plan.builder.html');
      if (fs.existsSync(built)) return built;
    }
  } catch (_) {
    // fall through: a missing path is reported by the command itself
  }
  return file;
}

function addRoutes(result, file) {
  if (!Array.isArray(result.items)) return;
  const { routeFor } = require('./lib/plan-canvas/route');
  let planHasComponents = false;
  if (result.items.some(item => item && item.kind === 'verdict' && item.verdict === 'approve')) {
    try {
      planHasComponents = require('./lib/plan-canvas/trail-on-approve').planComponents(file).length > 0;
    } catch {
      planHasComponents = false;
    }
  }
  for (const item of result.items) {
    if (item && typeof item === 'object') item.route = routeFor(item, { planHasComponents });
  }
  const routes = new Set(result.items.map(item => item && item.route));
  if (routes.has('visual-edit')) {
    result.next_step += ' Hand the visual-edit items to bdb-visual-edit (diff plan, wait for a yes in the canvas, then edit one file).';
  }
  if (routes.has('build')) {
    result.next_step += ' The plan is approved: continue with the build pipeline; agenttrail was started by the canvas.';
  }
}

async function cmdAwait(file, args, { stateDir, port }) {
  if (!file) throw new Error('await requires a file path');
  file = resolveArtifactArg(file);
  if (!(await healthCheck(port))) {
    return { status: 'no-server', hint: 'no canvas server is running; use `open` first', stateDir };
  }
  const reply = valueAfter(args, '--reply');
  if (reply) {
    const key = sessionKeyFor(canonicalizeArtifactPath(file));
    await request(port, 'POST', `/api/session/${key}/reply`, { text: reply });
  }
  const timeoutRaw = valueAfter(args, '--timeout-ms');
  const timeoutMs = timeoutRaw === null ? null : Number.parseInt(timeoutRaw, 10) || 0;
  process.stderr.write('[plan-canvas] waiting for human feedback... leave this running (re-run if interrupted; queued feedback is never lost)\n');
  const result = await awaitRequest(port, sessionKeyFor(canonicalizeArtifactPath(file)), timeoutMs);
  if (result.status === 'feedback') {
    result.next_step = result.sessionEnded
      ? 'The user sent this feedback and ended the session. Address it and report in chat; do not reopen the canvas uninvited.'
      : 'Address the feedback, then run `aos-plan-canvas await <file> --reply "<what you changed>"` to answer in the canvas and keep listening.';
    addRoutes(result, canonicalizeArtifactPath(file));
  } else if (result.status === 'ended') {
    result.next_step =
      result.endedBy === 'user'
        ? 'The user ended this review. Stop polling and deliver any remaining updates in chat; do not reopen uninvited.'
        : 'Session ended. Stop polling.';
  }
  return result;
}

// Show the human an activity indicator in the canvas chat. Cheap and
// fire-and-forget: a failed signal must never derail the actual work.
async function cmdTyping(file, args, { port }) {
  file = resolveArtifactArg(file);
  if (!file) throw new Error('typing requires a file path');
  const state = valueAfter(args, '--state') || 'typing';
  if (!(await healthCheck(port))) return { status: 'no-server' };
  const key = sessionKeyFor(canonicalizeArtifactPath(file));
  const res = await request(port, 'POST', `/api/session/${key}/typing`, { state });
  if (res.statusCode !== 200) throw new Error(res.body.error || `typing failed (HTTP ${res.statusCode})`);
  return { status: 'ok', state, presence: res.body.presence };
}

// Report feedback the human sent that no agent has picked up yet. Reads state
// directly so it answers even when the server has idled out.
function cmdPending({ stateDir }) {
  const store = createSessionStore({ stateDir });
  const waiting = store
    .list()
    .filter(session => session.status !== 'ended' && session.pending > 0)
    .map(session => ({ file: session.file, pending: session.pending, updatedAt: session.updatedAt }));
  return {
    status: waiting.length ? 'pending' : 'clear',
    sessions: waiting,
    next_step: waiting.length
      ? 'Run `aos-plan-canvas await <file>` for each file above to receive the messages.'
      : 'No canvas feedback is waiting.'
  };
}

async function cmdEnd(file, { port }) {
  file = resolveArtifactArg(file);
  if (!file) throw new Error('end requires a file path');
  if (!(await healthCheck(port))) return { status: 'no-server' };
  const res = await request(port, 'POST', '/api/end', { file: path.resolve(file) });
  return res.body;
}

async function cmdStop({ stateDir, port }) {
  if (!(await healthCheck(port))) return { status: 'not running' };
  await request(port, 'POST', '/shutdown').catch(() => {});
  fs.rmSync(serverInfoPath(stateDir), { force: true });
  return { status: 'stopping' };
}

async function cmdServer(args, { stateDir, port }) {
  const portArg = valueAfter(args, '--port');
  const hostArg = valueAfter(args, '--host');
  const listenPort = portArg !== null ? Number.parseInt(portArg, 10) : port;
  const store = createSessionStore({ stateDir });
  let shuttingDown = false;
  const shutdown = async code => {
    if (shuttingDown) return;
    shuttingDown = true;
    fs.rmSync(serverInfoPath(stateDir), { force: true });
    await canvas.close().catch(() => {});
    process.exit(code);
  };
  const canvas = createPlanCanvasServer({
    store,
    workspaceRoot: process.cwd(),
    host: hostArg || DEFAULT_HOST,
    version: VERSION,
    idleTimeoutMs: resolveIdleTimeoutMs(),
    onIdleShutdown: () => shutdown(0),
    log: line => process.stderr.write(`${line}\n`)
  });
  const bound = await canvas.listen(listenPort);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    serverInfoPath(stateDir),
    JSON.stringify({ pid: process.pid, port: bound.port, version: VERSION, startedAt: new Date().toISOString() }, null, 2)
  );
  // Sessions restored from disk resume their file watchers.
  for (const session of store.list()) {
    if (session.status !== 'ended') canvas.watchSession(store.get(session.key));
  }
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.stderr.write(`[plan-canvas] serving on http://${bound.host}:${bound.port}\n`);
  return new Promise(() => {}); // run until a signal or idle shutdown
}

const TEMPLATES_DIR = path.join(__dirname, 'lib', 'plan-builder', 'templates');

function cmdTemplates() {
  let ids = [];
  try { ids = fs.readdirSync(TEMPLATES_DIR); } catch { /* no templates dir */ }
  const list = [];
  for (const id of ids.sort()) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, id, 'meta.json'), 'utf8'));
      list.push({ id: m.id || id, label: m.label, description: m.description, useWhen: m.useWhen, hasBoard: Boolean(m.hasBoard) });
    } catch { /* skip templates without readable meta.json */ }
  }
  return list;
}

function cmdNew(args) {
  const fail = (error) => {
    process.stderr.write(`${error}\n`);
    output({ error });
    return 2;
  };
  const mode = valueAfter(args, '--mode') || 'bdb-plan-builder';
  const [id, target] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--mode');
  const ids = cmdTemplates().map(t => t.id);
  if (!id || !ids.includes(id)) return fail(`Unknown template "${id || ''}". Valid ids: ${ids.join(', ') || '(none)'}`);
  if (!target) return fail('Usage: aos-plan-canvas new <template-id> <target-dir> [--mode standard|bdb-plan-builder]');
  if (mode !== 'standard' && mode !== 'bdb-plan-builder') return fail(`Unknown mode "${mode}". Valid modes: standard, bdb-plan-builder`);
  const dir = path.resolve(target);
  if (fs.existsSync(dir) && (!fs.statSync(dir).isDirectory() || fs.readdirSync(dir).length)) {
    return fail(`Refusing to overwrite non-empty target: ${dir}`);
  }
  const src = path.join(TEMPLATES_DIR, id);
  const files = mode === 'standard' ? [['standard.md', 'plan.md']] : [['plan.mdx', 'plan.mdx'], ['canvas.mdx', 'canvas.mdx']];
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const [from, to] of files) {
    if (!fs.existsSync(path.join(src, from))) continue;
    fs.copyFileSync(path.join(src, from), path.join(dir, to));
    written.push(path.join(dir, to));
  }
  const entry = mode === 'standard' ? 'plan.md' : 'plan.mdx';
  output({ template: id, mode, dir, files: written, next_step: `aos-plan-canvas open ${path.join(dir, entry)}${mode === 'standard' ? '' : ' --mode bdb-plan-builder'}` });
  return 0;
}

async function main(argv = process.argv.slice(2)) {
  const args = argv.slice();
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const command = args[0] && !args[0].startsWith('--') ? args.shift() : null;
  const stateDir = resolveStateDir();
  // A running server may sit on a non-default port; trust its recorded info.
  const recorded = readServerInfo(stateDir);
  const context = { stateDir, port: (recorded && recorded.port) || resolvePort() };
  try {
    if (command === null) output(await cmdStatus(context));
    else if (command === 'modes') output(cmdModes());
    else if (command === 'templates') output(cmdTemplates());
    else if (command === 'new') return cmdNew(args);
    else if (command === 'open') {
      const result = await cmdOpen(args[0], args, context);
      if (result.error) {
        output(result);
        return 2;
      }
      output(result);
    }
    else if (command === 'trail') {
      const { writeTrail, TrailError } = require('./lib/plan-builder/trail');
      try {
        output(writeTrail(args[0], { out: valueAfter(args, '--out'), force: args.includes('--force') }));
      } catch (error) {
        if (!(error instanceof TrailError)) throw error;
        process.stderr.write(`${error.message}\n`);
        output({ error: error.message });
        return 2;
      }
    }
    else if (command === 'annotate') {
      const result = await cmdAnnotate(args[0], args, context);
      output(result);
      if (result.error) return 2;
    }
    else if (command === 'await') output(await cmdAwait(args[0], args, context));
    else if (command === 'pending') output(cmdPending(context));
    else if (command === 'typing') output(await cmdTyping(args[0], args, context));
    else if (command === 'end') output(await cmdEnd(args[0], context));
    else if (command === 'stop') output(await cmdStop(context));
    else if (command === 'server') await cmdServer(args, context);
    else {
      process.stderr.write(`Unknown command: ${command}\n\n${usage()}\n`);
      return 1;
    }
    return 0;
  } catch (error) {
    output({ error: error.message });
    return 1;
  }
}

if (require.main === module) {
  main().then(code => {
    process.exitCode = code;
  });
}

module.exports = { main, ensureServer, healthCheck, cmdTemplates, findSkillMd };
