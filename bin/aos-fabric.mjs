#!/usr/bin/env node
// aos-fabric — harness-neutral CLI for the fabric build loop
// start|next|report|status|cancel|drive with JSON stdout, error JSON on stderr
// Exit codes: 0=success, 1=unexpected error, 2=invalid input, 3=not found, 4=conflict,
//             5=lock busy, 6=terminal phase, 7=corrupted state

import '../lib/cli-help-guard.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, EXIT_CODES, TERMINAL_PHASES } from '../lib/fabric/store.mjs';
import { validateStep, validateReport } from '../lib/fabric/schema.mjs';
import { decide } from '../lib/fabric/edges.mjs';
import { drive } from '../lib/fabric/executors.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function errorJson(code, message) {
  return JSON.stringify({ error: message, code });
}

function exitWithCode(code, message) {
  if (message) {
    process.stderr.write(errorJson(code, message) + '\n');
  }
  process.exit(code);
}

function outputJson(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function cmdStart(opts) {
  if (!opts.run) {
    exitWithCode(EXIT_CODES.INVALID_INPUT, '--run is required');
  }
  if (!opts.goal && !opts.goalFile) {
    exitWithCode(EXIT_CODES.INVALID_INPUT, '--goal or --goal-file is required');
  }

  const goal = opts.goal || readFileSync(opts.goalFile, 'utf8');
  const store = createStore(opts.run);

  const lock = store.tryLock();
  if (!lock.ok) {
    exitWithCode(lock.code, `Lock busy: ${lock.pid} (age ${lock.ageMs}ms)`);
  }

  try {
    const existing = store.readState();
    if (existing && existing.goal === goal) {
      // Idempotent: return current state
      const next = nextStep(existing);
      outputJson({ schema: 'aos.fabric.response/1', run: opts.run, phase: existing.phase, next });
      return;
    } else if (existing && existing.goal !== goal) {
      exitWithCode(EXIT_CODES.CONFLICT, 'Different goal for same run ID');
    }

    // Fresh start
    const initialState = { run_id: opts.run, goal, phase: 'define', iteration: 0, findings: [], attempts: {} };
    const event = { kind: 'start', run_id: opts.run, goal, max_iterations: opts.maxIterations || 3 };
    store.appendEvent(event);
    store.writeState(initialState);

    const next = nextStep(initialState);
    outputJson({ schema: 'aos.fabric.response/1', run: opts.run, phase: initialState.phase, next });
  } catch (err) {
    exitWithCode(EXIT_CODES.UNEXPECTED_ERROR, err.message);
  } finally {
    store.releaseLock();
  }
}

async function cmdNext(opts) {
  if (!opts.run) {
    exitWithCode(EXIT_CODES.INVALID_INPUT, '--run is required');
  }

  const store = createStore(opts.run);
  try {
    const state = store.replayState();
    if (!state || !state.run_id) {
      exitWithCode(EXIT_CODES.NOT_FOUND, `Run ${opts.run} not found`);
    }

    // Terminal phase check
    if (TERMINAL_PHASES.includes(state.phase)) {
      outputJson({ schema: 'aos.fabric.response/1', kind: state.phase });
      process.exit(EXIT_CODES.TERMINAL_PHASE);
    }

    const next = nextStep(state);
    outputJson({ schema: 'aos.fabric.response/1', kind: next.kind || 'step', step: next.step });
  } catch (err) {
    if (err.message.includes('Corrupted')) {
      exitWithCode(EXIT_CODES.CORRUPTED_STATE, err.message);
    }
    exitWithCode(EXIT_CODES.UNEXPECTED_ERROR, err.message);
  }
}

async function cmdReport(opts) {
  if (!opts.run || !opts.step || !opts.file) {
    exitWithCode(EXIT_CODES.INVALID_INPUT, '--run, --step, --file are required');
  }

  const store = createStore(opts.run);
  const lock = store.tryLock();
  if (!lock.ok) {
    exitWithCode(lock.code, `Lock busy`);
  }

  try {
    const state = store.replayState();
    if (!state || !state.run_id) {
      exitWithCode(EXIT_CODES.NOT_FOUND, `Run ${opts.run} not found`);
    }

    // Read and validate report
    const reportContent = readFileSync(opts.file, 'utf8');
    const report = JSON.parse(reportContent);
    const validation = validateReport(report);
    if (!validation.ok) {
      exitWithCode(EXIT_CODES.INVALID_INPUT, `Report invalid: ${validation.errors.join('; ')}`);
    }

    if (report.step_id !== opts.step) {
      exitWithCode(EXIT_CODES.INVALID_INPUT, `Report step_id mismatch: expected ${opts.step}, got ${report.step_id}`);
    }

    // Idempotency check
    if (state.last_step_id === opts.step) {
      const reportDigest = hashReport(report);
      if (state.last_step_digest !== reportDigest) {
        exitWithCode(EXIT_CODES.CONFLICT, 'Different report for already-accepted step');
      }
      // Same digest: idempotent
      const next = nextStep(state);
      outputJson({ schema: 'aos.fabric.response/1', kind: next.kind || 'step' });
      return;
    }

    // Process report through edges
    const result = decide(state, report);
    if (result.error) {
      exitWithCode(result.code || EXIT_CODES.INVALID_INPUT, result.error);
    }

    const newState = result.state;
    newState.last_step_id = opts.step;
    newState.last_step_digest = hashReport(report);

    const event = { kind: 'report_accepted', step_id: opts.step, state_update: result.state };
    store.appendEvent(event);
    store.writeState(newState);

    const next = nextStep(newState);
    outputJson({ schema: 'aos.fabric.response/1', kind: next.kind || 'step', ...result });
  } catch (err) {
    if (err instanceof SyntaxError) {
      exitWithCode(EXIT_CODES.INVALID_INPUT, `Report JSON parse error: ${err.message}`);
    }
    exitWithCode(EXIT_CODES.UNEXPECTED_ERROR, err.message);
  } finally {
    store.releaseLock();
  }
}

async function cmdStatus(opts) {
  if (!opts.run) {
    exitWithCode(EXIT_CODES.INVALID_INPUT, '--run is required');
  }

  const store = createStore(opts.run);
  try {
    const state = store.replayState();
    if (!state || !state.run_id) {
      exitWithCode(EXIT_CODES.NOT_FOUND, `Run ${opts.run} not found`);
    }

    outputJson({ schema: 'aos.fabric.response/1', phase: state.phase, iteration: state.iteration, findings: state.findings });
  } catch (err) {
    if (err.message.includes('Corrupted')) {
      exitWithCode(EXIT_CODES.CORRUPTED_STATE, err.message);
    }
    exitWithCode(EXIT_CODES.UNEXPECTED_ERROR, err.message);
  }
}

async function cmdCancel(opts) {
  if (!opts.run) {
    exitWithCode(EXIT_CODES.INVALID_INPUT, '--run is required');
  }

  const store = createStore(opts.run);
  const lock = store.tryLock();
  if (!lock.ok) {
    exitWithCode(lock.code, `Lock busy`);
  }

  try {
    const state = store.replayState();
    if (!state || !state.run_id) {
      exitWithCode(EXIT_CODES.NOT_FOUND, `Run ${opts.run} not found`);
    }

    if (state.phase === 'cancelled') {
      // Idempotent
      outputJson({ schema: 'aos.fabric.response/1', phase: 'cancelled' });
      return;
    }

    state.phase = 'cancelled';
    const event = { kind: 'cancelled', run_id: opts.run, reason: opts.reason || '' };
    store.appendEvent(event);
    store.writeState(state);

    outputJson({ schema: 'aos.fabric.response/1', phase: 'cancelled' });
  } catch (err) {
    exitWithCode(EXIT_CODES.UNEXPECTED_ERROR, err.message);
  } finally {
    store.releaseLock();
  }
}

// Helper to hash reports for idempotency (from edges.mjs)
function hashReport(report) {
  const str = JSON.stringify(report);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return String(hash);
}

// Helper to derive next step from state
function nextStep(state) {
  const result = decide(state);
  if (result.error) {
    return { kind: 'error', error: result.error };
  }
  const next = result.next;
  if (next.kind === 'step') {
    return {
      kind: 'step',
      step: {
        step_id: `${state.iteration}-${next.node}-1`,
        node: next.node,
        role: next.role,
        kind: 'build',
        cwd: process.cwd(),
        timeout_s: 3600,
        scope: 'worktree-write',
        allowed_writes: ['**'],
      },
    };
  }
  return next;
}

function parseArgs(argv) {
  const cmd = argv[0];
  const opts = {};

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    const val = argv[i + 1];
    if (arg === '--run') opts.run = val, i++;
    else if (arg === '--goal') opts.goal = val, i++;
    else if (arg === '--goal-file') opts.goalFile = val, i++;
    else if (arg === '--step') opts.step = val, i++;
    else if (arg === '--file') opts.file = val, i++;
    else if (arg === '--max-iterations') opts.maxIterations = Number(val), i++;
    else if (arg === '--reason') opts.reason = val, i++;
    else if (arg === '--executor') opts.executor = val, i++;
    else if (arg === '--timeout') opts.timeout = Number(val), i++;
    else if (arg === '--skill') {
      if (!opts.skills) opts.skills = [];
      opts.skills.push(val);
      i++;
    }
  }

  return { cmd, opts };
}

