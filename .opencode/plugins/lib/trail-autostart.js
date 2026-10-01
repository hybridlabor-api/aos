/**
 * OpenCode counterpart of the Claude PreToolUse agenttrail autostart.
 * Pure and injectable so it is testable without OpenCode. Never throws.
 * Tool args/prompts are deliberately not an input: nothing user-authored
 * can reach the command line.
 */

import { spawnSync as realSpawnSync } from 'node:child_process';

export const TRAIL_TIMEOUT_MS = 1800;
export const SPAWN_TOOLS = new Set(['task']);

export function isSpawnTool(tool) {
  return SPAWN_TOOLS.has(String(tool || '').toLowerCase());
}

// Returns { url, hint } or null (no URL, binary missing, timeout, bad output).
export function trailEnsure({ spawnSync = realSpawnSync, env = process.env, cwd, sessionId } = {}) {
  try {
    const args = ['--ensure'];
    if (cwd) args.push('--cwd', String(cwd));
    if (sessionId) args.push('--session', String(sessionId));
    args.push('--json');
    const res = spawnSync(env.AOS_TRAIL_BIN || 'aos-trail', args, {
      encoding: 'utf8',
      timeout: TRAIL_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'ignore'],
      env,
    });
    if (!res || res.error || res.status !== 0) return null;
    const out = JSON.parse(String(res.stdout || '').trim());
    if (!out || typeof out.url !== 'string' || !out.url) return null;
    return { url: out.url, hint: typeof out.hint === 'string' ? out.hint : null };
  } catch {
    return null;
  }
}
