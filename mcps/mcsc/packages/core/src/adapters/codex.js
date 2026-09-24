import { spawn } from 'node:child_process';
import { emitTrail } from '../trail.js';

const MAX_OUTPUT = 1024 * 1024 * 50; // 50MB, mirrors the old execFile maxBuffer

/**
 * Adapter für die Codex CLI.
 * Implementiert die DelegationRequest Schnittstelle.
 *
 * Uses `codex exec --json` (confirmed present: `codex exec --help` lists
 * `--json  Print events to stdout as JSONL`) instead of a blind exec, so a
 * delegated Codex run gets the same mid-run tool-call visibility on
 * agenttrail's board as the opencode adapter already has. The envelope shape
 * below (`thread.started` / `turn.started` / `item.completed` / `turn.failed`,
 * `item.completed` items carrying `{id, type, ...}`) was confirmed live
 * against the installed CLI (codex-cli 0.154.0). The exact `item.type` string
 * for a real tool call (e.g. shell exec, patch apply, the plan/todo tool)
 * was NOT confirmed live — every probe run in this environment hit a 401
 * auth error before Codex executed anything. `buildToolInput` below is
 * therefore deliberately generic/defensive rather than keyed to guessed
 * field names, and Codex's plan/todo tool is not mapped into a
 * `PostToolUse` with `tool_name: 'update_plan'` here — doing that from
 * unverified field names would silently ship a wrong mapping. Re-verify
 * with authenticated Codex and tighten this once the real item shape for a
 * tool call (and for its plan/todo tool specifically) is known.
 *
 * @param {import('./types.js').DelegationRequest} req
 * @returns {Promise<{ exit: number; output: string }>}
 */
export async function delegate(req) {
  const cwd = req.cwd || process.cwd();
  const trailEvent = {
    session_id: `mcsc-codex-${process.pid}-${Date.now()}`,
    cwd,
    agent:
      typeof req.label === 'string' && req.label.length > 0
        ? `codex:${req.label}`
        : 'codex',
  };
  emitTrail({ ...trailEvent, hook_event_name: 'SessionStart' });

  const env = { ...process.env, MCSC_CALLER: 'codex' };
  const args = ['exec', '--json', '--skip-git-repo-check'];
  if (req.model) args.push('-m', req.model);
  args.push(req.prompt);

  const child = spawn('codex', args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise((resolve) => {
    let lastAgentMessage = '';
    let stdoutBuf = '';
    let stderrBuf = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflowed = false;
    let aborted = false;
    let settled = false;
    let turnFailed = false;

    const onAbort = () => {
      aborted = true;
      child.kill('SIGKILL');
    };
    if (req.signal) {
      if (req.signal.aborted) onAbort();
      else req.signal.addEventListener('abort', onAbort, { once: true });
    }

    const finalize = (result) => {
      if (settled) return;
      settled = true;
      if (req.signal) req.signal.removeEventListener('abort', onAbort);
      emitTrail({ ...trailEvent, hook_event_name: 'SessionEnd' });
      resolve(result);
    };

    // Defensive/generic: no confirmed field names for a real tool-call item
    // (see the doc comment above), so this only forwards what's plausibly
    // present rather than asserting a specific Codex item shape.
    const buildToolInput = (item) => {
      const toolInput = {};
      if (!item || typeof item !== 'object') return toolInput;
      const rawCommand = item.command || item.cmd;
      if (typeof rawCommand === 'string' && rawCommand.length > 0) toolInput.command = rawCommand;
      else if (Array.isArray(rawCommand)) toolInput.command = rawCommand.join(' ');
      const rawPath = item.file_path || item.path;
      if (typeof rawPath === 'string' && rawPath.length > 0) toolInput.file_path = rawPath;
      return toolInput;
    };

    const handleLine = (line) => {
      if (!line) return;
      let evt;
      try {
        evt = JSON.parse(line);
      } catch {
        return; // Not valid JSON — ignore.
      }
      if (!evt || typeof evt !== 'object') return;

      if (evt.type === 'turn.completed' && typeof evt.last_agent_message === 'string') {
        lastAgentMessage = evt.last_agent_message;
        return;
      }
      if (evt.type === 'turn.failed') {
        turnFailed = true;
        return;
      }
      if (evt.type === 'item.completed' && evt.item && typeof evt.item === 'object') {
        const itemType = evt.item.type;
        // Informational item types carry no tool call — skip them so the
        // board doesn't show a fake "tool" for plain error/text output.
        if (itemType === 'error' || itemType === 'reasoning' || itemType === 'agent_message') return;
        emitTrail({
          ...trailEvent,
          hook_event_name: 'PostToolUse',
          tool_name: String(itemType || 'codex_item')
            .replace(/(^|_)([a-z])/g, (_, sep, c) => c.toUpperCase()),
          tool_input: buildToolInput(evt.item),
        });
      }
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdoutBytes += Buffer.byteLength(chunk);
      if (stdoutBytes > MAX_OUTPUT) {
        if (!overflowed) {
          overflowed = true;
          child.kill('SIGKILL');
        }
        return;
      }
      stdoutBuf += chunk;
      let idx;
      while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, idx).trim();
        stdoutBuf = stdoutBuf.slice(idx + 1);
        handleLine(line);
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderrBytes += Buffer.byteLength(chunk);
      if (stderrBytes > MAX_OUTPUT) return; // cap stderr, never fail on it
      stderrBuf += chunk;
    });

    child.on('error', (err) => {
      finalize({ exit: 1, output: (stderrBuf || err.message || '').trim() });
    });

    child.on('close', (code) => {
      const rest = stdoutBuf.trim();
      if (rest) handleLine(rest); // flush a trailing line without newline
      if (aborted) {
        finalize({ exit: 1, output: 'Cancelled by orchestrator' });
        return;
      }
      if (overflowed) {
        finalize({ exit: 1, output: 'stdout maxBuffer length exceeded' });
        return;
      }
      if (code === 0 && !turnFailed) {
        finalize({ exit: 0, output: lastAgentMessage || stderrBuf });
        return;
      }
      finalize({ exit: 1, output: (lastAgentMessage || stderrBuf || `codex exited with code ${code}`).trim() });
    });

    // An open stdin pipe makes the CLI wait for input forever.
    child.stdin.end();
  });
}