async function main() {
  try {
    const argv = process.argv.slice(2);
    if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
      console.log('usage: aos-fabric start|next|report|status|cancel|drive [options]');
      console.log('  start:   --run <id> (--goal <text>|--goal-file <f>) [--max-iterations <n>] [--skill <name>...]');
      console.log('  next:    --run <id>');
      console.log('  report:  --run <id> --step <id> --file <path>');
      console.log('  status:  --run <id>');
      console.log('  cancel:  --run <id> [--reason <text>]');
      console.log('  drive:   --run <id> [--executor aos-acp|ao] [--timeout <s>]');
      process.exit(0);
    }

    const { cmd, opts } = parseArgs(argv);

    switch (cmd) {
      case 'start':
        await cmdStart(opts);
        break;
      case 'next':
        await cmdNext(opts);
        break;
      case 'report':
        await cmdReport(opts);
        break;
      case 'status':
        await cmdStatus(opts);
        break;
      case 'cancel':
        await cmdCancel(opts);
        break;
      case 'drive':
        await drive(opts);
        break;
      default:
        exitWithCode(EXIT_CODES.INVALID_INPUT, `unknown command: ${cmd}`);
    }
  } catch (err) {
    exitWithCode(EXIT_CODES.UNEXPECTED_ERROR, err.message);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    process.stderr.write(errorJson(1, err.message) + '\n');
    process.exit(1);
  });
}
