#!/usr/bin/env node
// aos-gogate: read-only go-gate helper for every harness. It prints the status by running
// go-grant.mjs --status and prints preset texts; it never records a grant, mode or GO.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PRESETS = [
  { name: 'release', text: 'gogate grant push-feature,github-write,merge,publish 2h' },
  { name: 'feature', text: 'gogate grant push-feature,github-write 2h' },
  { name: 'soft', text: 'gogate soft' },
  { name: 'hard', text: 'gogate hard' },
  { name: 'status', text: 'gogate status' },
];
const NAMES = PRESETS.map((p) => p.name).join(', ');

const USAGE = `aos-gogate: read-only go-gate helper
Usage:
  aos-gogate status [--session <id>]   status of one session, or of all without --session
  aos-gogate preset <name>             the exact text to type (${NAMES})
  aos-gogate presets                   all presets
Type a preset's text yourself as the whole message; this tool never records anything.`;

const claudeDir = () => process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), '.claude');

function status(argv) {
  const grant = path.join(claudeDir(), 'hooks', 'go-grant.mjs');
  if (!existsSync(grant)) {
    console.error(`aos-gogate: go-gate is not installed (${grant} missing)`);
    return 2;
  }
  const i = argv.indexOf('--session');
  const session = i !== -1 && argv[i + 1] ? ['--session', argv[i + 1]] : [];
  const r = spawnSync(process.execPath, [grant, '--status', ...session], { stdio: 'inherit' });
  if (r.error) console.error(`aos-gogate: ${r.error.message}`);
  return r.status ?? 1;
}

function preset(name) {
  const p = PRESETS.find((x) => x.name === name);
  if (!p) {
    console.error(`aos-gogate: unknown preset "${name ?? ''}". Presets: ${NAMES}`);
    return 1;
  }
  console.log(p.text);
  return 0;
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === '--help' || cmd === '-h') {
  console.log(USAGE);
  process.exit(0);
}
if (cmd === 'status') process.exit(status(rest));
if (cmd === 'preset') process.exit(preset(rest[0]));
if (cmd === 'presets') {
  for (const p of PRESETS) console.log(`${p.name.padEnd(8)}${p.text}`);
  process.exit(0);
}
console.error(USAGE);
process.exit(1);
