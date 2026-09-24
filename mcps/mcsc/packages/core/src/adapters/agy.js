import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { emitTrail } from '../trail.js';
const execFileAsync = promisify(execFile);

/**
 * CliAdapter shelling out DIRECTLY to the vendor 'agy' binary.
 *
 * @param {import('../types.js').DelegationRequest} req
 * @returns {Promise<{ exit: number; output: string; attestation: { kind: 'confirmed' | 'unavailable'; modelId?: string; sessionRef?: string } }>}
 */
export async function delegate(req) {
  const trailEvent = {
    session_id: `mcsc-agy-${process.pid}-${Date.now()}`,
    cwd: req.cwd || process.cwd(),
    agent: 'agy',
  };
  emitTrail({ ...trailEvent, hook_event_name: 'SessionStart' });
  try {
    const args = [];
    if (req.model) args.push('--model', req.model);
    args.push(
      '--print-timeout',
      '15m',
      '--output-format',
      'json',
      '--project',
      'mcsc-delegate',
      '--print',
      req.prompt
    );
    
    const env = { ...process.env, MCSC_CALLER: 'agy' };

    const run = execFileAsync(
      'agy',
      args,
      {
        cwd: req.cwd,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024 * 50,
        env,
        signal: req.signal
      }
    );
    // An open stdin pipe makes the CLI wait for input forever.
    run.child.stdin.end();
    const { stdout, stderr } = await run;

    const raw = stdout || stderr;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // If we can't parse JSON, we cannot attest the model.
      emitTrail({ ...trailEvent, hook_event_name: 'Stop' });
      return {
        exit: 0,
        output: raw.trim(),
        attestation: { kind: 'unavailable' },
      };
    }

    if (parsed && typeof parsed === 'object') {
      const modelId = parsed.modelId || parsed.model || parsed.cli_model || parsed.id;
      const sessionRef = parsed.conversation_id || parsed.session || parsed.sessionId || parsed.id;

      if (modelId) {
        emitTrail({ ...trailEvent, hook_event_name: 'Stop' });
        return {
          exit: 0,
          output: raw.trim(),
          attestation: {
            kind: 'confirmed',
            modelId: String(modelId),
            sessionRef: String(sessionRef || ''),
          },
        };
      }
    }

    emitTrail({ ...trailEvent, hook_event_name: 'Stop' });
    return {
      exit: 0,
      output: raw.trim(),
      attestation: { kind: 'unavailable' },
    };
  } catch (e) {
    if (e.name === 'AbortError') {
      emitTrail({ ...trailEvent, hook_event_name: 'Stop' });
      return {
        exit: 1,
        output: 'Cancelled by orchestrator',
        attestation: { kind: 'unavailable' }
      };
    }
    emitTrail({ ...trailEvent, hook_event_name: 'Stop' });
    return {
      exit: 1,
      output: (e.stderr || e.message || '').trim(),
      attestation: { kind: 'unavailable' },
    };
  }
}