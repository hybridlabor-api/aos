import fs from 'node:fs';
import path from 'node:path';

export const ARCHITECTURE_SPEC_PATH = 'production_artifacts/00_architecture.json';
export const ARCHITECTURE_HTML_PATH = 'production_artifacts/00_architecture.html';
export const ARCHITECTURE_STATE_KEY = 'architecture';
export const ARCHITECTURE_CHECK_COUNT = 9;
export const RECEIPT_MAX_BYTES = 65536;
export const LOG_MAX_CHARS = 400;
export const ARCHIFY_REL_BIN = 'skills/global_config/archify/bin/archify.mjs';
export const ARCHIFY_TIMEOUT_MS = 120000;
export const ARCHIFY_MAX_BYTES = 65536;
export const PLAN_CANVAS_BIN = 'aos-plan-canvas';
export const PLAN_CANVAS_TIMEOUT_MS = 15000;
export const PLAN_CANVAS_MAX_BYTES = 16384;
export const AGENT_TRAIL_BIN = 'aos-trail';
export const EXECUTION_PLAN_PATH = 'production_artifacts/00_execution_plan.md';

const ALLOWED_PATHS = new Set([ARCHITECTURE_SPEC_PATH, ARCHITECTURE_HTML_PATH]);
const SHA256_RE = /^[a-fA-F0-9]{64}$/;
const LONG_HEX_RE = /[a-fA-F0-9]{64}/g;
const HOME_RE = /\/(Users|home)\/[^\s/]+/g;

export function isAllowedArchitecturePath(value) {
  if (typeof value !== 'string') return false;
  return ALLOWED_PATHS.has(value);
}

function boundedString(raw, maxBytes) {
  if (typeof raw !== 'string') return { ok: false, value: '' };
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) return { ok: false, value: '' };
  return { ok: true, value: raw };
}

function firstDiagnosticMessage(diagnostics) {
  if (!Array.isArray(diagnostics)) return '';
  for (const entry of diagnostics) {
    if (entry && typeof entry.message === 'string' && entry.message) return entry.message;
    if (entry && typeof entry.code === 'string' && entry.code) return entry.code;
  }
  return '';
}

export function parseDeliverReceipt(raw, options = {}) {
  const maxBytes = Number.isInteger(options.maxBytes) ? options.maxBytes : RECEIPT_MAX_BYTES;
  const bounded = boundedString(raw, maxBytes);
  if (!bounded.ok) {
    return { ok: false, error: 'receipt exceeds bounded size, refusing to parse' };
  }
  let obj = null;
  try {
    obj = JSON.parse(bounded.value);
  } catch {
    return { ok: false, error: 'receipt is not valid JSON' };
  }
  if (!obj || typeof obj !== 'object') {
    return { ok: false, error: 'receipt is not a JSON object' };
  }
  if (obj.ok !== true) {
    const detail = (typeof obj.error === 'string' && obj.error) || firstDiagnosticMessage(obj.diagnostics) || 'archify deliver failed';
    return { ok: false, error: String(detail).slice(0, 300), stage: typeof obj.stage === 'string' ? obj.stage : 'unknown' };
  }
  const validation = obj.validation && typeof obj.validation === 'object' ? obj.validation : null;
  const checksPassed = validation ? validation.checksPassed : undefined;
  const checkCount = validation ? validation.checkCount : undefined;
  const errors = validation ? validation.errors : undefined;
  const artifactSha = obj.artifact && typeof obj.artifact.sha256 === 'string' ? obj.artifact.sha256 : '';
  const specSha = obj.specification && typeof obj.specification.sha256 === 'string' ? obj.specification.sha256 : '';
  if (checksPassed !== checkCount || checkCount !== ARCHITECTURE_CHECK_COUNT || errors !== 0) {
    return { ok: false, error: `deliver receipt incomplete: ${checksPassed}/${checkCount} checks, errors ${errors}` };
  }
  if (!SHA256_RE.test(artifactSha) || !SHA256_RE.test(specSha)) {
    return { ok: false, error: 'deliver receipt missing sha256 evidence' };
  }
  return {
    ok: true,
    checksPassed,
    checkCount,
    errors: 0,
    warnings: typeof validation.warnings === 'number' ? validation.warnings : 0,
    artifactSha256: artifactSha,
    specificationSha256: specSha,
  };
}

