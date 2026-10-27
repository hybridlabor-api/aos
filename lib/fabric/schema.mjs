// AOS Fabric core schemas: step and report validators for aos.fabric.step/1 and aos.fabric.report/1
// Major version rule: unknown major → reject; unknown fields with same major → keep

export const STEP_SCHEMA = {
  schema: 'aos.fabric.step/1',
  step_id: 'string',
  node: 'string',
  role: 'string',
  kind: 'string', // build, review, ship, plan, techlead, human
  brief: 'string', // path
  cwd: 'string', // path
  model_hint: 'object', // { harness?, model? } optional
  timeout_s: 'number',
  scope: 'string', // read-only, worktree-write, none
  allowed_writes: 'array', // globs
  expected_report: 'string', // path
  attempt: 'number',
  max_attempts: 'number',
};

export const REPORT_SCHEMA = {
  schema: 'aos.fabric.report/1',
  step_id: 'string',
  status: 'string', // ok, fail, escalate
  exit_code: 'number',
  findings: 'array', // { id, severity, node, summary, status }
  artifacts: 'object', // { key: path }
  files_changed: 'array', // info only
  needs_human: 'boolean',
  executor: 'object', // { name, harness, model }
};

function validateObject(obj, schema) {
  const errors = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, errors: ['Value must be an object'] };
  }

  for (const [key, typeHint] of Object.entries(schema)) {
    if (key === 'schema') {
      if (typeof obj[key] !== 'string') {
        errors.push(`${key}: required string`);
      }
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      errors.push(`${key}: required field missing`);
    } else if (typeHint === 'string' && typeof obj[key] !== 'string') {
      errors.push(`${key}: must be string, got ${typeof obj[key]}`);
    } else if (typeHint === 'number' && typeof obj[key] !== 'number') {
      errors.push(`${key}: must be number, got ${typeof obj[key]}`);
    } else if (typeHint === 'boolean' && typeof obj[key] !== 'boolean') {
      errors.push(`${key}: must be boolean, got ${typeof obj[key]}`);
    } else if (typeHint === 'object' && (typeof obj[key] !== 'object' || Array.isArray(obj[key]))) {
      errors.push(`${key}: must be object, got ${Array.isArray(obj[key]) ? 'array' : typeof obj[key]}`);
    } else if (typeHint === 'array' && !Array.isArray(obj[key])) {
      errors.push(`${key}: must be array, got ${typeof obj[key]}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateStep(step) {
  const { ok, errors } = validateObject(step, STEP_SCHEMA);
  if (!ok) return { ok: false, errors };

  // Major version check
  const schemaField = step.schema || '';
  if (schemaField.includes('/')) {
    const major = schemaField.split('/')[1]?.split('.')[0];
    if (major !== '1') {
      return { ok: false, errors: [`Schema major version must be 1, got ${major}`] };
    }
  }

  return { ok: true, errors: [] };
}

export function validateReport(report) {
  const { ok, errors } = validateObject(report, REPORT_SCHEMA);
  if (!ok) return { ok: false, errors };

  // Major version check
  const schemaField = report.schema || '';
  if (schemaField.includes('/')) {
    const major = schemaField.split('/')[1]?.split('.')[0];
    if (major !== '1') {
      return { ok: false, errors: [`Schema major version must be 1, got ${major}`] };
    }
  }

  // Validate status enum
  if (!['ok', 'fail', 'escalate'].includes(report.status)) {
    errors.push(`status must be one of: ok, fail, escalate; got ${report.status}`);
  }

  // Validate findings shape
  if (Array.isArray(report.findings)) {
    for (let i = 0; i < report.findings.length; i++) {
      const f = report.findings[i];
      if (typeof f !== 'object' || !f.id || !f.severity || !f.node || !f.status) {
        errors.push(`findings[${i}]: missing required fields (id, severity, node, status)`);
      } else if (!['blocking', 'advisory'].includes(f.severity)) {
        errors.push(`findings[${i}].severity must be blocking or advisory, got ${f.severity}`);
      } else if (!['open', 'fixed', 'wont_fix'].includes(f.status)) {
        errors.push(`findings[${i}].status must be open, fixed, or wont_fix, got ${f.status}`);
      }
    }
  }

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

export const STEP_KIND_ENUM = ['build', 'review', 'ship', 'plan', 'techlead', 'human'];
export const REPORT_STATUS_ENUM = ['ok', 'fail', 'escalate'];
export const FINDING_SEVERITY_ENUM = ['blocking', 'advisory'];
export const SCOPE_ENUM = ['read-only', 'worktree-write', 'none'];
