import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

/**
 * CliAdapter shelling out to `opencode run --auto --model <model> <prompt>`.
 *
 * @param {import('../types.js').DelegationRequest} req
 * @returns {Promise<{ exit: number; output: string; attestation: { kind: 'unavailable'; } }>}
 */
export async function delegate(req) {
  try {
    const env = { ...process.env, MCSC_CALLER: 'opencode' };
    const args = ['run', '--auto'];
    if (req.model) args.push('--model', req.model);
    args.push(req.prompt);
    const run = execFileAsync(
      'opencode',
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
    // opencode does not provide a machine-parseable model-confirmation mechanism
    return {
      exit: 0,
      output: stdout || stderr,
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