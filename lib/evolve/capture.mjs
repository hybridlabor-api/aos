import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { redact } from './redact.mjs';
import { validateSchema } from './validate.mjs';
import { assertNotDenied } from './deny.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

const MAX_INPUT_SIZE = 64 * 1024; // 64 KiB cap per review finding 4
const STALE_LOCK_TIMEOUT_MS = 5000;
const MAX_LOCK_WAIT_MS = 5000;

export const HARNESS_ENV = [
  'CLAUDE_SESSION_ID',
  'CLAUDECODE',
  'OPENCODE',
  'CODEX_SANDBOX',
  'CODEX_SESSION_ID',
  'AGY_SESSION_ID',
  'ANTIGRAVITY_SESSION_ID',
];

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const start = Date.now();
    while (Date.now() - start < ms) {}
  }
}

export function acquireStoreLock(storePath, opts = {}) {
  const staleTimeout = opts.staleTimeoutMs || STALE_LOCK_TIMEOUT_MS;
  const maxWait = opts.maxWaitMs || MAX_LOCK_WAIT_MS;
  const lockPath = `${storePath}.lock`;
  const baseDir = opts.baseDir || path.dirname(storePath);

  assertNotDenied(lockPath, baseDir);

  const start = Date.now();
  while (true) {
    try {
      const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
      try {
        fs.writeSync(fd, `${process.pid}\n${Date.now()}\n`);
      } catch {}
      return {
        lockPath,
        fd,
        release: () => {
          try { fs.closeSync(fd); } catch {}
          try { fs.unlinkSync(lockPath); } catch {}
        },
      };
    } catch (err) {
      if (err.code === 'EEXIST') {
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > staleTimeout) {
            try { fs.unlinkSync(lockPath); } catch {}
            continue;
          }
        } catch {
          continue;
        }

        if (Date.now() - start > maxWait) {
          throw new Error(`Timed out waiting for store lock on '${lockPath}' after ${maxWait}ms`);
        }
        sleepSync(25);
        continue;
      }
      throw err;
    }
  }
}

export function withStoreLock(storePath, fn, opts = {}) {
  const lock = acquireStoreLock(storePath, opts);
  try {
    return fn();
  } finally {
    lock.release();
  }
}

export function isEvolveDisabled(opts = {}) {
  if (process.env.AOS_EVOLVE === 'off' || process.env.AOS_EVOLVE === '0') {
    return true;
  }
  const home = opts.home || process.env.HOME || os.homedir();
  const killFile = path.join(home, '.aos', 'evolve', 'DISABLED');
  return fs.existsSync(killFile);
}

export function disableEvolve(opts = {}) {
  const home = opts.home || process.env.HOME || os.homedir();
  const dir = path.join(home, '.aos', 'evolve');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch {}
  const marker = path.join(dir, 'DISABLED');
  assertNotDenied(marker, dir);
  fs.writeFileSync(marker, `Disabled at ${new Date().toISOString()}\n`, { encoding: 'utf8', mode: 0o600, flag: 'w' });
  try { fs.chmodSync(marker, 0o600); } catch {}
  return marker;
}

export function enableEvolve(opts = {}) {
  const home = opts.home || process.env.HOME || os.homedir();
  const marker = path.join(home, '.aos', 'evolve', 'DISABLED');
  assertNotDenied(marker, path.dirname(marker));
  if (fs.existsSync(marker)) {
    fs.unlinkSync(marker);
    return true;
  }
  return false;
}

export async function confirmEnable({ stdin = process.stdin, stdout = process.stdout, ask, env = process.env } = {}) {
  if (!stdin.isTTY || !stdout.isTTY) {
    return { ok: false, reason: 'refused: enable requires an interactive TTY terminal' };
  }
  const h = HARNESS_ENV.find((k) => env[k]);
  if (h) {
    return { ok: false, reason: `refused: harness session detected (${h}); enable must be run directly by human` };
  }
  const promptFn = ask || (() => new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout });
    rl.question('Loosening kill switch (enable). Type ENABLE to confirm: ', (answer) => {
      rl.close();
      resolve(answer);
    });
  }));
  stdout.write('AOS Evolve re-enable requires human confirmation.\n');
  const answer = String(await promptFn()).trim();
  if (answer !== 'ENABLE') {
    return { ok: false, reason: 'refused: confirmation does not match (expected "ENABLE")' };
  }
  return { ok: true };
}

