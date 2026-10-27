// AOS Fabric executors: aos-acp adapter, AO detection, harness choice, fake executor for tests
// Runs a step through an executor and validates the report

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { createStore, EXIT_CODES } from './store.mjs';
import { validateReport } from './schema.mjs';

// Detect current harness from environment (set by aos-gate.mjs)
function detectCurrentHarness(env = process.env) {
  if (env.HARNESS_ENV === 'claude') return 'claude';
  if (env.HARNESS_ENV === 'codex') return 'codex';
  if (env.HARNESS_ENV === 'opencode') return 'opencode';
  if (env.HARNESS_ENV === 'agy') return 'agy';
  return null;
}

// Check which harnesses are installed by looking for their CLIs
function installedHarnesses() {
  const candidates = ['claude', 'codex', 'opencode', 'agy'];
  const installed = [];

  for (const harness of candidates) {
    try {
      const result = spawnSync(harness, ['--version'], { stdio: 'ignore', timeout: 2000 });
      if (result.status === 0 || result.error?.code !== 'ENOENT') {
        installed.push(harness);
      }
    } catch {
      // Not installed
    }
  }

  return installed;
}

// Choose harness: model_hint.harness, current harness, or first installed
export function chooseHarness(modelHint = {}, env = process.env) {
  if (modelHint.harness) {
    return modelHint.harness;
  }

  const current = detectCurrentHarness(env);
  if (current) {
    return current;
  }

  const installed = installedHarnesses();
  if (installed.length > 0) {
    return installed[0];
  }

  return null; // No harness available
}

// Check if AO is available (ao command on PATH, health endpoint responds)
export async function detectAO() {
  try {
    const result = spawnSync('ao', ['--version'], { stdio: 'ignore', timeout: 2000 });
    if (result.status === 0 || result.error?.code !== 'ENOENT') {
      // Try health check
      try {
        const health = await fetch('http://localhost:3101/health', { timeout: 1000 });
        return health.ok;
      } catch {
        return false;
      }
    }
  } catch {
    // Silently fail
  }
  return false;
}

// Synthetic fail report for timeout
function timeoutReport(stepId) {
  return {
    schema: 'aos.fabric.report/1',
    step_id: stepId,
    status: 'fail',
    exit_code: 124,
    findings: [{ id: 'timeout', severity: 'blocking', node: 'executor', summary: 'Executor timeout', status: 'open' }],
    artifacts: {},
    files_changed: [],
    needs_human: true,
    executor: { name: 'timeout', exit_code: 124 },
  };
}

// Fake executor for testing (env AOS_FABRIC_FAKE_EXECUTOR=<script>)
export async function runFakeExecutor(step, env = process.env) {
  const script = env.AOS_FABRIC_FAKE_EXECUTOR;
  if (!script) {
    throw new Error('AOS_FABRIC_FAKE_EXECUTOR not set');
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('sh', ['-c', script], {
      cwd: step.cwd,
      env: { ...env, STEP_ID: step.step_id, REPORT_PATH: step.expected_report },
      stdio: 'pipe',
    });

    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 5000);
    }, (step.timeout_s || 3600) * 1000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });

    proc.on('error', reject);
  });
}

// Run step through aos-acp
export async function runAosCp(step, harness, env = process.env) {
  return new Promise((resolve, reject) => {
    const args = [
      harness,
      '--name', step.step_id,
      '--cwd', step.cwd,
      '--prompt-file', step.brief,
      '--timeout', String(step.timeout_s || 3600),
    ];

    if (step.scope === 'read-only') {
      args.push('--allow-default', 'deny');
    } else if (step.scope === 'worktree-write') {
      args.push('--allow-default', 'scoped');
    }

    const proc = spawn('aos-acp', args, { stdio: 'pipe', env });

    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 10000);
    }, (step.timeout_s || 3600) * 1000 + 10000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });

    proc.on('error', reject);
  });
}

