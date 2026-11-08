import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { isEvolveDisabled, loadFailures, resolveFailureStorePath } from './capture.mjs';
import { isDenied } from './deny.mjs';
import { redact } from './redact.mjs';
import { loadProbe } from './probe-load.mjs';

function execGit(args, cwd = process.cwd()) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Creates an isolated git worktree, applies the diff, and runs probes.
 */
function testCandidateInWorktree(diffContent, probes, cwd = process.cwd()) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-evolve-worktree-'));
  try {
    const branchName = 'evolve-candidate-' + crypto.randomBytes(8).toString('hex');
    execGit(['worktree', 'add', '-b', branchName, tmpDir, 'HEAD'], cwd);

    // Apply patch
    const patchPath = path.join(tmpDir, 'candidate.patch');
    fs.writeFileSync(patchPath, diffContent, 'utf8');

    try {
      execGit(['apply', 'candidate.patch'], tmpDir);
    } catch (err) {
      return { ok: false, error: `Patch failed to apply: ${err.message}` };
    }

    // Run probes in the worktree context
    for (const probeRunner of probes) {
      // If probeRunner is a string, we treat it as a probe ID/path and run it
      if (typeof probeRunner === 'string') {
        let loadedProbe;
        try {
          loadedProbe = loadProbe(probeRunner);
        } catch (err) {
          return { ok: false, error: `Failed to load probe ${probeRunner}: ${err.message}` };
        }

        try {
          const out = execFileSync(process.execPath, [loadedProbe.checkerPath], {
            cwd: tmpDir,
            encoding: 'utf8'
          });
          const parsed = JSON.parse(out);
          if (!parsed.pass) {
            return { ok: false, error: `Probe ${loadedProbe.probe.id} failed` };
          }
        } catch (err) {
          return { ok: false, error: `Probe execution error: ${err.message}` };
        }
      } else if (typeof probeRunner === 'function') {
        const res = probeRunner({ diff: diffContent, worktree: tmpDir });
        // Handle both async and sync mock probes (for tests)
        if (res && res.then) {
           throw new Error("Async mock probes not supported in sync worktree flow, adjust tests");
        } else if (!res.ok) {
           return { ok: false, error: `Probe failed: ${res.error}` };
        }
      }
    }

    return { ok: true };
  } finally {
    try { execGit(['worktree', 'remove', '--force', tmpDir], cwd); } catch {}
    try { execGit(['branch', '-D', path.basename(tmpDir)], cwd); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * Proposes a candidate fix.
 */
export async function proposeCandidate(opts) {
  if (isEvolveDisabled()) {
    return { ok: false, error: 'AOS Evolve is disabled via kill switch or environment' };
  }

  let storePath;
  try {
    storePath = resolveFailureStorePath(opts.storagePath, { home: opts.home });
  } catch (err) {
    return { ok: false, error: err.message };
  }

  let failures;
  try {
    failures = loadFailures(storePath, { home: opts.home });
  } catch (err) {
    return { ok: false, error: err.message };
  }

  if (failures.length === 0) {
    return { ok: false, error: 'No failures found to propose a fix for' };
  }

  let targetFailure;
  if (opts.signature) {
    targetFailure = failures.find(f => f.error_sig === opts.signature);
    if (!targetFailure) {
      return { ok: false, error: `Failure with signature ${opts.signature} not found` };
    }
  } else {
    targetFailure = failures.reduce((max, f) => (f.count || 1) > (max.count || 1) ? f : max, failures[0]);
  }

  if (!opts.fixer) {
    return { ok: false, error: 'No fixer function provided' };
  }
  let candidateData;
  try {
    candidateData = await opts.fixer(targetFailure);
  } catch (err) {
    return { ok: false, error: `Fixer failed: ${err.message}` };
  }

  if (!candidateData || !candidateData.diff || !candidateData.files || candidateData.files.length === 0) {
    return { ok: false, error: 'Fixer produced no diff or empty files list' };
  }

  for (const file of candidateData.files) {
    if (isDenied(file)) {
      return { ok: false, error: `Candidate rejected: diff touches deny-listed path '${file}'` };
    }
  }

  const diffContent = candidateData.diff;
  const redactedDiff = redact(diffContent);
  if (redactedDiff !== diffContent) {
    if (redactedDiff.includes('***REDACTED***') || redactedDiff.includes('[REDACTED')) {
      return { ok: false, error: 'Candidate rejected: diff contains potential secrets' };
    }
  }

  // Probe testing via git worktree
  if (opts.probes && opts.probes.length > 0) {
     // If we are in a pure unit test with fake functions, we might just call them directly
     // rather than doing the git worktree if they are simple async mocks.
     let worktreeResult = { ok: true };
     const useWorktree = opts.useWorktree !== false;

     if (useWorktree) {
       worktreeResult = testCandidateInWorktree(diffContent, opts.probes, opts.cwd);
       if (!worktreeResult.ok) {
           return { ok: false, error: `Candidate rejected: ${worktreeResult.error}` };
       }
     } else {
       for (const probeRunner of opts.probes) {
           if (typeof probeRunner === 'function') {
               const probeRes = await probeRunner(candidateData);
               if (!probeRes.ok) {
                   return { ok: false, error: `Candidate rejected: probe failed - ${probeRes.error}` };
               }
           }
       }
     }
  }

  if (!opts.dryRun) {
    if (!opts.createPr) {
      return { ok: false, error: 'No createPr function provided' };
    }
    try {
      await opts.createPr(targetFailure, redactedDiff);
    } catch (err) {
      return { ok: false, error: `Failed to create PR: ${err.message}` };
    }
  }

  return { ok: true, candidate: candidateData, redactedDiff, dryRun: !!opts.dryRun };
}
