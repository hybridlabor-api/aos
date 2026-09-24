import { spawn } from 'node:child_process';
import path from 'node:path';
import { emitTrail } from '../trail.js';

const MAX_OUTPUT = 1024 * 1024 * 50; // 50MB, mirrors the old execFile maxBuffer

/**
 * CliAdapter shelling out to `opencode run --auto --format json [--model <model>] <prompt>`.
 * Optional `req.variant` is passed through as `--variant <variant>` (model reasoning effort).
 * Reads stdout line by line: assistant text parts are collected and joined as
 * `output`; tool events are forwarded to the live map as PreToolUse/PostToolUse.
 *
 * @param {import('../types.js').DelegationRequest} req
 * @returns {Promise<{ exit: number; output: string; attestation: { kind: 'unavailable'; } }>}
 */
export async function delegate(req) {
  const cwd = req.cwd || process.cwd();
  const trailEvent = {
    session_id: `mcsc-opencode-${process.pid}-${Date.now()}`,
    cwd,
    agent:
      typeof req.label === 'string' && req.label.length > 0
        ? `opencode:${req.label}`
        : 'opencode',
  };
  emitTrail({ ...trailEvent, hook_event_name: 'SessionStart' });

  const env = { ...process.env, MCSC_CALLER: 'opencode' };
  const args = ['run', '--auto', '--format', 'json'];
  if (req.model) args.push('--model', req.model);
  if (req.variant) args.push('--variant', String(req.variant));
  args.push(req.prompt);

  const child = spawn('opencode', args, {
    cwd: req.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise((resolve) => {
    const textParts = [];
    let stdoutBuf = '';
    let stderrBuf = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflowed = false;
    let aborted = false;
    let settled = false;

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

    const buildToolInput = (input) => {
      const toolInput = {};
      if (!input || typeof input !== 'object') return toolInput;
      const rawPath = input.filePath || input.file_path || input.path || input.file;
      if (typeof rawPath === 'string' && rawPath.length > 0) {
        toolInput.file_path = path.isAbsolute(rawPath)
          ? rawPath
          : path.resolve(cwd, rawPath);
      }
      const rawCommand = input.command || input.cmd;
      if (typeof rawCommand === 'string' && rawCommand.length > 0) {
        toolInput.command = rawCommand;
      }
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
      const part = evt.part;
      if (!part || typeof part !== 'object') return;

      if (evt.type === 'text') {
        if (typeof part.text === 'string' && part.text.length > 0) {
          textParts.push(part.text);
        }
        return;
      }

      if (
        evt.type === 'tool_use' &&
        typeof part.tool === 'string' &&
        part.tool.length > 0
      ) {
        const state = part.state || {};
        const finished = state.status === 'completed' || state.status === 'error';
        emitTrail({
          ...trailEvent,
          hook_event_name: finished ? 'PostToolUse' : 'PreToolUse',
          tool_name: part.tool.charAt(0).toUpperCase() + part.tool.slice(1),
          tool_input: buildToolInput(state.input),
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
      finalize({
        exit: 1,
        output: (stderrBuf || err.message || '').trim(),
        attestation: { kind: 'unavailable' },
      });
    });

    child.on('close', (code) => {
      const rest = stdoutBuf.trim();
      if (rest) handleLine(rest); // flush a trailing line without newline
      if (aborted) {
        finalize({
          exit: 1,
          output: 'Cancelled by orchestrator',
          attestation: { kind: 'unavailable' },
        });
        return;
      }
      if (overflowed) {
        finalize({
          exit: 1,
          output: 'stdout maxBuffer length exceeded',
          attestation: { kind: 'unavailable' },
        });
        return;
      }
      if (code === 0) {
        const output = textParts.length > 0 ? textParts.join('\n') : stderrBuf;
        finalize({ exit: 0, output, attestation: { kind: 'unavailable' } });
        return;
      }
      finalize({
        exit: 1,
        output: (stderrBuf || `opencode exited with code ${code}`).trim(),
        attestation: { kind: 'unavailable' },
      });
    });
  });
}
