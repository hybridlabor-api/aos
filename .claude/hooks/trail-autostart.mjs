#!/usr/bin/env node
// PreToolUse hook: when a subagent is spawned (Agent/Task), make sure the agenttrail
// live map runs and hand its URL to the model. Fail-open: never blocks, never throws.
// Reads only tool_name, session_id, cwd -- never tool_input or prompt text.
import { readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Hook body shared by the script entry and the in-process dispatcher (aos-hooks.mjs).
export function hook(input) {
  try {
    if (input?.tool_name === 'Agent' || input?.tool_name === 'Task') {
      const args = ['--ensure'];
      if (typeof input.cwd === 'string' && input.cwd) args.push('--cwd', input.cwd);
      if (typeof input.session_id === 'string' && input.session_id) args.push('--session', input.session_id);
      args.push('--json');
      const bin = process.env.AOS_TRAIL_BIN || 'aos-trail';
      const viaNode = /\.(?:mjs|cjs|js)$/i.test(bin); // a #! script is not spawnable on Windows
      const r = spawnSync(viaNode ? process.execPath : bin, viaNode ? [bin, ...args] : args, {
        encoding: 'utf8', timeout: 1800, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
      });
      const out = r.error || r.status !== 0 ? null : JSON.parse(r.stdout);
      const text = out && (out.url ? `agenttrail live map: ${out.url}` : out.hint);
      if (typeof text === 'string' && text) {
        return {
          code: 0,
          stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } }) + '\n',
          stderr: '',
        };
      }
    }
  } catch { /* fail open */ }
  return { code: 0, stdout: '', stderr: '' };
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (isMain()) {
  let input = null;
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { /* fail open */ }
  const r = hook(input);
  if (r.stdout) process.stdout.write(r.stdout);
  process.exit(0);
}