export function mergeArchitectureState(state, receipt) {
  const base = state && typeof state === 'object' ? state : {};
  const artifacts = base.artifacts && typeof base.artifacts === 'object' ? { ...base.artifacts } : {};
  if (receipt && receipt.ok === true) {
    artifacts[ARCHITECTURE_STATE_KEY] = ARCHITECTURE_HTML_PATH;
    return { state: { ...base, artifacts }, escalate: null };
  }
  const detail = receipt && typeof receipt.error === 'string' && receipt.error ? receipt.error : 'archify deliver/validate failed';
  return {
    state: { ...base, artifacts },
    escalate: `archify deliver/validate failed: ${String(detail).slice(0, 200)}, previous artifact preserved`,
  };
}

export function buildUrlLine() {
  return `url: ${ARCHITECTURE_HTML_PATH}`;
}

export function planCanvasCommands() {
  return {
    open: `aos-plan-canvas open ${ARCHITECTURE_HTML_PATH}`,
    awaitCmd: `aos-plan-canvas await ${ARCHITECTURE_HTML_PATH}`,
  };
}

export function agentTrailCommand() {
  return 'aos-trail . --plan production_artifacts/00_execution_plan.md --no-open';
}

export function buildPlanCanvasOpenArgs(htmlPath) {
  if (!isAllowedArchitecturePath(htmlPath)) return null;
  if (htmlPath !== ARCHITECTURE_HTML_PATH) return null;
  return ['open', ARCHITECTURE_HTML_PATH, '--no-open'];
}

export function buildAgentTrailArgs() {
  return ['.', '--plan', EXECUTION_PLAN_PATH, '--no-open'];
}

export async function runArchitectureCanvas(options = {}) {
  const cwd = options.cwd;
  const htmlPath = options.htmlPath;
  const exists = options.exists;
  const run = options.run;
  const maxBytes = Number.isInteger(options.maxBytes) ? options.maxBytes : PLAN_CANVAS_MAX_BYTES;
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : PLAN_CANVAS_TIMEOUT_MS;
  const args = buildPlanCanvasOpenArgs(htmlPath);
  if (!args || typeof cwd !== 'string' || cwd.length === 0) {
    return { displayed: false, reason: 'plan-canvas rejected untrusted arguments, architecture preserved', architecturePreserved: true };
  }
  if (typeof exists === 'function') {
    let present = false;
    try {
      present = exists(htmlPath);
    } catch {
      present = false;
    }
    if (!present) {
      return { displayed: false, reason: 'architecture artifact missing, canvas skipped', architecturePreserved: true };
    }
  }
  if (typeof run !== 'function') {
    return { displayed: false, reason: 'plan-canvas unavailable, architecture preserved', architecturePreserved: true };
  }
  let res = null;
  try {
    res = await run(args, { cwd, timeoutMs, shell: false });
  } catch (error) {
    return { displayed: false, error: redactForLog(error && error.message ? error.message : 'plan-canvas open failed'), architecturePreserved: true };
  }
  const out = boundedOutputText(res ? res.stdout : '', maxBytes);
  if (!out.ok) {
    return { displayed: false, error: 'plan-canvas output exceeds bounded size', architecturePreserved: true };
  }
  if (!res || res.status !== 0) {
    return { displayed: false, error: redactForLog((res && res.stderr) || 'plan-canvas open failed'), architecturePreserved: true };
  }
  return { displayed: true, architecturePreserved: true };
}

export function redactForLog(value) {
  const text = String(value ?? '');
  const homes = text.replace(HOME_RE, '~');
  const shas = homes.replace(LONG_HEX_RE, (m) => `${m.slice(0, 12)}..`);
  return shas.slice(0, LOG_MAX_CHARS);
}

function isWithin(root, candidate) {
  const relativePath = path.relative(root, candidate);
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath));
}

