import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

/**
 * CliAdapter shelling out DIRECTLY to the vendor 'agy' binary.
 *
 * @param {import('../types.js').DelegationRequest} req
 * @returns {Promise<{ exit: number; output: string; attestation: { kind: 'confirmed' | 'unavailable'; modelId?: string; sessionRef?: string } }>}
 */
export async function delegate(req) {
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

    return {
      exit: 0,
      output: raw.trim(),
      attestation: { kind: 'unavailable' },
    };
  } catch (e) {
    if (e.name === 'AbortError') {
      return {
        exit: 1,
        output: 'Cancelled by orchestrator',
        attestation: { kind: 'unavailable' }
      };
    }
    return {
      exit: 1,
      output: (e.stderr || e.message || '').trim(),
      attestation: { kind: 'unavailable' },
    };
  }
}