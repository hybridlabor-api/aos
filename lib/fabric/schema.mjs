// Step and report schemas (version 1) of the harness-neutral fabric loop.
// Major rule: another major version is rejected, unknown fields of the same major are kept.

export const STEP_SCHEMA_ID = 'aos.fabric.step/1';
export const REPORT_SCHEMA_ID = 'aos.fabric.report/1';
export const RESPONSE_SCHEMA_ID = 'aos.fabric.response/1';
export const STEP_KINDS = ['build', 'review', 'ship', 'plan', 'techlead', 'human'];
export const REPORT_STATUS = ['ok', 'fail', 'escalate'];
export const SCOPES = ['read-only', 'worktree-write', 'none'];
export const FINDING_SEVERITY = ['blocking', 'advisory'];
export const FINDING_STATUS = ['open', 'fixed', 'wont_fix'];
export const GATE_VALUES = ['pass', 'fail', 'skip'];
export const GATE_KEYS = ['lint', 'typecheck', 'tests', 'a11y', 'seo', 'security'];

export const MAX_FINDINGS = 200;
export const MAX_TEXT = 4000;
const MAX_MAP = 50;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isNode = (v) => isStr(v) && /^[a-z0-9_]+$/.test(v);

function checkSchemaId(id, name) {
  const m = /^(aos\.fabric\.[a-z]+)\/(\d+)(?:\.\d+)*$/.exec(typeof id === 'string' ? id : '');
  if (!m || m[1] !== `aos.fabric.${name}`) return `schema: expected aos.fabric.${name}/<major>, got ${JSON.stringify(id)}`;
  if (m[2] !== '1') return `schema: unsupported ${name} major version ${m[2]} (supported: 1)`;
  return null;
}

export function validateStep(step) {
  if (!isObj(step)) return { ok: false, errors: ['step must be an object'] };
  const errors = [];
  const bad = checkSchemaId(step.schema, 'step');
  if (bad) errors.push(bad);
  if (!/^\d+-[a-z0-9_]+-\d+$/.test(step.step_id ?? '')) errors.push('step_id: expected <iteration>-<node>-<attempt>');
  for (const k of ['node', 'role']) if (!isStr(step[k])) errors.push(`${k}: required non-empty string`);
  for (const k of ['brief', 'cwd', 'expected_report']) if (!isStr(step[k])) errors.push(`${k}: required non-empty path`);
  if (!STEP_KINDS.includes(step.kind)) errors.push(`kind: must be one of ${STEP_KINDS.join(', ')}`);
  if (!SCOPES.includes(step.scope)) errors.push(`scope: must be one of ${SCOPES.join(', ')}`);
  for (const k of ['timeout_s', 'attempt', 'max_attempts']) {
    if (!Number.isInteger(step[k]) || step[k] < 1) errors.push(`${k}: must be a positive integer`);
  }
  if (!Array.isArray(step.allowed_writes) || !step.allowed_writes.every(isStr)) errors.push('allowed_writes: must be an array of glob strings');
  if (step.model_hint !== undefined && !isObj(step.model_hint)) errors.push('model_hint: must be an object');
  return { ok: errors.length === 0, errors };
}

function checkFinding(f, i, errors) {
  const p = `findings[${i}]`;
  if (!isObj(f)) { errors.push(`${p}: must be an object`); return; }
  if (!isStr(f.id) || f.id.length > 128) errors.push(`${p}.id: required string up to 128 characters`);
  if (!FINDING_SEVERITY.includes(f.severity)) errors.push(`${p}.severity: must be ${FINDING_SEVERITY.join(' or ')}`);
  if (!isNode(f.node)) errors.push(`${p}.node: required node id`);
  if (!FINDING_STATUS.includes(f.status)) errors.push(`${p}.status: must be one of ${FINDING_STATUS.join(', ')}`);
  if (f.summary !== undefined && typeof f.summary !== 'string') errors.push(`${p}.summary: must be a string`);
}

// A finding as state.json holds it (the state schema allows exactly these keys).
export const stateFinding = (f) => ({
  id: f.id, severity: f.severity, node: f.node, status: f.status, summary: String(f.summary ?? '').slice(0, MAX_TEXT),
});

// Required: schema, step_id, status. Everything else defaults, so a small or hurried executor can still report.
// ok:true returns the report with defaults applied; unknown fields stay.
export function validateReport(report) {
  if (!isObj(report)) return { ok: false, errors: ['report must be a JSON object'] };
  const errors = [];
  const bad = checkSchemaId(report.schema, 'report');
  if (bad) errors.push(bad);
  if (!isStr(report.step_id)) errors.push('step_id: required non-empty string');
  if (!REPORT_STATUS.includes(report.status)) errors.push(`status: must be one of ${REPORT_STATUS.join(', ')}`);
  const out = { ...report };
  out.exit_code ??= report.status === 'ok' ? 0 : 1;
  out.findings ??= [];
  out.artifacts ??= {};
  out.files_changed ??= [];
  out.needs_human ??= false;
  out.executor ??= {};
  if (!Number.isInteger(out.exit_code)) errors.push('exit_code: must be an integer');
  if (!Array.isArray(out.findings) || out.findings.length > MAX_FINDINGS) errors.push(`findings: must be an array of up to ${MAX_FINDINGS}`);
  else out.findings.forEach((f, i) => checkFinding(f, i, errors));
  if (!isObj(out.artifacts) || Object.keys(out.artifacts).length > MAX_MAP) errors.push('artifacts: must be an object of key -> path');
  else {
    for (const [k, v] of Object.entries(out.artifacts)) {
      if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) errors.push(`artifacts: key ${JSON.stringify(k.slice(0, 40))} must be letters, digits and _ (up to 40)`);
      else if (!isStr(v)) errors.push(`artifacts.${k}: must be a non-empty path string`);
    }
  }
  if (!Array.isArray(out.files_changed) || !out.files_changed.every((x) => typeof x === 'string')) errors.push('files_changed: must be an array of strings');
  if (typeof out.needs_human !== 'boolean') errors.push('needs_human: must be a boolean');
  if (!isObj(out.executor)) errors.push('executor: must be an object');
  if (out.gate !== undefined) {
    if (!isObj(out.gate)) errors.push('gate: must be an object of key -> pass|fail|skip');
    else for (const [k, v] of Object.entries(out.gate)) if (!GATE_VALUES.includes(v)) errors.push(`gate.${k}: must be ${GATE_VALUES.join(', ')}`);
  }
  if (out.optional_nodes !== undefined && !(Array.isArray(out.optional_nodes) && out.optional_nodes.every(isNode))) {
    errors.push('optional_nodes: must be an array of node ids');
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [], report: out };
}

// The report a driver writes for a step whose executor crashed, timed out or left no usable report: a failed step, never a pass.
export function failReport(step, id, summary, exitCode = 1, executor = {}) {
  return {
    schema: REPORT_SCHEMA_ID, step_id: step.step_id, status: 'fail', exit_code: exitCode,
    findings: [{ id, severity: 'blocking', node: step.node, status: 'open', summary: String(summary).slice(0, 1000) }],
    artifacts: {}, files_changed: [], needs_human: false, executor,
  };
}
