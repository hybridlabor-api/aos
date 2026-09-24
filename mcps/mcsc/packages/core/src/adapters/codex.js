import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Adapter für die Codex CLI.
 * Implementiert die DelegationRequest Schnittstelle.
 * @param {import('./types.js').DelegationRequest} req 
 * @returns {Promise<{ exit: number; output: string }>}
 */
export async function delegate(req) {
  try {
    const args = ['exec'];
    if (req.model) args.push('-m', req.model);
    args.push(req.prompt);

    // Recursion Guard
    const env = { ...process.env, MCSC_CALLER: 'codex' };

    const run = execFileAsync(
      'codex', args,
      {
        cwd: req.cwd,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024 * 50, // 50MB Limit
        env,
        signal: req.signal
      }
    );
    // An open stdin pipe makes the CLI wait for input forever.
    run.child.stdin.end();
    const { stdout, stderr } = await run;
    
    return { exit: 0, output: stdout || stderr };
  } catch (e) {
    if (e.name === 'AbortError') {
      return { exit: 1, output: 'Cancelled by orchestrator' };
    }
    return { exit: 1, output: (e.stderr || e.message || '').trim() };
  }
}