export function resolveArchifyBin(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return null;
  try {
    const root = fs.realpathSync(path.resolve(cwd));
    if (!fs.statSync(root).isDirectory()) return null;
    const binaryPath = fs.realpathSync(path.resolve(root, ARCHIFY_REL_BIN));
    if (!isWithin(root, binaryPath) || !fs.statSync(binaryPath).isFile()) return null;
    return binaryPath;
  } catch {
    return null;
  }
}

export function buildValidateArgs(specPath) {
  if (!isAllowedArchitecturePath(specPath)) return null;
  if (specPath !== ARCHITECTURE_SPEC_PATH) return null;
  return ['validate', 'architecture', specPath, '--quality', 'showcase', '--json'];
}

export function buildDeliverArgs(specPath, htmlPath) {
  if (!isAllowedArchitecturePath(specPath) || !isAllowedArchitecturePath(htmlPath)) return null;
  if (specPath !== ARCHITECTURE_SPEC_PATH || htmlPath !== ARCHITECTURE_HTML_PATH) return null;
  return ['deliver', 'architecture', specPath, htmlPath, '--quality', 'showcase', '--json'];
}

function boundedOutputText(value, maxBytes) {
  if (typeof value !== 'string') return { ok: false, text: '' };
  let size = 0;
  try {
    size = Buffer.byteLength(value, 'utf8');
  } catch {
    size = value.length;
  }
  if (size > maxBytes) return { ok: false, text: '' };
  return { ok: true, text: value };
}

function boundaryFailure(stage, detail) {
  return {
    ok: false,
    stage,
    error: redactForLog(String(detail || 'archify boundary step failed')).slice(0, LOG_MAX_CHARS),
    preservePrevious: true,
  };
}

export async function runArchifyBoundary(options = {}) {
  const cwd = options.cwd;
  const specPath = options.specPath;
  const htmlPath = options.htmlPath;
  const run = options.run;
  const maxBytes = Number.isInteger(options.maxBytes) ? options.maxBytes : ARCHIFY_MAX_BYTES;
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : ARCHIFY_TIMEOUT_MS;
  const validateArgs = buildValidateArgs(specPath);
  const deliverArgs = buildDeliverArgs(specPath, htmlPath);
  if (!validateArgs || !deliverArgs || typeof cwd !== 'string' || cwd.length === 0) {
    return boundaryFailure('arguments', 'archify boundary rejected untrusted arguments');
  }
  if (typeof run !== 'function') {
    return boundaryFailure('executor', 'archify boundary has no executor in this runtime');
  }
  let validateRes = null;
  try {
    validateRes = await run(validateArgs, { cwd, timeoutMs, shell: false, maxBuffer: maxBytes });
  } catch (error) {
    return boundaryFailure('validate', error && error.message ? error.message : 'archify validate executor failed');
  }
  const validateOut = boundedOutputText(validateRes ? validateRes.stdout : '', maxBytes);
  if (!validateRes || validateRes.status !== 0 || !validateOut.ok) {
    const detail = !validateOut.ok
      ? 'archify validate output exceeds bounded size'
      : (validateRes && validateRes.stderr) || 'archify validate failed';
    return boundaryFailure('validate', detail);
  }
  let deliverRes = null;
  try {
    deliverRes = await run(deliverArgs, { cwd, timeoutMs, shell: false, maxBuffer: maxBytes });
  } catch (error) {
    return boundaryFailure('deliver', error && error.message ? error.message : 'archify deliver executor failed');
  }
  const deliverOut = boundedOutputText(deliverRes ? deliverRes.stdout : '', maxBytes);
  if (!deliverRes || deliverRes.status !== 0 || !deliverOut.ok) {
    const detail = !deliverOut.ok
      ? 'archify deliver output exceeds bounded size'
      : (deliverRes && deliverRes.stderr) || 'archify deliver failed';
    return boundaryFailure('deliver', detail);
  }
  const receipt = parseDeliverReceipt(deliverOut.text, { maxBytes });
  if (!receipt || receipt.ok !== true) {
    return boundaryFailure('deliver', (receipt && receipt.error) || 'archify deliver receipt invalid');
  }
  return {
    ok: true,
    stage: 'deliver',
    validate: { status: 0 },
    deliver: { status: 0 },
    receipt,
    preservePrevious: false,
  };
}
