#!/usr/bin/env node
// aos-fabric: the fabric build loop as a CLI that any harness, or a plain shell, can drive.
//   start | next | report | status | cancel | drive          JSON on stdout, one JSON error line on stderr
// Exit codes: 0 ok, 1 unexpected, 2 invalid input, 3 not found, 4 conflict, 5 lock busy, 6 run is terminal, 7 state corrupt.
// The rules (edges, loop brake, escalation) live in lib/fabric/edges.mjs; contract: .agents/graph.md.

import '../lib/cli-help-guard.mjs';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { acceptReport, cancelRun, nextView, startRun, statusView } from '../lib/fabric/engine.mjs';
import { EXIT_CODES, FabricError } from '../lib/fabric/store.mjs';
import { drive } from '../lib/fabric/executors.mjs';

const FLAGS = {
  '--run': 'run', '--goal': 'goal', '--goal-file': 'goalFile', '--skill': 'skill', '--max-iterations': 'maxIterations',
  '--executor': 'executor', '--step': 'step', '--file': 'file', '--fail': 'fail', '--reason': 'reason', '--timeout': 'timeout', '--sandbox': 'sandbox',
};
const COMMANDS = ['start', 'next', 'report', 'status', 'cancel', 'drive'];
const bad = (message) => new FabricError(EXIT_CODES.INVALID_INPUT, message);

export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (!COMMANDS.includes(cmd)) throw bad(`unknown command ${JSON.stringify(cmd)}; use ${COMMANDS.join('|')}`);
  const o = { skills: [] };
  for (let i = 0; i < rest.length; i++) {
    const eq = rest[i].indexOf('=');
    const flag = eq > 0 ? rest[i].slice(0, eq) : rest[i];
    const key = FLAGS[flag];
    if (!key) throw bad(`unknown argument ${rest[i]}`);
    const value = eq > 0 ? rest[i].slice(eq + 1) : rest[++i];
    if (value === undefined || value === '') throw bad(`${flag} needs a value`);
    if (key === 'skill') o.skills.push(value);
    else o[key] = value;
  }
  for (const k of ['maxIterations', 'timeout']) {
    if (o[k] !== undefined) {
      o[k] = Number(o[k]);
      if (!Number.isInteger(o[k]) || o[k] < 1) throw bad(`--${k === 'maxIterations' ? 'max-iterations' : k} must be a positive integer`);
    }
  }
  return { cmd, o };
}

const need = (o, ...keys) => { for (const k of keys) if (!o[k]) throw bad(`--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`); };

export async function main(argv, { cwd = process.cwd(), out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s) } = {}) {
  try {
    const { cmd, o } = parseArgs(argv);
    let res;
    if (cmd === 'start') {
      if (!o.goal && !o.goalFile) throw bad('--goal or --goal-file is required');
      let goal = o.goal;
      if (!goal) { try { goal = readFileSync(o.goalFile, 'utf8'); } catch (e) { throw bad(`cannot read --goal-file ${o.goalFile}: ${e.code || e.message}`); } }
      res = startRun({ root: cwd, run: o.run, goal, skills: o.skills, maxIterations: o.maxIterations, executor: o.executor });
    } else if (cmd === 'drive') {
      need(o, 'run');
      return await drive({ root: cwd, run: o.run, executor: o.executor, timeout: o.timeout, sandbox: o.sandbox, out, err });
    } else {
      need(o, 'run');
      if (cmd === 'next') res = nextView({ root: cwd, run: o.run });
      else if (cmd === 'status') res = statusView({ root: cwd, run: o.run });
      else if (cmd === 'cancel') res = cancelRun({ root: cwd, run: o.run, reason: o.reason });
      else {
        need(o, 'step');
        if (!o.file === !o.fail) throw bad('report needs exactly one of --file and --fail');
        res = acceptReport({ root: cwd, run: o.run, step: o.step, file: o.file, fail: o.fail });
      }
    }
    out(`${JSON.stringify(res.out)}\n`);
    return res.code;
  } catch (e) {
    const code = e instanceof FabricError ? e.code : EXIT_CODES.UNEXPECTED_ERROR;
    err(`${JSON.stringify({ error: e.message, code })}\n`);
    return code;
  }
}

const invokedAs = (() => { try { return realpathSync(process.argv[1] || ''); } catch { return ''; } })();
if (invokedAs === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
