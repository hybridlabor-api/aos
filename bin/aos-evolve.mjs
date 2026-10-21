#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  captureFailure,
  isEvolveDisabled,
  disableEvolve,
  enableEvolve,
  loadFailures,
  resolveFailureStorePath,
} from '../lib/evolve/capture.mjs';

const MAX_INPUT_BYTES = 64 * 1024; // 64 KiB input cap

const HELP_TEXT = `aos-evolve - Offline autonomous harness evolution engine (Harness² Prep)

Usage:
  aos-evolve capture <failure.json | --error "..."> [--skill <name>] [options]
  aos-evolve status [--json]
  aos-evolve disable
  aos-evolve enable
  aos-evolve --help | -h | help

Commands:
  capture    Redact and record a task/test failure into failure.json (deduplicated by signature)
  status     Display evolution engine status, kill switch state, and failure counts
  disable    Activate the kill switch (~/.aos/evolve/DISABLED) to halt all evolution cycles
  enable     Remove the kill switch and re-enable evolution cycles

Options:
  --skill <name>      Target skill directory name (required for --error)
  --error <text>      Raw error message or transcript excerpt to capture
  --kind <kind>       Failure kind: test | build | review | advisor-repeat | user (default: test)
  --harness <name>    Execution harness: claude | agy | opencode | codex (default: agy)
  --role <role>       Active agent role (default: builder)
  --dry-run           Compute redaction and signature without writing to store
  --storage <path>    Custom failure.json destination file (must resolve inside ~/.aos/evolve/)
  --json              Format output as JSON
  -h, --help          Show this help message and exit
`;

function readBoundedStdin(maxBytes) {
  return new Promise((resolve, reject) => {
    let bytesRead = 0;
    const chunks = [];

    function cleanup() {
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('error', onError);
    }

    function onData(chunk) {
      bytesRead += chunk.length;
      if (bytesRead > maxBytes) {
        process.stdin.pause();
        cleanup();
        reject(new Error(`Stdin input exceeds ${maxBytes / 1024} KiB size limit`));
        return;
      }
      chunks.push(chunk);
    }

    function onEnd() {
      cleanup();
      resolve(Buffer.concat(chunks).toString('utf8'));
    }

    function onError(err) {
      cleanup();
      reject(err);
    }

    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.on('error', onError);
    process.stdin.resume();
  });
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 0 || args.includes('-h') || args.includes('--help') || args[0] === 'help') {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  const cmd = args[0];

  if (cmd === 'disable') {
    const marker = disableEvolve();
    process.stdout.write(`AOS Evolve disabled via kill switch (${marker})\n`);
    return 0;
  }

  if (cmd === 'enable') {
    const removed = enableEvolve();
    process.stdout.write(removed ? 'AOS Evolve re-enabled.\n' : 'AOS Evolve was not disabled.\n');
    return 0;
  }

  if (cmd === 'status') {
    const disabled = isEvolveDisabled();
    const storagePath = getArgValue(args, '--storage');
    let storePath;
    try {
      storePath = resolveFailureStorePath(storagePath);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      return 1;
    }
    let failures;
    try {
      failures = loadFailures(storePath);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      return 1;
    }

    if (args.includes('--json')) {
      process.stdout.write(JSON.stringify({
        enabled: !disabled,
        disabled,
        storagePath: storePath,
        failureCount: failures.length,
        totalOccurrences: failures.reduce((sum, f) => sum + (f.count || 1), 0),
      }, null, 2) + '\n');
    } else {
      process.stdout.write(`AOS Evolve Status:
  State:         ${disabled ? 'DISABLED (kill switch active)' : 'ENABLED'}
  Store:         ${storePath}
  Failures:      ${failures.length} unique signatures (${failures.reduce((sum, f) => sum + (f.count || 1), 0)} total occurrences)
`);
    }
    return 0;
  }

  if (cmd === 'capture') {
    if (isEvolveDisabled()) {
      process.stderr.write('Error: AOS Evolve is disabled via kill switch (~/.aos/evolve/DISABLED or AOS_EVOLVE=off)\n');
      return 1;
    }

    const dryRun = args.includes('--dry-run');
    const asJson = args.includes('--json');
    const storagePath = getArgValue(args, '--storage');
    const skillArg = getArgValue(args, '--skill');
    const kind = getArgValue(args, '--kind') || 'test';
    const harness = getArgValue(args, '--harness') || 'agy';
    const role = getArgValue(args, '--role') || 'builder';
    const errorArg = getArgValue(args, '--error');

    let errorData = errorArg;
    let skill = skillArg;

    const fileArg = args[1] && !args[1].startsWith('-') ? args[1] : null;

    if (fileArg && fileArg !== '-') {
      if (!fs.existsSync(fileArg)) {
        process.stderr.write(`Error: Input file not found: ${fileArg}\n`);
        return 1;
      }
      const stat = fs.statSync(fileArg);
      if (stat.size > MAX_INPUT_BYTES) {
        process.stderr.write(`Error: Input file exceeds 64 KiB size limit (${stat.size} bytes)\n`);
        return 1;
      }
      const raw = fs.readFileSync(fileArg, 'utf8');
      try {
        const parsed = JSON.parse(raw);
        errorData = parsed.error || parsed.redacted_excerpt || parsed.message || raw;
        skill = skill || parsed.skill;
      } catch {
        errorData = raw;
      }
    } else if (fileArg === '-' || (!errorArg && !process.stdin.isTTY)) {
      try {
        errorData = await readBoundedStdin(MAX_INPUT_BYTES);
      } catch (err) {
        process.stderr.write(`Error: ${err.message}\n`);
        return 1;
      }
    }

    if (!errorData) {
      process.stderr.write('Error: No error input provided. Specify a file, --error, or pipe via stdin.\n');
      return 1;
    }
    if (!skill) {
      process.stderr.write('Error: Target skill name required (--skill <name>).\n');
      return 1;
    }

    const result = captureFailure({
      error: errorData,
      skill,
      kind,
      harness,
      role,
      storagePath,
      dryRun,
    });

    if (!result.ok) {
      process.stderr.write(`Error: ${result.error}\n`);
      return 1;
    }

    if (asJson) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      const verb = result.deduplicated ? 'Deduplicated' : 'Captured';
      process.stdout.write(`${verb} failure for skill '${skill}' [sig: ${result.record.error_sig}] (count: ${result.count})\n`);
      if (dryRun) {
        process.stdout.write(`(dry-run: no changes written to ${result.storePath})\n`);
      }
    }
    return 0;
  }

  process.stderr.write(`Unknown command: ${cmd}\nRun 'aos-evolve --help' for usage.\n`);
  return 1;
}

function getArgValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  const prefix = `${flag}=`;
  const match = args.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

const isDirectEntry = process.argv[1] && (
  process.argv[1].endsWith('bin/aos-evolve.mjs') ||
  process.argv[1].endsWith('bin/aos-evolve')
);

if (isDirectEntry) {
  main().then((code) => {
    process.exit(code ?? 0);
  }).catch((err) => {
    process.stderr.write(`Fatal error: ${err.message}\n`);
    process.exit(1);
  });
}
