import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadProbe } from './probe-load.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

export function runProbes(opts = {}) {
  const home = opts.home || process.env.HOME || os.homedir();
  const evolveDir = path.join(home, '.aos', 'evolve');
  const resultsFile = path.join(evolveDir, 'probe_results.json');

  const set = opts.set || 'default';

  const defaultProbeNames = ['clean-code-001', 'instinct-export-001', 'skill-create-001'];
  const probeNames = opts.probeNames || defaultProbeNames;
  const probesDirRoot = opts.probesDir || path.join(REPO_ROOT, 'evolve', 'probes');

  let prevResults = {};
  if (fs.existsSync(resultsFile)) {
    try {
      prevResults = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
    } catch (e) {}
  }

  const results = {};
  let anyImproved = false;
  const regressions = [];

  for (const pid of probeNames) {
    const skillName = pid.replace(/-001$/, '');
    const probeDir = path.join(probesDirRoot, skillName, pid);

    if (!fs.existsSync(probeDir)) {
      continue;
    }

    let def;
    try {
      // Allow overriding loadProbe and execution in tests
      const loader = opts.loadProbe || loadProbe;
      def = loader(probeDir, opts);
    } catch (e) {
      continue;
    }

    const repeats = def.probe.repeats || 3;
    let score = 0;

    for (let i = 0; i < repeats; i++) {
      try {
        const execFn = opts.execFileSync || execFileSync;
        const out = execFn(process.execPath, [def.checkerPath], { cwd: def.probeDir, encoding: 'utf8' });
        const parsed = JSON.parse(out);
        score += parsed.score || 0;
      } catch (e) {
        // failed run counts as 0 score
      }
    }

    const avgScore = score / repeats;
    results[pid] = avgScore;

    const prevScore = prevResults[pid] !== undefined ? prevResults[pid] : 0;

    if (avgScore > prevScore) {
      anyImproved = true;
    }
    if (avgScore < prevScore) {
      regressions.push(pid);
    }
  }

  if (!opts.dryRun) {
    fs.mkdirSync(evolveDir, { recursive: true });
    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2), 'utf8');
  }

  if (regressions.length > 0) {
    return {
      ok: false,
      error: `Regression in probes: ${regressions.join(', ')}`,
      regressions,
      results
    };
  }

  if (!anyImproved && probeNames.length > 0) {
    return {
      ok: false,
      error: `No probe improved.`,
      regressions,
      results
    };
  }

  return { ok: true, results, regressions };
}
