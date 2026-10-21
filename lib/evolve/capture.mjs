import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { redact } from './redact.mjs';
import { validateSchema } from './validate.mjs';

/**
 * Checks whether the evolution loop is disabled via kill switch.
 * Kill switch is triggered by ~/.aos/evolve/DISABLED or env AOS_EVOLVE=off.
 * @param {object} [opts] - Optional overrides
 * @returns {boolean} True if disabled
 */
export function isEvolveDisabled(opts = {}) {
  if (process.env.AOS_EVOLVE === 'off' || process.env.AOS_EVOLVE === '0') {
    return true;
  }
  const home = opts.home || process.env.HOME || os.homedir();
  const killFile = path.join(home, '.aos', 'evolve', 'DISABLED');
  return fs.existsSync(killFile);
}

/**
 * Disables the evolution loop by writing the kill switch marker.
 * @param {object} [opts] - Optional home override
 * @returns {string} Path to marker
 */
export function disableEvolve(opts = {}) {
  const home = opts.home || process.env.HOME || os.homedir();
  const dir = path.join(home, '.aos', 'evolve');
  fs.mkdirSync(dir, { recursive: true });
  const marker = path.join(dir, 'DISABLED');
  fs.writeFileSync(marker, `Disabled at ${new Date().toISOString()}\n`, 'utf8');
  return marker;
}

/**
 * Enables evolution loop by removing the kill switch marker.
 * @param {object} [opts] - Optional home override
 * @returns {boolean} True if removed
 */
export function enableEvolve(opts = {}) {
  const home = opts.home || process.env.HOME || os.homedir();
  const marker = path.join(home, '.aos', 'evolve', 'DISABLED');
  if (fs.existsSync(marker)) {
    fs.unlinkSync(marker);
    return true;
  }
  return false;
}

/**
 * Computes a deterministic error signature for deduplication.
 * @param {string|Error|object} error - Error object or message
 * @param {object} [context] - Execution context
 * @returns {string} SHA-256 signature hash
 */
export function computeErrorSig(error, context = {}) {
  const rawMessage = error instanceof Error
    ? `${error.name}: ${error.message}\n${error.stack || ''}`
    : typeof error === 'object' && error !== null
      ? JSON.stringify(error)
      : String(error ?? '');

  const redactedMsg = redact(rawMessage);
  // Normalize whitespace and strip dynamic line numbers/timestamps for stable signature
  const normalized = redactedMsg
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g, '')
    .replace(/(?::\d+){1,2}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const ctxPart = context.location || context.step || '';
  const payload = `${normalized}::${ctxPart}`;

  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

/**
 * Resolves the default failure file path.
 */
export function resolveFailureStorePath(customPath) {
  if (customPath) return path.resolve(customPath);
  const home = process.env.HOME || os.homedir();
  return path.join(home, '.aos', 'evolve', 'failure.json');
}

/**
 * Loads failures from storage.
 * @param {string} storePath
 * @returns {Array<object>}
 */
export function loadFailures(storePath) {
  if (!fs.existsSync(storePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(storePath, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [data];
  } catch {
    return [];
  }
}

/**
 * Saves failures to storage.
 * @param {Array<object>} failures
 * @param {string} storePath
 */
export function saveFailures(failures, storePath) {
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(storePath, JSON.stringify(failures, null, 2) + '\n', 'utf8');
}

/**
 * Captures a failure, redacts paths and credentials, deduplicates by signature,
 * and records into failure.json.
 * 
 * @param {object} params
 * @param {string|Error|object} params.error - Error or failure description
 * @param {string} params.skill - Target skill directory name
 * @param {object} [params.context] - Execution context
 * @param {string} [params.kind='test'] - 'test'|'build'|'review'|'advisor-repeat'|'user'
 * @param {string} [params.harness='agy'] - 'claude'|'agy'|'opencode'|'codex'
 * @param {string} [params.role='builder'] - Active agent role
 * @param {string} [params.trail_node] - Trail node ID
 * @param {string} [params.session_ref] - Session reference
 * @param {string} [params.cwd_class='worktree'] - CWD class
 * @param {string} [params.storagePath] - Custom failure.json destination
 * @param {boolean} [params.dryRun=false] - If true, calculate without writing
 * @returns {object} { ok: boolean, deduplicated?: boolean, record?: object, error?: string }
 */
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
  } = params || {};

  if (!error) {
    return { ok: false, error: 'Missing required parameter: error' };
  }
  if (!skill) {
    return { ok: false, error: 'Missing required parameter: skill' };
  }

  // Check kill switch
  if (isEvolveDisabled({ home: params.home })) {
    return { ok: false, error: 'AOS Evolve is disabled via kill switch' };
  }

  const rawExcerpt = error instanceof Error
    ? `${error.name}: ${error.message}\n${error.stack || ''}`
    : typeof error === 'object' && error !== null
      ? JSON.stringify(error, null, 2)
      : String(error);

  const redactedExcerpt = redact(rawExcerpt);
  const errorSig = computeErrorSig(error, context);
  const storePath = resolveFailureStorePath(storagePath);
  const failures = loadFailures(storePath);

  const existingIdx = failures.findIndex((f) => f.error_sig === errorSig && f.skill === skill);

  if (existingIdx !== -1) {
    const existing = failures[existingIdx];
    existing.count = (existing.count || 1) + 1;
    existing.last_seen = new Date().toISOString();
    if (!dryRun) {
      saveFailures(failures, storePath);
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
    saveFailures(failures, storePath);
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
