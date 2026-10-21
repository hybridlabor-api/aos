import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { redact } from './redact.mjs';
import { validateSchema } from './validate.mjs';
import { assertNotDenied } from './deny.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

const MAX_INPUT_SIZE = 64 * 1024; // 64 KiB cap per review finding 4

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

  let failures;
  try {
    failures = loadFailures(storePath, { baseDir });
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const existingIdx = failures.findIndex((f) => f.error_sig === errorSig && f.skill === skill);

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

  if (!dryRun) {
    saveFailures(failures, storePath, { baseDir });
    tryRecordToMemB(record);
  }

  return {
    ok: true,
    deduplicated: false,
    count: 1,
    record,
    storePath,
  };
}

export default {
  captureFailure,
  computeErrorSig,
  isEvolveDisabled,
  disableEvolve,
  enableEvolve,
  loadFailures,
  saveFailures,
  resolveFailureStorePath,
};
