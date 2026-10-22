#!/usr/bin/env node
// PreToolUse hook: when a subagent is spawned (Agent/Task), make sure the agenttrail
// live map runs and hand its URL to the model. Fail-open: never blocks, never throws.
// Reads only tool_name, session_id, cwd -- never tool_input or prompt text.
import { spawnSync } from 'node:child_process';

// Bounded stdin read, same as rules-inject.mjs readStdinBounded: an open stdin pipe (Codex on Windows) must not hang
// the hook. Stops on end, first complete JSON, byte cap or timeout; null = nothing read before a timeout or an error.
function readStdinBounded(maxMs, maxBytes = 64 << 20) {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let buf = "";
    let settled = false;
    const finish = (incomplete) => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      try { process.stdin.pause(); } catch {}
      resolve(incomplete === true && !buf ? null : buf);
    };
    const to = setTimeout(finish, maxMs, true);
    if (to.unref) to.unref();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
      if (buf.length >= maxBytes) return finish();
      if (buf.trimEnd().endsWith("}")) try { JSON.parse(buf); finish(); } catch {}
    });
    process.stdin.on("end", finish);
    process.stdin.on("error", () => finish(true));
    process.stdin.resume();
  });
}

try {
  const input = JSON.parse((await readStdinBounded(1500)) ?? '');
  if (input.tool_name === 'Agent' || input.tool_name === 'Task') {
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
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text },
      }) + '\n');
    }
  }
} catch { /* fail open */ }
process.exit(0);