// Verify report: check artifacts, scope, git status
export function verifyReport(step, report, cwd = process.cwd()) {
  const errors = [];

  // Check allowed_writes
  if (step.scope === 'worktree-write' && step.allowed_writes) {
    for (const file of report.files_changed || []) {
      let allowed = false;
      for (const glob of step.allowed_writes) {
        // Simple glob match (no minimatch; just check if the file is under the allowed path)
        if (glob === '**' || file.includes(glob.replace('/**', ''))) {
          allowed = true;
          break;
        }
      }
      if (!allowed) {
        errors.push(`File ${file} outside allowed_writes: ${step.allowed_writes.join(', ')}`);
      }
    }
  }

  // Check artifacts exist
  if (report.artifacts) {
    for (const [key, path] of Object.entries(report.artifacts)) {
      if (!existsSync(join(cwd, path))) {
        errors.push(`Artifact ${key} missing: ${path}`);
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// Main executor runner: chooses executor, runs it, validates report
export async function executeStep(step, opts = {}) {
  const { baseDir = 'production_artifacts', executor: executorName = null, fakeExecutor = false } = opts;
  const env = opts.env || process.env;
  const store = createStore(step.run_id || 'test', baseDir);

  try {
    // Choose harness if needed
    let harness = executorName === 'ao' ? 'ao' : chooseHarness(step.model_hint, env);
    if (!harness) {
      const report = { schema: 'aos.fabric.report/1', step_id: step.step_id, status: 'fail', exit_code: 1, findings: [{ id: 'no_harness', severity: 'blocking', node: 'executor', summary: 'No harness installed', status: 'open' }], artifacts: {}, files_changed: [], needs_human: true };
      return { ok: false, report, code: EXIT_CODES.UNEXPECTED_ERROR };
    }

    // For agy with worktree-write, require sandbox
    if (harness === 'agy' && step.scope === 'worktree-write' && !opts.sandbox) {
      const report = { schema: 'aos.fabric.report/1', step_id: step.step_id, status: 'fail', exit_code: 1, findings: [{ id: 'agy_scope', severity: 'blocking', node: 'executor', summary: 'agy requires --sandbox for worktree-write scope', status: 'open' }], artifacts: {}, files_changed: [], needs_human: false };
      return { ok: false, report, code: EXIT_CODES.UNEXPECTED_ERROR };
    }

    // Run executor
    let exitCode = 0;
    if (fakeExecutor) {
      exitCode = await runFakeExecutor(step, env);
    } else {
      exitCode = await runAosCp(step, harness, env);
    }

    // Read report
    if (!existsSync(step.expected_report)) {
      const report = { schema: 'aos.fabric.report/1', step_id: step.step_id, status: 'fail', exit_code: exitCode, findings: [{ id: 'no_report', severity: 'blocking', node: 'executor', summary: 'Executor did not write report', status: 'open' }], artifacts: {}, files_changed: [], needs_human: true };
      return { ok: false, report, code: EXIT_CODES.INVALID_INPUT };
    }

    const reportContent = readFileSync(step.expected_report, 'utf8');
    const report = JSON.parse(reportContent);

    // Validate schema
    const validation = validateReport(report);
    if (!validation.ok) {
      const report = { schema: 'aos.fabric.report/1', step_id: step.step_id, status: 'fail', exit_code: exitCode, findings: [{ id: 'bad_report', severity: 'blocking', node: 'executor', summary: `Report invalid: ${validation.errors[0]}`, status: 'open' }], artifacts: {}, files_changed: [], needs_human: true };
      return { ok: false, report, code: EXIT_CODES.INVALID_INPUT };
    }

    // Verify scope
    const verify = verifyReport(step, report, step.cwd);
    if (!verify.ok) {
      const report = { schema: 'aos.fabric.report/1', step_id: step.step_id, status: 'fail', exit_code: exitCode, findings: [{ id: 'scope_violation', severity: 'blocking', node: 'executor', summary: `Scope violation: ${verify.errors[0]}`, status: 'open' }], artifacts: {}, files_changed: [], needs_human: false };
      return { ok: false, report, code: EXIT_CODES.INVALID_INPUT };
    }

    return { ok: true, report, code: EXIT_CODES.SUCCESS, harness };
  } catch (err) {
    const report = { schema: 'aos.fabric.report/1', step_id: step.step_id, status: 'fail', exit_code: 1, findings: [{ id: 'executor_error', severity: 'blocking', node: 'executor', summary: err.message, status: 'open' }], artifacts: {}, files_changed: [], needs_human: true };
    return { ok: false, report, code: EXIT_CODES.UNEXPECTED_ERROR };
  }
}

// Drive: loop next → execute → report until terminal
export async function drive(opts) {
  const { run, executor, timeout, baseDir = 'production_artifacts' } = opts;

  if (!run) {
    process.stderr.write(JSON.stringify({ error: '--run is required' }) + '\n');
    process.exit(EXIT_CODES.INVALID_INPUT);
  }

  const store = createStore(run, baseDir);

  try {
    while (true) {
      // Get next step
      const state = store.replayState();
      if (!state.run_id) {
        process.stderr.write(JSON.stringify({ error: 'Run not found' }) + '\n');
        process.exit(EXIT_CODES.NOT_FOUND);
      }

      const result = require('./edges.mjs').decide(state);
      if (result.error || result.next.kind !== 'step') {
        // Terminal
        console.log(JSON.stringify({ phase: state.phase, kind: result.next.kind || 'done' }));
        process.exit(EXIT_CODES.SUCCESS);
      }

      const step = result.next.step || { step_id: `${state.iteration}-${result.next.node}-1` };

      // Execute step
      console.log(JSON.stringify({ event: 'step_start', step_id: step.step_id, node: result.next.node }));

      const execResult = await executeStep(step, { executor, baseDir });
      if (!execResult.ok) {
        console.log(JSON.stringify({ event: 'step_fail', step_id: step.step_id, code: execResult.code }));
        process.exit(execResult.code);
      }

      // Report
      console.log(JSON.stringify({ event: 'report_accepted', step_id: step.step_id, status: execResult.report.status }));

      // Re-check terminal
      const nextResult = require('./edges.mjs').decide(state, execResult.report);
      if (nextResult.next.kind !== 'step') {
        console.log(JSON.stringify({ phase: state.phase, kind: nextResult.next.kind || 'done' }));
        process.exit(EXIT_CODES.SUCCESS);
      }
    }
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message }) + '\n');
    process.exit(EXIT_CODES.UNEXPECTED_ERROR);
  }
}

export { createStore, EXIT_CODES };