export function computeErrorSig(error, context = {}) {
  const rawMessage = error instanceof Error
    ? `${error.name}: ${error.message}\n${error.stack || ''}`
    : typeof error === 'object' && error !== null
      ? JSON.stringify(error)
      : String(error ?? '');

  const redactedMsg = redact(rawMessage);
  const normalized = redactedMsg
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g, '')
    .replace(/(?::\d+){1,2}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const ctxPart = context.location || context.step || '';
  const payload = `${normalized}::${ctxPart}`;
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

// Confines storage to ~/.aos/evolve/ (or home/.aos/evolve/) to prevent overwriting arbitrary files
export function resolveFailureStorePath(customPath, opts = {}) {
  const home = opts.home || process.env.HOME || os.homedir();
  const allowedBaseDir = path.resolve(home, '.aos', 'evolve');

  if (customPath) {
    const resolved = path.resolve(customPath);
    // Path traversal check: must stay within allowedBaseDir
    const rel = path.relative(allowedBaseDir, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Storage path '${customPath}' is outside allowed directory (${allowedBaseDir})`);
    }
    // Must be a json or jsonl file
    if (!resolved.endsWith('.json') && !resolved.endsWith('.jsonl')) {
      throw new Error(`Storage path must end with .json or .jsonl: ${customPath}`);
    }
    assertNotDenied(resolved, allowedBaseDir);
    return resolved;
  }

  const defaultPath = path.join(allowedBaseDir, 'failure.json');
  assertNotDenied(defaultPath, allowedBaseDir);
  return defaultPath;
}

export function loadFailures(storePath, opts = {}) {
  const home = opts.home || process.env.HOME || os.homedir();
  const evolveMarker = path.join('.aos', 'evolve');
  const evolveIdx = storePath ? storePath.indexOf(evolveMarker) : -1;
  const baseDir = opts.baseDir || (evolveIdx !== -1 ? storePath.slice(0, evolveIdx + evolveMarker.length) : path.resolve(home, evolveMarker));

  assertNotDenied(storePath, baseDir);
  if (!fs.existsSync(storePath)) {
    return [];
  }
  const raw = fs.readFileSync(storePath, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse failures store at ${storePath}: ${err.message}`);
  }
  return Array.isArray(data) ? data : [data];
}

// Atomic save with 0700 dir, 0600 file modes, wx flag, and assertNotDenied
export function saveFailures(failures, storePath, opts = {}) {
  const home = opts.home || process.env.HOME || os.homedir();
  const evolveMarker = path.join('.aos', 'evolve');
  const evolveIdx = storePath ? storePath.indexOf(evolveMarker) : -1;
  const baseDir = opts.baseDir || (evolveIdx !== -1 ? storePath.slice(0, evolveIdx + evolveMarker.length) : path.resolve(home, evolveMarker));

  assertNotDenied(storePath, baseDir);

  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  try { fs.chmodSync(dir, 0o700); } catch {}

  const tmpPath = `${storePath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
  assertNotDenied(tmpPath, baseDir);

  fs.writeFileSync(tmpPath, JSON.stringify(failures, null, 2) + '\n', { flag: 'wx', encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(tmpPath, 0o600); } catch {}
  fs.renameSync(tmpPath, storePath);
}

// Optional memB write with graceful degradation (resolves relative to install root, not cwd)
async function tryRecordToMemB(record) {
  try {
    const membPath = path.join(REPO_ROOT, 'skills/global_config/memb-skill/lib/memb.mjs');
    if (fs.existsSync(membPath)) {
      const membUrl = pathToFileURL(membPath).href;
      const { addMemory } = await import(membUrl);
      if (typeof addMemory === 'function') {
        await addMemory({
          kind: 'harness-failure',
          failure_id: record.id,
          skill: record.skill,
          error_sig: record.error_sig,
          content: record.redacted_excerpt,
        });
      }
    }
  } catch {
    // Graceful degradation: memB is optional
  }
}

export function captureFailure(params) {
  const {
    error,
    skill,
    context = {},
    kind = 'test',
    harness = 'agy',
    role = 'builder',
    trail_node,
    session_ref,
    cwd_class = 'worktree',
    storagePath,
    dryRun = false,
    home,
  } = params || {};

  if (!error) {
    return { ok: false, error: 'Missing required parameter: error' };
  }
  if (!skill) {
    return { ok: false, error: 'Missing required parameter: skill' };
  }

  // Input size cap check (review finding 4)
  const rawExcerpt = error instanceof Error
    ? `${error.name}: ${error.message}\n${error.stack || ''}`
    : typeof error === 'object' && error !== null
      ? JSON.stringify(error, null, 2)
      : String(error);

  if (Buffer.byteLength(rawExcerpt, 'utf8') > MAX_INPUT_SIZE) {
    return { ok: false, error: `Failure input exceeds size cap of ${MAX_INPUT_SIZE} bytes` };
  }

  // Check kill switch
  if (isEvolveDisabled({ home })) {
    return { ok: false, error: 'AOS Evolve is disabled via kill switch' };
  }

  let storePath;
  try {
    storePath = resolveFailureStorePath(storagePath, { home });
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const baseDir = path.dirname(storePath);
  const redactedExcerpt = redact(rawExcerpt);
  const errorSig = computeErrorSig(error, context);

  const executeStoreUpdate = () => {
    let failures;
    try {
      failures = loadFailures(storePath, { baseDir });
    } catch (err) {
      return { ok: false, error: err.message };
    }

    const existingIdx = failures.findIndex((f) => f && typeof f === 'object' && f.error_sig === errorSig && f.skill === skill);

    if (existingIdx !== -1) {
      const existing = failures[existingIdx];
      existing.count = (existing.count || 1) + 1;
      existing.last_seen = new Date().toISOString();
      if (!dryRun) {
        saveFailures(failures, storePath, { baseDir });
      }
      return {
        ok: true,
        deduplicated: true,
        count: existing.count,
        record: existing,
        storePath,
      };
    }

    const now = new Date().toISOString();
    const id = `fail-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const record = {
      version: 1,
      id,
      ts: now,
      first_seen: now,
      last_seen: now,
      count: 1,
      skill,
      harness,
      role,
      kind,
      error_sig: errorSig,
      redacted_excerpt: redactedExcerpt,
      ...(trail_node ? { trail_node } : {}),
      ...(session_ref ? { session_ref } : {}),
      ...(cwd_class ? { cwd_class } : {}),
    };

    const validation = validateSchema('failure', record);
    if (!validation.valid) {
      return {
        ok: false,
        error: `Failure record validation failed: ${validation.errors.join('; ')}`,
        errors: validation.errors,
      };
    }

    failures.push(record);

    let membPromise = null;
    if (!dryRun) {
      saveFailures(failures, storePath, { baseDir });
      membPromise = tryRecordToMemB(record);
    }

    return {
      ok: true,
      deduplicated: false,
      count: 1,
      record,
      storePath,
      membPromise,
    };
  };

  if (dryRun) {
    return executeStoreUpdate();
  }

  try {
    return withStoreLock(storePath, executeStoreUpdate, { baseDir });
  } catch (err) {
    return { ok: false, error: `Store write lock failed: ${err.message}` };
  }
}

export default {
  captureFailure,
  computeErrorSig,
  isEvolveDisabled,
  disableEvolve,
  enableEvolve,
  confirmEnable,
  acquireStoreLock,
  withStoreLock,
  loadFailures,
  saveFailures,
  resolveFailureStorePath,
};
