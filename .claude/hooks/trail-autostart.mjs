#!/usr/bin/env node
// PreToolUse hook: when a subagent is spawned (Agent/Task), make sure the agenttrail
// live map runs and hand its URL to the model. Fail-open: never blocks, never throws.
// Reads only tool_name, session_id, cwd -- never tool_input or prompt text.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  if (input.tool_name === 'Agent' || input.tool_name === 'Task') {
    const args = ['--ensure'];
    if (typeof input.cwd === 'string' && input.cwd) args.push('--cwd', input.cwd);
    if (typeof input.session_id === 'string' && input.session_id) args.push('--session', input.session_id);
    args.push('--json');
    const r = spawnSync(process.env.AOS_TRAIL_BIN || 'aos-trail', args, {
      encoding: 'utf8', timeout: 1800, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'ignore'],
    });
    const out = r.error || r.status !== 0 ? null : JSON.parse(r.stdout);
    const text = out && (out.url ? `agenttrail live map: ${out.url}` : out.hint);
    if (typeof text === 'string' && text) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text },
      }) + '\n');
    }
  }
} catch { /* fail open */ }
process.exit(0);
